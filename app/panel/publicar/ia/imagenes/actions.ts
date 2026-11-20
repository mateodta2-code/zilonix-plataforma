"use server";

import { cookies } from "next/headers";
import { CloudinaryNoConfiguradoError, cloudinaryConfigurado, subirACloudinary, TRANSFORMACION_500 } from "@/lib/cloudinary";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerConexionIAParaModulo } from "@/lib/ia/conexion";
import { descargarFotoBase, ErrorImagenIA, generarImagenDesdeFoto, MAXIMO_FOTOS_REFERENCIA, proveedorGeneraImagenes } from "@/lib/ia/imagen";
import { asignarComposiciones, otraComposicion, type Asignacion } from "@/lib/ia/prompts/composiciones";
import { datosProductoDesdeFicha } from "@/lib/ia/prompts/datosProducto";
import { tipoExpertoDisponible, TIPOS_EXPERTO_ML, type TipoExpertoML } from "@/lib/ia/prompts/estiloExpertoML";
import { esEstiloImagen, type EstiloImagen } from "@/lib/ia/prompts/index";
import {
  leerOpinionesReales,
  leerPropuestaContenidoZilonix,
  promptPropuestaContenidoZilonix,
  revisarCopySeguro,
  tipoContenidoDisponible,
  TIPOS_CONTENIDO_ZILONIX,
  type TipoContenidoZilonix,
} from "@/lib/ia/prompts/zilonix-contenido";
import { llamarIA } from "@/lib/ia/proveedores";
import { diagnosticarImagenMl, PATRON_ID_CATEGORIA } from "@/lib/ml/cliente";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import {
  actualizarPropuestaIA,
  crearImagenesIA,
  crearTrabajoIA,
  leerImagenIA,
  leerTrabajoIA,
  terminarImagenIA,
  tomarCupoImagen,
} from "@/lib/publicaciones/cola";
import { mensajeErrorIA, MENSAJE_IA_SIN_IMAGENES, MENSAJE_SIN_IA, MENSAJE_SIN_IA_IMAGENES } from "@/lib/publicaciones/errores";
import { fichaConfirmada, leerFicha } from "@/lib/publicaciones/ficha";
import { conCupoDeTexto } from "@/lib/publicaciones/freno";
import {
  faltaParaCrearImagen,
  leerPropuestaPortada,
  leerPropuestaTextos,
  leerTextosIA,
  promptDeImagen,
  promptTextosExperto,
  resumenDiagnostico,
  TIPO_FOTO_PRINCIPAL,
  TIPO_PORTADA,
  type PropuestaTextos,
} from "@/lib/publicaciones/imagenesIA";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Publicar → «Crear con IA» (PR2, imágenes). Mismo permiso que publicar
// (inventario/crear). Texto con la IA del módulo «publicaciones»;
// imágenes con la del módulo «generacion_imagenes» (Conectar IA). Nada se
// publica: las imágenes van a la galería del borrador cuando la persona
// lo pide. Cola: máximo 2 generando por empresa (lib/publicaciones/cola.ts).

const CARPETA = "zilonix-publicaciones-ia";
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Fallo = { ok: false; aviso: string; conectarIA?: boolean };

async function sesion(): Promise<{ usuarioId: string; empresaId: string } | Fallo> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return { ok: false, aviso: "Inicia sesión de nuevo." };
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const actual = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === actual) ?? propias[0];
  if (!empresa) return { ok: false, aviso: "No se encontró tu empresa activa." };
  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, aviso: "Tu rol no tiene permiso para crear publicaciones." };
    throw error;
  }
  return { usuarioId: usuario.id, empresaId: empresa.id };
}

function registrar(paso: string, error: unknown) {
  console.warn(`[app/panel/publicar/ia/imagenes] ${paso}: ${error instanceof Error ? error.name : "error"}`);
}

export type PropuestaImagen = {
  id: string;
  tipo: string;
  nombre: string;
  cuentaMlId: string | null;
  propuesta: Record<string, unknown>;
  prompt: string;
  prohibidas: string[];
};

export type ResultadoPreparar = { ok: true; trabajoId: string; imagenes: PropuestaImagen[]; omitidas: string[] } | Fallo;

// Paso 1: las propuestas (sin costo de imágenes). Portadas: una por cada
// cuenta destino, con su pareja composición + escena. Contenido y Experto:
// la IA de texto propone título y copy. Nada se genera aquí.
export async function prepararImagenesAction(entrada: {
  estilo: string;
  cuentaMlIds: string[];
  ficha: unknown;
  tipos?: string[];
  opiniones?: string;
  incluirFotoBlanco?: boolean;
  previas?: Record<string, Asignacion>;
}): Promise<ResultadoPreparar> {
  const s = await sesion();
  if ("ok" in s) return s;
  if (!esEstiloImagen(entrada.estilo)) return { ok: false, aviso: "Elige un estilo de imagen." };
  const estilo: EstiloImagen = entrada.estilo;
  const ficha = leerFicha(entrada.ficha);
  if (!fichaConfirmada(ficha)) return { ok: false, aviso: "Confirma la ficha del producto en «Crear con IA» antes de generar imágenes." };
  const conectadas = (await listarCuentasConectadas(s.empresaId)).filter((c) => !c.desconectadaTs);
  const cuentas = (Array.isArray(entrada.cuentaMlIds) ? entrada.cuentaMlIds : [])
    .filter((id): id is string => typeof id === "string" && PATRON_UUID.test(id))
    .map((id) => conectadas.find((c) => c.id === id))
    .filter((c) => c !== undefined);
  if (cuentas.length === 0) return { ok: false, aviso: "Marca al menos una cuenta destino." };
  const conexionImagenes = await obtenerConexionIAParaModulo(s.empresaId, "generacion_imagenes");
  if (!conexionImagenes) return { ok: false, aviso: MENSAJE_SIN_IA_IMAGENES, conectarIA: true };
  if (!proveedorGeneraImagenes(conexionImagenes.proveedor)) return { ok: false, aviso: MENSAJE_IA_SIN_IMAGENES, conectarIA: true };

  const principal = cuentas[0];
  const datos = datosProductoDesdeFicha(ficha, principal.siteId);
  const omitidas: string[] = [];
  const propuestas: { tipo: string; nombre: string; cuentaMlId: string | null; propuesta: Record<string, unknown> }[] = [];

  if (estilo === "zilonix_portadas") {
    const asignadas = asignarComposiciones(
      cuentas.map((c) => c.id),
      entrada.previas ?? {}
    );
    cuentas.forEach((c, i) =>
      propuestas.push({ tipo: TIPO_PORTADA, nombre: `Portada · ${c.nickname}`, cuentaMlId: c.id, propuesta: { cuentaMlId: c.id, indice: i + 1, cantidad: cuentas.length, asignacion: asignadas[c.id] } })
    );
  } else {
    const conexionTexto = await obtenerConexionIAParaModulo(s.empresaId, "publicaciones");
    if (!conexionTexto) return { ok: false, aviso: MENSAJE_SIN_IA, conectarIA: true };
    const pedidos = new Set(Array.isArray(entrada.tipos) ? entrada.tipos : []);
    const opiniones = leerOpinionesReales(entrada.opiniones);
    try {
      if (estilo === "zilonix_contenido") {
        for (const t of TIPOS_CONTENIDO_ZILONIX) {
          if (!pedidos.has(t.id)) continue;
          const disponible = tipoContenidoDisponible(t.id, datos, opiniones);
          if (!disponible.ok) {
            omitidas.push(`${t.nombre}: ${disponible.motivo}`);
            continue;
          }
          const extra = t.id === "opiniones_reales" ? `\nOpiniones reales del vendedor:\n${opiniones.map((o) => `- ${o}`).join("\n")}` : "";
          const respuesta = await conCupoDeTexto(s.empresaId, () => llamarIA(conexionTexto, promptPropuestaContenidoZilonix(t.id, datos, "") + extra, { maxTokens: 700 }));
          const p = leerPropuestaContenidoZilonix(t.id, respuesta);
          if (p) propuestas.push({ tipo: t.id, nombre: t.nombre, cuentaMlId: null, propuesta: { titulo: p.titulo, copy: t.id === "opiniones_reales" ? opiniones : p.copy, composicion: p.composicion } });
          else omitidas.push(`${t.nombre}: la IA no devolvió una propuesta usable.`);
        }
      } else {
        for (const t of TIPOS_EXPERTO_ML) {
          if (!pedidos.has(t.id)) continue;
          const disponible = tipoExpertoDisponible(t.id, datos);
          if (!disponible.ok) {
            omitidas.push(`${t.nombre}: ${disponible.motivo}`);
            continue;
          }
          const p = leerTextosIA(await conCupoDeTexto(s.empresaId, () => llamarIA(conexionTexto, promptTextosExperto(t.id, datos, ""), { maxTokens: 400 })));
          if (p) propuestas.push({ tipo: t.id, nombre: t.nombre, cuentaMlId: null, propuesta: { titulo: p.titulo, copy: p.copy } });
          else omitidas.push(`${t.nombre}: la IA no devolvió una propuesta usable.`);
        }
      }
    } catch (error) {
      registrar("propuestas", error);
      return { ok: false, aviso: mensajeErrorIA(error) };
    }
  }
  if (entrada.incluirFotoBlanco === true) propuestas.push({ tipo: TIPO_FOTO_PRINCIPAL, nombre: "Foto sobre blanco", cuentaMlId: null, propuesta: {} });
  if (propuestas.length === 0) return { ok: false, aviso: omitidas[0] ?? "Elige al menos una imagen." };

  const trabajoId = await crearTrabajoIA(s.empresaId, {
    usuarioId: s.usuarioId,
    cuentaMlId: principal.id,
    siteId: principal.siteId,
    estilo,
    ficha,
    proveedor: conexionImagenes.proveedor,
    modelo: conexionImagenes.proveedor === "openai" ? "gpt-image-1" : "gemini-2.5-flash-image",
  });
  const ids = await crearImagenesIA(
    s.empresaId,
    trabajoId,
    propuestas.map((p, orden) => ({ tipo: p.tipo, orden, cuentaMlId: p.cuentaMlId, propuesta: p.propuesta }))
  );
  return {
    ok: true,
    trabajoId,
    omitidas,
    imagenes: propuestas.map((p, i) => {
      const textos = leerPropuestaTextos(p.propuesta);
      return {
        id: ids[i],
        tipo: p.tipo,
        nombre: p.nombre,
        cuentaMlId: p.cuentaMlId,
        propuesta: p.propuesta,
        prompt: promptDeImagen(estilo, p.tipo, p.propuesta, datos) ?? "",
        prohibidas: textos ? revisarCopySeguro([textos.titulo, ...textos.copy]) : [],
      };
    }),
  };
}

export type ResultadoAjuste = { ok: true; propuesta: Record<string, unknown>; prompt: string; prohibidas: string[] } | Fallo;

// «Ajustar»: rehace la propuesta (sin generar imagen). Portadas: otra
// composición que ninguna otra cuenta use. Contenido/Experto: la IA de
// texto con el cambio pedido.
export async function ajustarImagenAction(entrada: { imagenId: string; ajuste?: string; asignadas?: Record<string, Asignacion>; opiniones?: string }): Promise<ResultadoAjuste> {
  const s = await sesion();
  if ("ok" in s) return s;
  if (typeof entrada.imagenId !== "string" || !PATRON_UUID.test(entrada.imagenId)) return { ok: false, aviso: "No se encontró la imagen." };
  const imagen = await leerImagenIA(s.empresaId, entrada.imagenId);
  const trabajo = imagen ? await leerTrabajoIA(s.empresaId, imagen.trabajoId) : null;
  if (!imagen || !trabajo || !esEstiloImagen(trabajo.estilo)) return { ok: false, aviso: "No se encontró la imagen." };
  const datos = datosProductoDesdeFicha(leerFicha(trabajo.ficha), trabajo.siteId);
  let propuesta: Record<string, unknown>;
  if (imagen.tipo === TIPO_PORTADA) {
    const actual = leerPropuestaPortada(imagen.propuesta);
    if (!actual) return { ok: false, aviso: "No se encontró la imagen." };
    const asignadas = { ...(entrada.asignadas ?? {}), [actual.cuentaMlId]: actual.asignacion };
    propuesta = { ...actual, asignacion: otraComposicion(actual.cuentaMlId, asignadas) };
  } else if (imagen.tipo === TIPO_FOTO_PRINCIPAL) {
    return { ok: false, aviso: "La foto sobre blanco no tiene nada que ajustar." };
  } else {
    const conexionTexto = await obtenerConexionIAParaModulo(s.empresaId, "publicaciones");
    if (!conexionTexto) return { ok: false, aviso: MENSAJE_SIN_IA, conectarIA: true };
    const ajuste = typeof entrada.ajuste === "string" ? entrada.ajuste.trim().slice(0, 300) : "";
    try {
      let p: PropuestaTextos | null;
      if (trabajo.estilo === "zilonix_contenido") {
        const tipo = imagen.tipo as TipoContenidoZilonix;
        const opiniones = leerOpinionesReales(entrada.opiniones);
        // Sin opiniones reales no se ajusta: la IA terminaría escribiéndolas.
        if (tipo === "opiniones_reales" && opiniones.length === 0) {
          return { ok: false, aviso: "Pega opiniones reales de tus compradores para ajustar esta imagen. La IA no las escribe." };
        }
        const extra = tipo === "opiniones_reales" ? `\nOpiniones reales del vendedor:\n${opiniones.map((o) => `- ${o}`).join("\n")}` : "";
        const c = leerPropuestaContenidoZilonix(tipo, await conCupoDeTexto(s.empresaId, () => llamarIA(conexionTexto, promptPropuestaContenidoZilonix(tipo, datos, ajuste) + extra, { maxTokens: 700 })));
        p = c ? { titulo: c.titulo, copy: tipo === "opiniones_reales" ? opiniones : c.copy, composicion: c.composicion } : null;
      } else {
        p = leerTextosIA(await conCupoDeTexto(s.empresaId, () => llamarIA(conexionTexto, promptTextosExperto(imagen.tipo as TipoExpertoML, datos, ajuste), { maxTokens: 400 })));
      }
      if (!p) return { ok: false, aviso: "La IA no devolvió una propuesta usable. Intenta de nuevo." };
      propuesta = { ...p };
    } catch (error) {
      registrar("ajuste", error);
      return { ok: false, aviso: mensajeErrorIA(error) };
    }
  }
  await actualizarPropuestaIA(s.empresaId, imagen.id, propuesta);
  const textos = leerPropuestaTextos(propuesta);
  return {
    ok: true,
    propuesta,
    prompt: promptDeImagen(trabajo.estilo, imagen.tipo, propuesta, datos) ?? "",
    prohibidas: textos ? revisarCopySeguro([textos.titulo, ...textos.copy]) : [],
  };
}

export type ResultadoCrear =
  | { ok: true; estado: "lista"; url: string; validada: boolean; avisos: string[] }
  | { ok: true; estado: "en_cola" | "en_curso" }
  | Fallo;

// «Crear» (o «Regenerar»): solo con una propuesta aprobada y revisada en
// el servidor. Si la empresa ya tiene 2 generando, queda en cola y la
// pantalla la vuelve a pedir sola.
export async function crearImagenAction(entrada: { imagenId: string; propuesta?: unknown; fotos: string[]; categoriaId?: string | null }): Promise<ResultadoCrear> {
  const s = await sesion();
  if ("ok" in s) return s;
  if (!cloudinaryConfigurado()) return { ok: false, aviso: "Falta configurar Cloudinary en este ambiente: no hay dónde guardar la imagen." };
  if (typeof entrada.imagenId !== "string" || !PATRON_UUID.test(entrada.imagenId)) return { ok: false, aviso: "No se encontró la imagen." };
  const imagen = await leerImagenIA(s.empresaId, entrada.imagenId);
  const trabajo = imagen ? await leerTrabajoIA(s.empresaId, imagen.trabajoId) : null;
  if (!imagen || !trabajo || !esEstiloImagen(trabajo.estilo)) return { ok: false, aviso: "No se encontró la imagen." };
  const conexion = await obtenerConexionIAParaModulo(s.empresaId, "generacion_imagenes");
  if (!conexion) return { ok: false, aviso: MENSAJE_SIN_IA_IMAGENES, conectarIA: true };
  if (!proveedorGeneraImagenes(conexion.proveedor)) return { ok: false, aviso: MENSAJE_IA_SIN_IMAGENES, conectarIA: true };

  // La persona pudo editar título y copy: se revisa otra vez aquí.
  let propuesta: unknown = imagen.propuesta;
  if (entrada.propuesta !== undefined && imagen.tipo !== TIPO_PORTADA && imagen.tipo !== TIPO_FOTO_PRINCIPAL) {
    const editada = leerPropuestaTextos(entrada.propuesta);
    if (!editada) return { ok: false, aviso: "Falta el título de la imagen." };
    propuesta = { ...editada, composicion: editada.composicion ?? leerPropuestaTextos(imagen.propuesta)?.composicion };
  }
  const falta = faltaParaCrearImagen(trabajo.estilo, imagen.tipo, propuesta);
  if (falta) return { ok: false, aviso: falta };
  if (propuesta !== imagen.propuesta) await actualizarPropuestaIA(s.empresaId, imagen.id, propuesta as Record<string, unknown>);
  const datos = datosProductoDesdeFicha(leerFicha(trabajo.ficha), trabajo.siteId);
  const prompt = promptDeImagen(trabajo.estilo, imagen.tipo, propuesta, datos);
  if (!prompt) return { ok: false, aviso: "No se pudo armar la imagen. Prepara las propuestas de nuevo." };

  const cupo = await tomarCupoImagen(s.empresaId, imagen.id);
  if (cupo === "no_existe") return { ok: false, aviso: "No se encontró la imagen." };
  if (cupo !== "tomado") return { ok: true, estado: cupo };

  try {
    const urls = (Array.isArray(entrada.fotos) ? entrada.fotos : []).filter((u): u is string => typeof u === "string").slice(0, MAXIMO_FOTOS_REFERENCIA);
    const fotos = (await Promise.all(urls.map((u) => descargarFotoBase(u).catch(() => null)))).filter((f) => f !== null);
    if (fotos.length === 0) {
      await terminarImagenIA(s.empresaId, imagen.id, { error: true });
      return { ok: false, aviso: "Agrega al menos una foto real del producto en la galería: la IA la usa como referencia." };
    }
    const generada = await generarImagenDesdeFoto(conexion, fotos, prompt);
    const { url } = await subirACloudinary(generada.buffer, `ia-${imagen.tipo}-${imagen.id.slice(0, 8)}`, generada.tipo, CARPETA, TRANSFORMACION_500);

    // Diagnóstico de Mercado Libre: solo informa, nunca bloquea.
    let diagnostico = resumenDiagnostico(0, null);
    const categoriaId = typeof entrada.categoriaId === "string" && PATRON_ID_CATEGORIA.test(entrada.categoriaId) ? entrada.categoriaId : null;
    const cuentaDiagnostico = imagen.cuentaMlId ?? trabajo.cuentaMlId;
    if (categoriaId && cuentaDiagnostico) {
      try {
        const token = await obtenerAccessTokenVigente(s.empresaId, cuentaDiagnostico);
        const esFotoUno = imagen.tipo === TIPO_PORTADA || imagen.orden === 0;
        const r = await diagnosticarImagenMl(url, categoriaId, esFotoUno ? "thumbnail" : "other", token);
        diagnostico = resumenDiagnostico(r.status, r.data);
      } catch (error) {
        registrar("diagnostico", error);
      }
    }
    await terminarImagenIA(s.empresaId, imagen.id, { url, diagnostico });
    return { ok: true, estado: "lista", url, validada: diagnostico.validado, avisos: diagnostico.avisos };
  } catch (error) {
    await terminarImagenIA(s.empresaId, imagen.id, { error: true }).catch(() => undefined);
    if (error instanceof ErrorImagenIA) return { ok: false, aviso: error.message };
    if (error instanceof CloudinaryNoConfiguradoError) return { ok: false, aviso: "Falta configurar Cloudinary en este ambiente." };
    registrar("crear", error);
    return { ok: false, aviso: "No se pudo crear la imagen. Intenta de nuevo." };
  }
}
