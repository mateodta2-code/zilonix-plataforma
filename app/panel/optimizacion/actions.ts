"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import {
  actualizarItemMl,
  actualizarNombreFamiliaMl,
  calidadItemMl,
  competenciaItemMl,
  fichasPublicacionesMl,
  ofertasProductoCompetenciaMl,
  productoCatalogoDeItemMl,
  reputacionVendedorMl,
  tieneDescripcionMl,
  leerAtributosItemMl,
  leerDescripcionItemMl,
  leerItemEdicionMl,
  LimiteMercadoLibreError,
  motivoErrorEscrituraMl,
  detalleErrorEscrituraMl,
  PATRON_ID_PRODUCTO_O_ITEM,
  promocionActivaMl,
  tieneAutomatizacionPrecioMl,
  visitasItemMl,
  type CalidadItemMl,
  type CompetenciaItemMl,
  type ItemEdicionMl,
} from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { formatearMoneda } from "@/lib/ml/sitios";
import { CloudinaryNoConfiguradoError, cloudinaryConfigurado, subirACloudinary } from "@/lib/cloudinary";
import { obtenerConexionIAParaModulo } from "@/lib/ia/conexion";
import { proponerContenido } from "@/lib/ia/contenido";
import { faltaParaCrear, limpiarContenido, palabrasProhibidas, promptImagenContenido, tipoContenido, tipoLoEscribeLaIA, type ContenidoImagen } from "@/lib/ia/contenidoReglas";
import { ErrorProveedorIA } from "@/lib/ia/proveedores";
import {
  descargarFotoBase,
  ErrorImagenIA,
  generarImagenDesdeFoto,
  leerTipoImagenIA,
  leerVariante,
  limpiarIndicaciones,
  MAXIMO_FOTOS_REFERENCIA,
  promptImagenIA,
} from "@/lib/ia/imagen";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { itemNoModificablePorRevision } from "@/lib/ml/publicar-reglas";
import { alertasComparacion, elegirCompetidores, type FilaComparacion } from "@/lib/optimizacion/competencia";
import { leerPrecioEscrito } from "@/lib/optimizacion/simulador";
import { diagnosticarPublicacion } from "@/lib/optimizacion/diagnostico";
import { leerDiasMetricas } from "@/lib/optimizacion/textos";
import { cambioEsDeLaPublicacion, compactarFotos, diaDelCambio, crearNotaBitacora, MARCA_FOTO_IA, registrarCambioOptimizacion, guardarRevisionCambio } from "@/lib/optimizacion/bitacora";
import { leerFechaNota, leerResultadoRevision, limpiarTextoBitacora } from "@/lib/optimizacion/bitacoraResultado";
import { hoyBogota } from "@/lib/publicidad/plan";
import { fichaDesdeItem, infoDeDescripcion } from "@/lib/optimizacion/fichaItem";
import { mensajeErrorIA, MENSAJE_SIN_IA } from "@/lib/publicaciones/errores";
import { idiomaDeSitio } from "@/lib/publicaciones/ficha";
import { LARGO_TITULO, LARGO_TITULO_CATALOGO } from "@/lib/publicaciones/titulos";
import { generarTitulosSeo } from "@/lib/publicaciones/titulos-ia";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerMiMembresia } from "@/lib/membresias";
import { tienePermiso } from "@/lib/roles-plantillas";
import { leerDatosDetalle } from "@/lib/optimizacion/detalle";
import { resolverPeriodoDetalle } from "@/lib/optimizacion/periodo";
import { resultadoCambio } from "@/lib/optimizacion/bitacoraResultado";
import type { ResumenPeriodo } from "@/lib/optimizacion/calculos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Por pedido de la tabla: cada publicación son hasta 3 llamadas.
const MAXIMO_ITEMS_POR_PEDIDO = 10;
const EN_PARALELO = 3;

async function contexto(accion: "consultar" | "modificar") {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaIdCookie = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaIdCookie) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");
  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", accion);
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return null;
  }
  return { usuarioId: usuario.id, empresaId: empresa.id };
}

async function cuentaDeLaEmpresa(empresaId: string, cuentaMlId: string) {
  if (!UUID.test(cuentaMlId)) return null;
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: cuentasMl.id, nickname: cuentasMl.nickname, siteId: cuentasMl.siteId, cuentaIdExterna: cuentasMl.cuentaIdExterna })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, cuentaMlId), eq(cuentasMl.empresaId, empresaId), isNull(cuentasMl.desconectadaTs)))
  );
  return cuenta ?? null;
}

// Diagnóstico de solo lectura (detalle de Optimización). Solo
// administradores: quien puede autorizar en Configuración (Dueño y
// Gerente de fábrica). Muestra datos crudos de Mercado Libre, nunca el
// token ni ids de la cuenta (lib/optimizacion/diagnostico.ts).
export type ResultadoDiagnostico = { ok: true; lineas: string[] } | { ok: false; aviso: string };

export async function diagnosticoPublicacionAction(entrada: { cuentaMlId: string; itemId: string }): Promise<ResultadoDiagnostico> {
  const ctx = await contexto("consultar");
  if (!ctx) return { ok: false, aviso: "Tu rol no tiene acceso a Optimización." };
  try {
    await requierePermiso(ctx.usuarioId, ctx.empresaId, "configuracion", "autorizar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return { ok: false, aviso: "El diagnóstico es solo para administradores de la empresa." };
  }
  if (typeof entrada.itemId !== "string" || !PATRON_ID_PRODUCTO_O_ITEM.test(entrada.itemId)) return { ok: false, aviso: "No se reconoce la publicación." };
  const cuenta = await cuentaDeLaEmpresa(ctx.empresaId, entrada.cuentaMlId);
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  let token: string;
  try {
    token = await obtenerAccessTokenVigente(ctx.empresaId, cuenta.id);
  } catch (error) {
    return { ok: false, aviso: motivoCuentaSinRevisar(error) };
  }
  try {
    return { ok: true, lineas: await diagnosticarPublicacion(entrada.itemId, token, cuenta.cuentaIdExterna) };
  } catch (error) {
    console.warn(`[app/panel/optimizacion] diagnóstico ${entrada.itemId}: ${error instanceof Error ? error.name : "error"}`);
    return { ok: false, aviso: "No se pudo consultar Mercado Libre. Intenta de nuevo." };
  }
}

export type MetricasPublicacion = {
  visitas: number | null;
  calidad: CalidadItemMl | null;
  // null si no es de catálogo o Mercado Libre no respondió.
  competencia: CompetenciaItemMl | null;
};

export type ResultadoMetricas = { ok: true; metricas: Record<string, MetricasPublicacion> } | { ok: false; aviso: string };

// Visitas de los últimos N días (7, 14, 30 o 90; cualquier otro valor
// cae a 7), calidad y competencia de hasta 10 publicaciones. Solo
// lectura. Una publicación que falla queda con sus datos en null.
export async function metricasPublicacionesAction(entrada: {
  cuentaMlId: string;
  items: { id: string; catalogo: boolean }[];
  dias?: number;
}): Promise<ResultadoMetricas> {
  const dias = leerDiasMetricas(entrada.dias);
  const ctx = await contexto("consultar");
  if (!ctx) return { ok: false, aviso: "Tu rol no tiene acceso a Optimización." };
  const cuenta = await cuentaDeLaEmpresa(ctx.empresaId, entrada.cuentaMlId);
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  const items = (Array.isArray(entrada.items) ? entrada.items : [])
    .filter((i) => typeof i?.id === "string" && PATRON_ID_PRODUCTO_O_ITEM.test(i.id))
    .slice(0, MAXIMO_ITEMS_POR_PEDIDO);

  let token: string;
  try {
    token = await obtenerAccessTokenVigente(ctx.empresaId, cuenta.id);
  } catch (error) {
    return { ok: false, aviso: motivoCuentaSinRevisar(error) };
  }

  const metricas: Record<string, MetricasPublicacion> = {};
  async function una(item: { id: string; catalogo: boolean }) {
    const seguro = <T,>(p: Promise<T | null>) => p.catch(() => null);
    const visitas = await seguro(visitasItemMl(item.id, token, dias));
    const calidad = await seguro(calidadItemMl(item.id, token));
    const competencia = item.catalogo ? await seguro(competenciaItemMl(item.id, token, cuenta!.siteId)) : null;
    metricas[item.id] = { visitas, calidad, competencia };
  }
  // De a pocas a la vez: con muchas en paralelo se pisa el límite de ML.
  for (let i = 0; i < items.length; i += EN_PARALELO) {
    await Promise.all(items.slice(i, i + EN_PARALELO).map(una));
  }
  return { ok: true, metricas };
}

export type ResultadoCompetencia =
  | { ok: true; catalogo: false }
  | { ok: true; catalogo: true; propia: FilaComparacion; competidores: FilaComparacion[]; total: number; alertas: string[] }
  | { ok: false; aviso: string };

// Fase 4 — hasta 10 vendedores del mismo producto de catálogo, comparados
// contra la publicación. Solo lectura. Las publicaciones fuera del
// catálogo devuelven catalogo=false (su comparación necesita la extensión).
export async function competenciaPublicacionAction(entrada: { cuentaMlId: string; itemId: string }): Promise<ResultadoCompetencia> {
  const ctx = await contexto("consultar");
  if (!ctx) return { ok: false, aviso: "Tu rol no tiene acceso a Optimización." };
  if (typeof entrada.itemId !== "string" || !PATRON_ID_PRODUCTO_O_ITEM.test(entrada.itemId)) return { ok: false, aviso: "No se reconoce la publicación." };
  const cuenta = await cuentaDeLaEmpresa(ctx.empresaId, entrada.cuentaMlId);
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  try {
    const token = await obtenerAccessTokenVigente(ctx.empresaId, cuenta.id);
    const producto = await productoCatalogoDeItemMl(entrada.itemId, token);
    if (!producto) return { ok: true, catalogo: false };
    const ofertas = await ofertasProductoCompetenciaMl(producto, token);
    const propiaOferta = ofertas.find((o) => o.itemId === entrada.itemId);
    const elegidas = elegirCompetidores(
      ofertas.filter((o) => o.itemId !== entrada.itemId).map((o) => ({ ...o, propia: false, titulo: null, foto: null, fotos: null, video: null, descripcion: null, reputacion: null }))
    );
    const ids = [entrada.itemId, ...elegidas.map((f) => f.itemId)];
    const fichas = await fichasPublicacionesMl(ids, token);
    // Descripción y reputación: una llamada por publicación o vendedor,
    // de a pocas a la vez.
    const descripciones = new Map<string, boolean | null>();
    for (let i = 0; i < ids.length; i += EN_PARALELO) {
      await Promise.all(ids.slice(i, i + EN_PARALELO).map(async (id) => descripciones.set(id, await tieneDescripcionMl(id, token))));
    }
    const vendedores = [...new Set(elegidas.map((f) => f.vendedorId).filter((v): v is string => v !== null))];
    const reputaciones = new Map<string, { nivel: string | null; lider: string | null } | null>();
    for (let i = 0; i < vendedores.length; i += EN_PARALELO) {
      await Promise.all(vendedores.slice(i, i + EN_PARALELO).map(async (v) => reputaciones.set(v, await reputacionVendedorMl(v, token))));
    }
    const completar = (fila: FilaComparacion & { vendedorId?: string | null }): FilaComparacion => {
      const ficha = fichas.get(fila.itemId);
      return {
        itemId: fila.itemId,
        propia: fila.propia,
        titulo: ficha?.titulo ?? null,
        foto: ficha?.foto ?? null,
        precio: fila.precio,
        precioOriginal: fila.precioOriginal,
        tipoPublicacion: fila.tipoPublicacion,
        envioGratis: fila.envioGratis,
        full: fila.full,
        fotos: ficha?.fotos ?? null,
        video: ficha?.video ?? null,
        descripcion: descripciones.get(fila.itemId) ?? null,
        reputacion: fila.vendedorId ? (reputaciones.get(fila.vendedorId) ?? null) : null,
      };
    };
    const propia = completar({
      itemId: entrada.itemId,
      propia: true,
      titulo: null,
      foto: null,
      precio: propiaOferta?.precio ?? null,
      precioOriginal: propiaOferta?.precioOriginal ?? null,
      tipoPublicacion: propiaOferta?.tipoPublicacion ?? null,
      envioGratis: propiaOferta?.envioGratis ?? null,
      full: propiaOferta?.full ?? null,
      fotos: null,
      video: null,
      descripcion: null,
      reputacion: null,
    });
    const competidores = elegidas.map(completar);
    return { ok: true, catalogo: true, propia, competidores, total: ofertas.length - (propiaOferta ? 1 : 0), alertas: alertasComparacion(propia, competidores) };
  } catch (error) {
    console.warn(`[app/panel/optimizacion] competencia ${entrada.itemId}: ${error instanceof Error ? error.name : "error"}`);
    return { ok: false, aviso: motivoCuentaSinRevisar(error) };
  }
}

export type ResultadoEstado = { ok: boolean; aviso: string; estado?: "active" | "paused" };

// Pausar o activar una publicación. Escribe en Mercado Libre: exige
// inventario/modificar y queda en auditoría.
export async function cambiarEstadoPublicacionAction(entrada: { cuentaMlId: string; itemId: string; activar: boolean }): Promise<ResultadoEstado> {
  const ctx = await contexto("modificar");
  if (!ctx) return { ok: false, aviso: "Tu rol no tiene permiso para pausar o activar publicaciones." };
  if (typeof entrada.itemId !== "string" || !PATRON_ID_PRODUCTO_O_ITEM.test(entrada.itemId)) {
    return { ok: false, aviso: "No se reconoce la publicación. Actualiza la página." };
  }
  const cuenta = await cuentaDeLaEmpresa(ctx.empresaId, entrada.cuentaMlId);
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  const activar = entrada.activar === true;

  let respuesta;
  try {
    const token = await obtenerAccessTokenVigente(ctx.empresaId, cuenta.id);
    respuesta = await actualizarItemMl(entrada.itemId, token, { status: activar ? "active" : "paused" });
  } catch (error) {
    if (error instanceof LimiteMercadoLibreError) return { ok: false, aviso: "Mercado Libre pidió esperar un momento. Intenta de nuevo." };
    return { ok: false, aviso: motivoCuentaSinRevisar(error) };
  }
  if (!respuesta.ok) {
    console.warn(`[app/panel/optimizacion] PUT /items respondió ${respuesta.status}`);
    // Mientras Mercado Libre revisa una publicación nueva no deja
    // cambiarle el estado (bug real visto en FullyLemon, 25-sep).
    if (itemNoModificablePorRevision(respuesta.textoCrudo)) {
      return { ok: false, aviso: "Mercado Libre todavía está revisando esta publicación y no deja pausarla ni activarla. Intenta en un rato." };
    }
    if (respuesta.status === 0) {
      return { ok: false, aviso: "Mercado Libre no respondió a tiempo. Revisa en Mercado Libre si el cambio se aplicó antes de reintentar." };
    }
    return { ok: false, aviso: "Mercado Libre no aceptó el cambio. Intenta de nuevo o revísalo en Mercado Libre." };
  }

  await dbComoEmpresa(ctx.empresaId, (tx) =>
    registrarCambioOptimizacion(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      cuentaMlId: cuenta.id,
      cuentaNickname: cuenta.nickname,
      accion: activar ? "activar_publicacion" : "pausar_publicacion",
      itemId: entrada.itemId,
      detalle: `${activar ? "Activó" : "Pausó"} la publicación ${entrada.itemId} de ${cuenta.nickname}.`,
    })
  ).catch((error: unknown) => {
    console.error(`[app/panel/optimizacion] Auditoría del cambio de estado falló: ${error instanceof Error ? error.name : "error"}`);
  });
  return { ok: true, aviso: activar ? "Publicación activada." : "Publicación pausada.", estado: activar ? "active" : "paused" };
}

// ---------- Fase 3: editar precio, título y fotos ----------
// Cada acción vuelve a leer la publicación en Mercado Libre justo antes
// de escribir (ventas, variantes, automatización): nunca decide con un
// dato viejo de la pantalla.

const LARGO_MAXIMO_TITULO = 100;
const LARGO_MAXIMO_URL = 500;

export type ResultadoEdicion = { ok: boolean; aviso: string };

type Preparada = {
  ctx: { empresaId: string; usuarioId: string };
  cuenta: { id: string; nickname: string; siteId: string; cuentaIdExterna: string };
  token: string;
  item: ItemEdicionMl;
};

async function prepararEdicion(cuentaMlId: string, itemId: string): Promise<Preparada | { error: string }> {
  const ctx = await contexto("modificar");
  if (!ctx) return { error: "Tu rol no tiene permiso para editar publicaciones." };
  if (typeof itemId !== "string" || !PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return { error: "No se reconoce la publicación. Actualiza la página." };
  const cuenta = await cuentaDeLaEmpresa(ctx.empresaId, cuentaMlId);
  if (!cuenta) return { error: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  let token: string;
  try {
    token = await obtenerAccessTokenVigente(ctx.empresaId, cuenta.id);
  } catch (error) {
    return { error: motivoCuentaSinRevisar(error) };
  }
  const item = await leerItemEdicionMl(itemId, token).catch(() => null);
  if (!item) return { error: "Mercado Libre no devolvió la publicación. Intenta de nuevo." };
  return { ctx, cuenta, token, item };
}

async function escribirYAuditar(
  prep: Preparada,
  cambios: Record<string, unknown>,
  auditoria: { accion: string; detalle: string; valorAnterior?: string; valorNuevo?: string },
  avisoOk: string,
  // Por defecto PUT /items/{id}; el título de «User Products» va a la familia.
  escribirMl: () => ReturnType<typeof actualizarItemMl> = () => actualizarItemMl(prep.item.id, prep.token, cambios)
): Promise<ResultadoEdicion> {
  let respuesta;
  try {
    respuesta = await escribirMl();
  } catch (error) {
    if (error instanceof LimiteMercadoLibreError) return { ok: false, aviso: "Mercado Libre pidió esperar un momento. Intenta de nuevo." };
    throw error;
  }
  if (!respuesta.ok) {
    console.warn(`[app/panel/optimizacion] PUT de ${auditoria.accion} respondió ${respuesta.status}`);
    if (itemNoModificablePorRevision(respuesta.textoCrudo)) {
      return { ok: false, aviso: "Mercado Libre todavía está revisando esta publicación y no deja cambiarla. Intenta en un rato." };
    }
    if (respuesta.status === 0) return { ok: false, aviso: "Mercado Libre no respondió a tiempo. Revisa en Mercado Libre si el cambio se aplicó antes de reintentar." };
    if (respuesta.status === 401 || respuesta.status === 403) return { ok: false, aviso: "Mercado Libre no dejó cambiar esta publicación con esta cuenta." };
    const motivo = motivoErrorEscrituraMl(respuesta.textoCrudo);
    const base = motivo ? `Mercado Libre no aceptó el cambio: ${motivo}` : "Mercado Libre no aceptó el cambio.";
    // El detalle completo (código, causas y campos) solo si agrega algo:
    // con «BODY_INVALID_FIELDS» solo no se sabe qué campo rechazó.
    const detalle = detalleErrorEscrituraMl(respuesta.textoCrudo);
    return { ok: false, aviso: detalle && detalle !== `error: ${motivo}` && detalle !== `mensaje: ${motivo}` ? `${base} (detalle para soporte: ${detalle})` : base };
  }
  await dbComoEmpresa(prep.ctx.empresaId, (tx) =>
    registrarCambioOptimizacion(tx, {
      empresaId: prep.ctx.empresaId,
      usuarioId: prep.ctx.usuarioId,
      cuentaMlId: prep.cuenta.id,
      cuentaNickname: prep.cuenta.nickname,
      accion: auditoria.accion,
      itemId: prep.item.id,
      detalle: auditoria.detalle,
      valorAnterior: auditoria.valorAnterior,
      valorNuevo: auditoria.valorNuevo,
    })
  ).catch((error: unknown) => {
    console.error(`[app/panel/optimizacion] Auditoría de ${auditoria.accion} falló: ${error instanceof Error ? error.name : "error"}`);
  });
  return { ok: true, aviso: avisoOk };
}

export async function editarPrecioAction(entrada: { cuentaMlId: string; itemId: string; precio: string }): Promise<ResultadoEdicion> {
  const prep = await prepararEdicion(entrada.cuentaMlId, entrada.itemId);
  if ("error" in prep) return { ok: false, aviso: prep.error };
  const precio = typeof entrada.precio === "string" ? leerPrecioEscrito(entrada.precio, prep.cuenta.siteId) : null;
  if (precio === null) return { ok: false, aviso: "Escribe un precio válido, mayor que cero." };
  if (prep.item.tieneVariantes) return { ok: false, aviso: "Esta publicación tiene variantes: el precio se cambia por variante en Mercado Libre." };
  const automatizada = await tieneAutomatizacionPrecioMl(prep.item.id, prep.token);
  if (automatizada === true) {
    return { ok: false, aviso: "Esta publicación tiene la automatización de precios de Mercado Libre activa: Mercado Libre no deja cambiar el precio a mano." };
  }
  const resultado = await escribirYAuditar(
    prep,
    { price: Number(precio) },
    {
      accion: "cambiar_precio_publicacion",
      detalle: `Cambió el precio de ${prep.item.id} (${prep.cuenta.nickname}).`,
      valorAnterior: prep.item.precio === null ? undefined : String(prep.item.precio),
      valorNuevo: precio,
    },
    "Precio actualizado en Mercado Libre."
  );
  // Con una promoción vigente el comprador sigue viendo el precio de la
  // promoción: se avisa para que no parezca que el cambio no se aplicó.
  if (!resultado.ok) return resultado;
  const promocion = await promocionActivaMl(prep.item.id, prep.token);
  if (!promocion) return resultado;
  return {
    ok: true,
    aviso: `Precio normal actualizado. Hay una promoción activa: el comprador ve ${formatearMoneda(promocion.precio, prep.cuenta.siteId)} hasta que termine; después verá el precio nuevo.`,
  };
}

export async function editarTituloAction(entrada: { cuentaMlId: string; itemId: string; titulo: string }): Promise<ResultadoEdicion> {
  const prep = await prepararEdicion(entrada.cuentaMlId, entrada.itemId);
  if ("error" in prep) return { ok: false, aviso: prep.error };
  const titulo = typeof entrada.titulo === "string" ? entrada.titulo.trim().replace(/\s+/g, " ") : "";
  if (!titulo) return { ok: false, aviso: "Escribe un título." };
  if (titulo.length > LARGO_MAXIMO_TITULO) return { ok: false, aviso: `El título es muy largo (máximo ${LARGO_MAXIMO_TITULO} caracteres).` };
  if (prep.item.vendidas > 0) return { ok: false, aviso: "Mercado Libre solo deja cambiar el título de publicaciones sin ventas." };
  // «User Products»: PUT /items rechaza title y family_name
  // (BODY_INVALID_FIELDS, staging 22-nov). El nombre se cambia en la
  // familia (PUT /user-products-families/{family_id}) y ML recalcula el
  // título de sus publicaciones, de forma asíncrona.
  const userProduct = prep.item.userProduct;
  const familyId = prep.item.familyId;
  if (userProduct && !familyId) return { ok: false, aviso: "Mercado Libre no devolvió la familia de esta publicación. Cambia el título en Mercado Libre." };
  return escribirYAuditar(
    prep,
    userProduct ? { family_name: titulo } : { title: titulo },
    {
      accion: "cambiar_titulo_publicacion",
      detalle: `Cambió el título de ${prep.item.id} (${prep.cuenta.nickname}).`,
      valorAnterior: prep.item.titulo ?? undefined,
      valorNuevo: titulo,
    },
    userProduct
      ? "Título enviado a Mercado Libre. Puede tardar unos minutos en verse y se aplica a todas las publicaciones de este producto."
      : "Título actualizado en Mercado Libre.",
    userProduct && familyId ? () => actualizarNombreFamiliaMl(familyId, prep.token, titulo) : undefined
  );
}

export type ResultadoMejorarTitulo =
  | { ok: true; titulos: string[]; catalogo: string | null; largoMaximo: number; largoMaximoCatalogo: number; puedeGuardar: boolean; vendidas: number }
  | { ok: false; aviso: string; conectarIA?: boolean };

// «Mejorar título» con la IA de TEXTO de la empresa (la de este módulo).
// Misma lógica y mismo prompt que Publicar → «Crear con IA» (código
// compartido en lib/publicaciones/titulos-ia.ts). Lecturas de ML:
// GET /items/{id} (prepararEdicion y category_id+attributes) y
// GET /items/{id}/description. NO escribe nada: guardar sigue siendo
// editarTituloAction, y solo si la publicación no tiene ventas.
export async function mejorarTituloIAAction(entrada: { cuentaMlId: string; itemId: string }): Promise<ResultadoMejorarTitulo> {
  const prep = await prepararEdicion(entrada.cuentaMlId, entrada.itemId);
  if ("error" in prep) return { ok: false, aviso: prep.error };
  const conexion = await obtenerConexionIAParaModulo(prep.ctx.empresaId, "optimizacion");
  if (!conexion) return { ok: false, aviso: MENSAJE_SIN_IA, conectarIA: true };
  const registrar = (paso: string, error: unknown) =>
    console.warn(`[app/panel/optimizacion] mejorar título ${paso}: ${error instanceof Error ? error.name : "error"}`);
  const [leidos, descripcion] = await Promise.all([
    leerAtributosItemMl(prep.item.id, prep.token).catch((error) => {
      registrar("atributos", error);
      return null;
    }),
    leerDescripcionItemMl(prep.item.id, prep.token).catch((error) => {
      registrar("descripcion", error);
      return null;
    }),
  ]);
  const ficha = fichaDesdeItem({ titulo: prep.item.titulo ?? "", atributos: leidos?.atributos ?? [] });
  if (!ficha) return { ok: false, aviso: "Mercado Libre no devolvió el título de la publicación. Intenta de nuevo." };
  const { idioma, pais } = idiomaDeSitio(prep.cuenta.siteId);
  try {
    const propuesta = await generarTitulosSeo({
      empresaId: prep.ctx.empresaId,
      conexion,
      cuenta: { id: entrada.cuentaMlId, siteId: prep.cuenta.siteId },
      token: () => Promise.resolve(prep.token),
      ficha,
      categoriaId: leidos?.categoriaId ?? null,
      categoriaNombre: null,
      info: infoDeDescripcion(descripcion),
      idioma,
      pais,
      registrar,
    });
    if (!propuesta) return { ok: false, aviso: "La IA no devolvió títulos usables. Intenta de nuevo." };
    return {
      ok: true,
      titulos: propuesta.titulos,
      catalogo: propuesta.catalogo,
      largoMaximo: LARGO_TITULO,
      largoMaximoCatalogo: LARGO_TITULO_CATALOGO,
      puedeGuardar: prep.item.vendidas === 0,
      vendidas: prep.item.vendidas,
    };
  } catch (error) {
    if (error instanceof LimiteMercadoLibreError) return { ok: false, aviso: "Mercado Libre pidió esperar un momento. Intenta de nuevo." };
    registrar("titulos", error);
    return { ok: false, aviso: mensajeErrorIA(error) };
  }
}

// Fotos: el orden de las que ya tiene (por id) y fotos nuevas por enlace
// https. La primera es la portada.
// El orden completo, la primera es la portada: las actuales por su id
// (solo ids que de verdad tiene la publicación) y las nuevas por su
// enlace https (subidas a Cloudinary desde la galería). Mezcladas, así
// una foto nueva puede quedar de portada.
export async function editarFotosAction(entrada: {
  cuentaMlId: string;
  itemId: string;
  fotos: ({ id: string } | { url: string })[];
  // Enlaces de la galería que salieron de «Crear imagen con IA». Solo se
  // cuentan los que de verdad van entre las fotos nuevas: nunca se confía
  // en lo que diga el navegador.
  fotosIA?: string[];
}): Promise<ResultadoEdicion> {
  const prep = await prepararEdicion(entrada.cuentaMlId, entrada.itemId);
  if ("error" in prep) return { ok: false, aviso: prep.error };
  const actuales = new Set(prep.item.fotos.map((f) => f.id));
  const vistas = new Set<string>();
  const pictures: ({ id: string } | { source: string })[] = [];
  for (const f of Array.isArray(entrada.fotos) ? entrada.fotos : []) {
    if (f && typeof f === "object" && "id" in f && typeof f.id === "string" && actuales.has(f.id)) {
      if (vistas.has(`id:${f.id}`)) continue;
      vistas.add(`id:${f.id}`);
      pictures.push({ id: f.id });
    } else if (f && typeof f === "object" && "url" in f && typeof f.url === "string") {
      const url = f.url.trim();
      if (!url.startsWith("https://") || url.length > LARGO_MAXIMO_URL || /\s/.test(url) || vistas.has(`url:${url}`)) continue;
      vistas.add(`url:${url}`);
      pictures.push({ source: url });
    }
  }
  if (pictures.length === 0) return { ok: false, aviso: "La publicación necesita al menos una foto." };
  const nuevas = pictures.filter((p) => "source" in p).length;
  const enlacesNuevos = new Set(pictures.flatMap((p) => ("source" in p ? [p.source] : [])));
  const conIA = new Set((Array.isArray(entrada.fotosIA) ? entrada.fotosIA : []).filter((u): u is string => typeof u === "string" && enlacesNuevos.has(u.trim())).map((u) => u.trim())).size;
  const antes = prep.item.fotos.map((f) => f.id);
  const despues = pictures.map((p) => ("id" in p ? p.id : p.source));
  const portadaCambio = antes[0] !== despues[0];
  return escribirYAuditar(
    prep,
    { pictures },
    {
      accion: "cambiar_fotos_publicacion",
      detalle: `Cambió las fotos de ${prep.item.id} (${prep.cuenta.nickname}): ${pictures.length - nuevas} existentes, ${nuevas} nuevas${conIA > 0 ? ` (${conIA} ${MARCA_FOTO_IA})` : ""}; ${portadaCambio ? "cambió la portada" : "misma portada"}.`,
      valorAnterior: compactarFotos(antes) || undefined,
      valorNuevo: compactarFotos(despues),
    },
    "Fotos actualizadas en Mercado Libre. Pueden tardar unos minutos en verse."
  );
}

export type ResultadoImagenIA = { ok: true; url: string; aviso: string } | { ok: false; aviso: string };

// Crea una foto con la IA de la empresa a partir de una foto real de la
// publicación (o una recién subida a Cloudinary) y la sube a Cloudinary.
// NO toca Mercado Libre: la imagen entra a la galería y solo se publica
// cuando la persona revisa y aprieta «Guardar fotos». Pide el mismo
// permiso que editar (inventario.modificar); el costo es de la cuenta
// de IA de la empresa.
export async function generarImagenIAAction(entrada: {
  cuentaMlId: string;
  itemId: string;
  fotoUrl: string;
  // Otras fotos de la galería como referencia (detalles, lo que incluye).
  referencias?: string[];
  tipo: string;
  indicaciones?: string;
  // Portada: cuál de las composiciones (cada una distinta).
  variante?: number;
  // Informativa: el contenido ya aprobado (título, copy, composición).
  contenido?: unknown;
}): Promise<ResultadoImagenIA> {
  const prep = await prepararEdicion(entrada.cuentaMlId, entrada.itemId);
  if ("error" in prep) return { ok: false, aviso: prep.error };
  if (!cloudinaryConfigurado()) return { ok: false, aviso: "Falta configurar Cloudinary en este ambiente: no hay dónde guardar la imagen." };
  const conexion = await obtenerConexionIAParaModulo(prep.ctx.empresaId, "optimizacion");
  if (!conexion) return { ok: false, aviso: "Esta empresa no tiene una IA conectada. Conecta tu IA en Administración → Conectar IA (OpenAI o Google generan imágenes)." };
  const tipo = leerTipoImagenIA(entrada.tipo);
  // Informativa: solo con contenido aprobado, revisado otra vez acá
  // (palabras prohibidas, mínimo de líneas): nunca se confía en la pantalla.
  let contenido: ContenidoImagen | null = null;
  if (tipo === "informativa") {
    contenido = limpiarContenido(entrada.contenido);
    if (!contenido) return { ok: false, aviso: "Primero propón o escribe el contenido de la imagen y apruébalo." };
    const falta = faltaParaCrear(contenido);
    if (falta) return { ok: false, aviso: falta };
  }
  try {
    const fotoUrl = typeof entrada.fotoUrl === "string" ? entrada.fotoUrl : "";
    const base = await descargarFotoBase(fotoUrl);
    // Una referencia que no baja no frena la imagen: se usa la base sola.
    const otras = (Array.isArray(entrada.referencias) ? entrada.referencias : [])
      .filter((u): u is string => typeof u === "string" && u !== fotoUrl)
      .slice(0, MAXIMO_FOTOS_REFERENCIA - 1);
    const referencias = (await Promise.all(otras.map((u) => descargarFotoBase(u).catch(() => null)))).filter((f) => f !== null);
    const variante = leerVariante(entrada.variante);
    const prompt = contenido ? promptImagenContenido(contenido, prep.item.titulo) : promptImagenIA("portada", prep.item.titulo, limpiarIndicaciones(entrada.indicaciones), variante);
    const imagen = await generarImagenDesdeFoto(conexion, [base, ...referencias], prompt);
    const nombre = contenido ? `ia-${contenido.tipo}-${prep.item.id}` : `ia-portada-${variante + 1}-${prep.item.id}`;
    const { url } = await subirACloudinary(imagen.buffer, nombre, imagen.tipo, "zilonix-optimizacion-ia");
    return { ok: true, url, aviso: "Imagen creada. Revísala: si te gusta, agrégala y guarda las fotos." };
  } catch (error) {
    if (error instanceof ErrorImagenIA) return { ok: false, aviso: error.message };
    if (error instanceof CloudinaryNoConfiguradoError) return { ok: false, aviso: "Falta configurar Cloudinary en este ambiente." };
    console.warn(`[app/panel/optimizacion] imagen IA ${prep.item.id}: ${error instanceof Error ? error.name : "error"}`);
    return { ok: false, aviso: "No se pudo crear la imagen. Intenta de nuevo." };
  }
}

export type ResultadoPropuestaContenido = { ok: true; contenido: ContenidoImagen; prohibidas: string[] } | { ok: false; aviso: string };

// Paso 1 del flujo de aprobación: la IA de TEXTO de la empresa propone
// título, copy y composición con la ficha técnica y la descripción de la
// publicación. No crea ninguna imagen ni toca Mercado Libre. «Opiniones
// reales» nunca la escribe la IA (inventar reseñas es engañoso).
export async function proponerContenidoIAAction(entrada: {
  cuentaMlId: string;
  itemId: string;
  tipoContenido: string;
  ficha?: string;
}): Promise<ResultadoPropuestaContenido> {
  const tipo = tipoContenido(entrada.tipoContenido);
  if (!tipo) return { ok: false, aviso: "Elige qué imagen quieres crear." };
  if (!tipoLoEscribeLaIA(tipo.id)) return { ok: false, aviso: "Las opiniones las pegas tú, copiadas de compradores reales: la IA no las inventa." };
  const prep = await prepararEdicion(entrada.cuentaMlId, entrada.itemId);
  if ("error" in prep) return { ok: false, aviso: prep.error };
  const conexion = await obtenerConexionIAParaModulo(prep.ctx.empresaId, "optimizacion");
  if (!conexion) return { ok: false, aviso: "Esta empresa no tiene una IA conectada. Conecta tu IA en Administración → Conectar IA (OpenAI o Google generan imágenes)." };
  const descripcion = await leerDescripcionItemMl(prep.item.id, prep.token).catch(() => null);
  try {
    const contenido = await proponerContenido(conexion, tipo.id, prep.item.titulo, limpiarIndicaciones(entrada.ficha), descripcion);
    if (!contenido) return { ok: false, aviso: "La IA no devolvió una propuesta usable. Intenta de nuevo o escríbela tú." };
    return { ok: true, contenido, prohibidas: palabrasProhibidas([contenido.titulo, ...contenido.bullets]) };
  } catch (error) {
    if (error instanceof ErrorProveedorIA) return { ok: false, aviso: error.message };
    console.warn(`[app/panel/optimizacion] propuesta IA ${prep.item.id}: ${error instanceof Error ? error.name : "error"}`);
    return { ok: false, aviso: "No se pudo proponer el contenido. Intenta de nuevo." };
  }
}

// ---------- Bitácora: notas a mano y revisión de cada cambio (0035) ----------

export type ResultadoBitacora = { ok: true; aviso: string } | { ok: false; aviso: string };

// Nota a mano para un cambio hecho fuera de Zilonix (directo en Mercado
// Libre, publicidad…). Mismo permiso que editar; la publicación se
// confirma con Mercado Libre (prepararEdicion) y debe ser de esa cuenta
// (seller_id = cuenta_id_externa).
export async function guardarNotaBitacoraAction(entrada: { cuentaMlId: string; itemId: string; fecha: string; texto: string }): Promise<ResultadoBitacora> {
  const prep = await prepararEdicion(entrada.cuentaMlId, entrada.itemId);
  if ("error" in prep) return { ok: false, aviso: prep.error };
  if (prep.item.sellerId !== prep.cuenta.cuentaIdExterna) return { ok: false, aviso: "Esa publicación no es de esta cuenta de Mercado Libre." };
  const texto = limpiarTextoBitacora(entrada.texto);
  if (!texto) return { ok: false, aviso: "Escribe qué cambiaste." };
  const fecha = leerFechaNota(entrada.fecha, hoyBogota(new Date()));
  if (!fecha) return { ok: false, aviso: "Elige una fecha de los últimos 150 días (no en el futuro)." };
  await crearNotaBitacora(prep.ctx.empresaId, { usuarioId: prep.ctx.usuarioId, cuentaMlId: entrada.cuentaMlId, itemId: prep.item.id, fechaCambio: fecha, texto });
  return { ok: true, aviso: "Nota guardada en la bitácora. A los 7 días verás su resultado." };
}

// «Revisado»: el resultado de un cambio (sirvió / no sirvió / sin cambio)
// con un comentario. Se puede volver a revisar (se actualiza). Sin
// resultado se guarda solo el comentario y el cambio sigue sin revisar.
export async function revisarCambioAction(entrada: { cuentaMlId: string; itemId: string; ref: string; resultado: string; comentario?: string }): Promise<ResultadoBitacora> {
  const ctx = await contexto("modificar");
  if (!ctx) return { ok: false, aviso: "Tu rol no tiene permiso para revisar cambios." };
  if (typeof entrada.itemId !== "string" || !PATRON_ID_PRODUCTO_O_ITEM.test(entrada.itemId)) return { ok: false, aviso: "No se reconoce la publicación." };
  if (!(await cuentaDeLaEmpresa(ctx.empresaId, entrada.cuentaMlId))) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  const resultado = entrada.resultado ? leerResultadoRevision(entrada.resultado) : null;
  if (entrada.resultado && !resultado) return { ok: false, aviso: "Elige si el cambio sirvió, no sirvió o no cambió nada." };
  const comentario = limpiarTextoBitacora(entrada.comentario) || null;
  if (!resultado && !comentario) return { ok: false, aviso: "Elige un resultado o escribe un comentario." };
  if (typeof entrada.ref !== "string" || !(await cambioEsDeLaPublicacion(ctx.empresaId, entrada.ref, entrada.itemId))) return { ok: false, aviso: "No se encontró ese cambio." };
  await guardarRevisionCambio(ctx.empresaId, { usuarioId: ctx.usuarioId, ref: entrada.ref, itemId: entrada.itemId, resultado, comentario });
  return { ok: true, aviso: resultado ? "Revisión guardada." : "Comentario guardado. Elige un resultado para dar el cambio por revisado." };
}

// ---------- Bitácora general: resultado al día 8, bajo demanda ----------

export type FilaResultadoGeneral = { visitas: number | null; ventas: number; conversion: string | null; utilidad: string | null };
export type ResultadoBitacoraGeneral =
  | { ok: false; aviso: string }
  | { ok: true; estado: "midiendo"; faltanDias: number }
  | { ok: true; estado: "listo"; desde: string; hasta: string; conFinanzas: boolean; antes: FilaResultadoGeneral; despues: FilaResultadoGeneral };

function filaResultado(r: ResumenPeriodo, siteId: string, conFinanzas: boolean): FilaResultadoGeneral {
  return {
    visitas: r.visitas,
    ventas: r.pedidos,
    conversion: r.conversion,
    utilidad: conFinanzas && r.ganancia !== null ? formatearMoneda(Number(r.ganancia), siteId) : null,
  };
}

// Calcula el resultado (7 días antes vs. 7 días después) de UNA fila de la
// bitácora general. Es la única llamada a Mercado Libre de esa vista:
// solo al pulsar «Ver resultado». Verifica que el cambio sea de la
// publicación (nunca se confía en la referencia del navegador).
export async function bitacoraGeneralResultadoAction(entrada: { cuentaMlId: string; itemId: string; ref: string }): Promise<ResultadoBitacoraGeneral> {
  const ctx = await contexto("consultar");
  if (!ctx) return { ok: false, aviso: "Tu rol no tiene permiso para ver Optimización." };
  if (typeof entrada.itemId !== "string" || !PATRON_ID_PRODUCTO_O_ITEM.test(entrada.itemId) || typeof entrada.ref !== "string") {
    return { ok: false, aviso: "No se reconoce el cambio. Actualiza la página." };
  }
  const cuenta = await cuentaDeLaEmpresa(ctx.empresaId, entrada.cuentaMlId);
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  if (!(await cambioEsDeLaPublicacion(ctx.empresaId, entrada.ref, entrada.itemId))) return { ok: false, aviso: "No se encontró ese cambio. Actualiza la página." };
  // El día del cambio sale de la auditoría o de la nota, no del navegador.
  const dia = await diaDelCambio(ctx.empresaId, entrada.ref);
  if (!dia) return { ok: false, aviso: "No se encontró ese cambio. Actualiza la página." };
  const ahora = new Date();
  const hoy = hoyBogota(ahora);
  const adelanto = resultadoCambio(dia, hoy, { lineas: [], publicidad: [], visitasPorDia: null, visitasDesde: hoy, conFinanzas: false });
  if (adelanto.estado === "midiendo") return { ok: true, estado: "midiendo", faltanDias: adelanto.faltanDias };
  const membresia = await obtenerMiMembresia(ctx.usuarioId, ctx.empresaId);
  const conFinanzas = membresia ? tienePermiso(membresia.permisos, "finanzas", "consultar") : false;
  try {
    const datos = await leerDatosDetalle(ctx.empresaId, cuenta, entrada.itemId, resolverPeriodoDetalle(undefined, ahora), { conFinanzas, ahora });
    if (!datos) return { ok: false, aviso: "Mercado Libre no devolvió la publicación. Intenta de nuevo." };
    const r = resultadoCambio(dia, hoy, { lineas: datos.lineas, publicidad: datos.publicidad, visitasPorDia: datos.visitasPorDia, visitasDesde: datos.visitasDesde, conFinanzas });
    if (r.estado === "midiendo") return { ok: true, estado: "midiendo", faltanDias: r.faltanDias };
    return { ok: true, estado: "listo", desde: r.desde, hasta: r.hasta, conFinanzas, antes: filaResultado(r.antes, cuenta.siteId, conFinanzas), despues: filaResultado(r.despues, cuenta.siteId, conFinanzas) };
  } catch (error) {
    console.warn(`[app/panel/optimizacion] resultado de bitácora ${entrada.itemId}: ${error instanceof Error ? error.name : "error"}`);
    return { ok: false, aviso: motivoCuentaSinRevisar(error) };
  }
}
