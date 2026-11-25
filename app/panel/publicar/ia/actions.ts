"use server";

import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerConexionIAParaModulo } from "@/lib/ia/conexion";
import { descargarFotoBase } from "@/lib/ia/imagen";
import { llamarIA, type ImagenIA } from "@/lib/ia/proveedores";
import type { ConexionIAConClave } from "@/lib/ia/tipos";
import { tendenciasPorNivelMl, titulosMasVendidosMl, tituloPublicacionMl } from "@/lib/ml/cliente";
import { esLinkCortoMl, idCompetenciaDesdeLink, limpiarTituloCompetencia } from "@/lib/publicaciones/competencia";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { resolverCategoria } from "@/lib/ml/publicar";
import { analizarProducto, ErrorAnalisisIA, ESPERA_TEXTO_MS } from "@/lib/publicaciones/analisis";
import { armarDescripcion, leerPartesDescripcion, limpiarPalabrasClave, promptDescripcion } from "@/lib/publicaciones/descripcion";
import { mensajeErrorIA, MENSAJE_SIN_IA } from "@/lib/publicaciones/errores";
import { fichaConfirmada, fichaEnTexto, idiomaDeSitio, leerFicha, limpiarInfoVendedor, LARGO_GARANTIA, MAXIMO_FOTOS_ANALISIS, type Ficha } from "@/lib/publicaciones/ficha";
import { conCupoDeTexto } from "@/lib/publicaciones/freno";
import { filtrarTendenciasRelacionadas, leerPropuestaTitulos, ORDEN_PARA_IA, promptTitulos, unirTendenciasPorNivel, type PalabraClave, type TendenciaConNivel } from "@/lib/publicaciones/titulos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Publicar → «Crear con IA» (PR1, textos): análisis del producto, títulos
// SEO y descripción con la IA de TEXTO de la empresa (módulo
// «publicaciones» de Conectar IA; Zilonix no pone IA). Mismo permiso que
// publicar (inventario/crear). Nada se escribe en Mercado Libre: el
// resultado solo llena el borrador cuando la persona lo pide.

type Contexto = { empresaId: string; conexion: ConexionIAConClave; cuenta: { id: string; siteId: string }; idioma: string; pais: string };
type Fallo = { ok: false; aviso: string; conectarIA?: boolean };

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function preparar(cuentaMlId: unknown): Promise<Contexto | Fallo> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return { ok: false, aviso: "Inicia sesión de nuevo." };
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaActual = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaActual) ?? propias[0];
  if (!empresa) return { ok: false, aviso: "No se encontró tu empresa activa." };
  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, aviso: "Tu rol no tiene permiso para crear publicaciones." };
    throw error;
  }
  if (typeof cuentaMlId !== "string" || !PATRON_UUID.test(cuentaMlId)) return { ok: false, aviso: "Elige la cuenta de Mercado Libre de destino." };
  const cuenta = (await listarCuentasConectadas(empresa.id)).find((c) => c.id === cuentaMlId && !c.desconectadaTs);
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  const conexion = await obtenerConexionIAParaModulo(empresa.id, "publicaciones");
  if (!conexion) return { ok: false, aviso: MENSAJE_SIN_IA, conectarIA: true };
  const { idioma, pais } = idiomaDeSitio(cuenta.siteId);
  return { empresaId: empresa.id, conexion, cuenta: { id: cuenta.id, siteId: cuenta.siteId }, idioma, pais };
}

function registrar(paso: string, error: unknown) {
  // Solo el nombre del error: nunca el mensaje del proveedor (podría traer datos).
  console.warn(`[app/panel/publicar/ia] ${paso}: ${error instanceof Error ? error.name : "error"}`);
}

export type ResultadoAnalisis =
  | { ok: true; ficha: Ficha; leyoFotos: boolean; categoria: { id: string; nombre: string } | null; idioma: string }
  | Fallo;

// Paso 1: la ficha. Fotos: las de la galería del borrador (Cloudinary o
// Mercado Libre, mismas reglas que Optimización); una que no baja se salta.
export async function analizarProductoAction(entrada: { cuentaMlId: string; fotos?: string[]; info?: string }): Promise<ResultadoAnalisis> {
  const ctx = await preparar(entrada.cuentaMlId);
  if ("ok" in ctx) return ctx;
  const urls = (Array.isArray(entrada.fotos) ? entrada.fotos : []).filter((u): u is string => typeof u === "string").slice(0, MAXIMO_FOTOS_ANALISIS);
  const fotos: ImagenIA[] = (await Promise.all(urls.map((u) => descargarFotoBase(u).catch(() => null))))
    .filter((f) => f !== null)
    .map((f) => ({ mediaType: f.tipo, base64: f.buffer.toString("base64") }));
  const info = limpiarInfoVendedor(entrada.info);
  if (fotos.length === 0 && !info) return { ok: false, aviso: "Agrega fotos del producto o escribe qué es en «Información del producto»." };
  try {
    const { ficha, leyoFotos } = await conCupoDeTexto(ctx.empresaId, () => analizarProducto(ctx.conexion, { idioma: ctx.idioma, pais: ctx.pais, info, fotos }));
    let categoria: { id: string; nombre: string } | null = null;
    try {
      const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuenta.id);
      const c = await resolverCategoria(ctx.cuenta.siteId, ficha.nombre.valor ?? "", token);
      categoria = { id: c.categoryId, nombre: c.categoryName };
    } catch (error) {
      registrar("categoria", error);
    }
    return { ok: true, ficha, leyoFotos, categoria, idioma: ctx.idioma };
  } catch (error) {
    if (error instanceof ErrorAnalisisIA) return { ok: false, aviso: error.message };
    registrar("analisis", error);
    return { ok: false, aviso: mensajeErrorIA(error) };
  }
}

export type ResultadoTitulos =
  | {
      ok: true;
      titulos: string[];
      catalogo: string | null;
      palabras: PalabraClave[];
      conTendencias: boolean;
      // «Más buscados en la categoría»: tendencias de la categoría general,
      // la padre y la específica, con su nivel, y la ruta analizada.
      masBuscados: TendenciaConNivel[];
      rutaCategoria: string[];
      // true = ML devolvió tendencias, pero ninguna se relaciona con el
      // producto (solo había de la categoría general o la padre).
      tendenciasSinRelacion: boolean;
      // Título de la competencia usado como idea (link o pegado a mano) y,
      // si el link no se pudo leer, el aviso para pegarlo a mano.
      competencia: { titulo: string | null; aviso: string | null };
      // Títulos de los más vendidos de la categoría (o de la padre, si la
      // específica no tiene), dados a la IA como idea de palabras (25-nov).
      masVendidos: { titulos: string[]; dePadre: boolean };
    }
  | Fallo;

// Paso 2: títulos, solo con la ficha confirmada (se revisa otra vez acá).
export async function proponerTitulosAction(entrada: {
  cuentaMlId: string;
  ficha: unknown;
  categoriaId?: string | null;
  categoriaNombre?: string | null;
  info?: string;
  linkCompetencia?: string;
  tituloCompetencia?: string;
}): Promise<ResultadoTitulos> {
  const ficha = leerFicha(entrada.ficha);
  if (!fichaConfirmada(ficha)) return { ok: false, aviso: "Confirma la ficha antes de pedir títulos." };
  const ctx = await preparar(entrada.cuentaMlId);
  if ("ok" in ctx) return ctx;
  let masBuscados: TendenciaConNivel[] = [];
  let rutaCategoria: string[] = [];
  let tendenciasSinRelacion = false;
  let masVendidos: { titulos: string[]; dePadre: boolean } = { titulos: [], dePadre: false };
  if (typeof entrada.categoriaId === "string" && entrada.categoriaId) {
    // Más vendidos: automático, no necesita que la persona pegue nada.
    try {
      const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuenta.id);
      const r = await titulosMasVendidosMl(ctx.cuenta.siteId, entrada.categoriaId, token);
      masVendidos = { titulos: r.titulos.map(limpiarTituloCompetencia).filter(Boolean), dePadre: r.categoriaId !== null && r.categoriaId !== entrada.categoriaId };
    } catch (error) {
      registrar("mas_vendidos", error);
    }
    try {
      const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuenta.id);
      const r = await tendenciasPorNivelMl(ctx.cuenta.siteId, entrada.categoriaId, token);
      rutaCategoria = r.ruta;
      // Solo los VALORES de la ficha (sin las etiquetas «Nombre del producto»,
      // «Color»…, que harían coincidir cualquier búsqueda).
      const valores = Object.values(ficha).map((c) => (Array.isArray(c.valor) ? c.valor.join(" ") : (c.valor ?? "")));
      const textoProducto = `${valores.join(" ")} ${limpiarInfoVendedor(entrada.info)}`;
      const nombreCategoria = entrada.categoriaNombre ?? r.ruta[r.ruta.length - 1] ?? "";
      const relacionadas = filtrarTendenciasRelacionadas(r.niveles, textoProducto, nombreCategoria);
      masBuscados = unirTendenciasPorNivel(relacionadas.niveles);
      tendenciasSinRelacion = masBuscados.length === 0 && relacionadas.descartadas > 0;
    } catch (error) {
      registrar("tendencias", error);
    }
  }
  // Competencia: lo pegado a mano manda; si no, el título del link por la API oficial.
  let tituloCompetencia = limpiarTituloCompetencia(entrada.tituloCompetencia);
  let avisoCompetencia: string | null = null;
  const link = typeof entrada.linkCompetencia === "string" ? entrada.linkCompetencia.trim().slice(0, 500) : "";
  if (!tituloCompetencia && link) {
    const id = idCompetenciaDesdeLink(link, ctx.cuenta.siteId);
    if (!id) {
      avisoCompetencia = esLinkCortoMl(link)
        ? "Los links cortos meli.la (los de «Compartir» en la app) no se pueden leer. Ábrelo en el navegador y copia la dirección completa, o pega su título a mano."
        : `Ese link no es de una publicación de Mercado Libre de ${ctx.cuenta.siteId}. Pega su título a mano.`;
    } else {
      try {
        const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuenta.id);
        tituloCompetencia = limpiarTituloCompetencia(await tituloPublicacionMl(id.tipo, id.id, token));
      } catch (error) {
        registrar("competencia", error);
      }
      if (!tituloCompetencia) avisoCompetencia = "Mercado Libre no dejó leer esa publicación. Pega su título a mano.";
    }
  }
  // Para la IA, primero las de la categoría específica (las más cercanas al producto).
  const tendencias = [...masBuscados].sort((a, b) => ORDEN_PARA_IA[a.nivel] - ORDEN_PARA_IA[b.nivel]).map((t) => t.palabra);
  const info = limpiarInfoVendedor(entrada.info);
  const categoria = typeof entrada.categoriaNombre === "string" ? entrada.categoriaNombre.slice(0, 120) : null;
  try {
    const respuesta = await conCupoDeTexto(ctx.empresaId, () =>
      llamarIA(ctx.conexion, promptTitulos({ ficha, idioma: ctx.idioma, pais: ctx.pais, categoria, tendencias, info, competencia: tituloCompetencia, masVendidos: masVendidos.titulos }), { maxTokens: 800, timeoutMs: ESPERA_TEXTO_MS })
    );
    const propuesta = leerPropuestaTitulos(respuesta, { ficha, tendencias, info, niveles: masBuscados, competencia: tituloCompetencia, masVendidos: masVendidos.titulos });
    if (!propuesta) return { ok: false, aviso: "La IA no devolvió títulos usables. Intenta de nuevo." };
    return { ok: true, ...propuesta, conTendencias: tendencias.length > 0, masBuscados, rutaCategoria, tendenciasSinRelacion, competencia: { titulo: tituloCompetencia || null, aviso: avisoCompetencia }, masVendidos };
  } catch (error) {
    registrar("titulos", error);
    return { ok: false, aviso: mensajeErrorIA(error) };
  }
}

export type ResultadoDescripcion = { ok: true; descripcion: string } | Fallo;

// Paso 3: descripción, solo con la ficha confirmada. La garantía es la que
// escribió el vendedor (si no escribió nada, no sale esa sección).
// «Versión N de M» de la descripción (una por cuenta). Viene del
// navegador: solo enteros entre 1 y 20, si no, se ignora.
function leerVariante(v: unknown): { numero: number; total: number } | undefined {
  const o = v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const numero = o.numero;
  const total = o.total;
  if (typeof numero !== "number" || typeof total !== "number" || !Number.isInteger(numero) || !Number.isInteger(total)) return undefined;
  if (total < 1 || total > 20 || numero < 1 || numero > total) return undefined;
  return { numero, total };
}

export async function escribirDescripcionAction(entrada: { cuentaMlId: string; ficha: unknown; garantia?: string; palabrasClave?: unknown; variante?: unknown }): Promise<ResultadoDescripcion> {
  const ficha = leerFicha(entrada.ficha);
  if (!fichaConfirmada(ficha)) return { ok: false, aviso: "Confirma la ficha antes de pedir la descripción." };
  const ctx = await preparar(entrada.cuentaMlId);
  if ("ok" in ctx) return ctx;
  try {
    const respuesta = await conCupoDeTexto(ctx.empresaId, () => llamarIA(ctx.conexion, promptDescripcion({ ficha, idioma: ctx.idioma, pais: ctx.pais, palabrasClave: limpiarPalabrasClave(entrada.palabrasClave), variante: leerVariante(entrada.variante) }), { maxTokens: 1_500, timeoutMs: ESPERA_TEXTO_MS }));
    const partes = leerPartesDescripcion(respuesta, fichaEnTexto(ficha));
    if (!partes) return { ok: false, aviso: "La IA no devolvió una descripción usable. Intenta de nuevo." };
    const descripcion = armarDescripcion(partes, { ficha, garantia: limpiarInfoVendedor(entrada.garantia, LARGO_GARANTIA), idioma: ctx.idioma });
    if (!descripcion) return { ok: false, aviso: "La IA no devolvió una descripción usable. Intenta de nuevo." };
    return { ok: true, descripcion };
  } catch (error) {
    registrar("descripcion", error);
    return { ok: false, aviso: mensajeErrorIA(error) };
  }
}
