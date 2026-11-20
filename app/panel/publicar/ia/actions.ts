"use server";

import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerConexionIAParaModulo } from "@/lib/ia/conexion";
import { descargarFotoBase } from "@/lib/ia/imagen";
import { llamarIA, type ImagenIA } from "@/lib/ia/proveedores";
import type { ConexionIAConClave } from "@/lib/ia/tipos";
import { tendenciasCategoriaMl } from "@/lib/ml/cliente";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { resolverCategoria } from "@/lib/ml/publicar";
import { analizarProducto, ErrorAnalisisIA } from "@/lib/publicaciones/analisis";
import { armarDescripcion, leerPartesDescripcion, promptDescripcion } from "@/lib/publicaciones/descripcion";
import { mensajeErrorIA, MENSAJE_FRENO, MENSAJE_SIN_IA } from "@/lib/publicaciones/errores";
import { fichaConfirmada, fichaEnTexto, idiomaDeSitio, leerFicha, limpiarInfoVendedor, LARGO_GARANTIA, MAXIMO_FOTOS_ANALISIS, type Ficha } from "@/lib/publicaciones/ficha";
import { permitirLlamadaTexto } from "@/lib/publicaciones/freno";
import { leerPropuestaTitulos, promptTitulos, type PalabraClave } from "@/lib/publicaciones/titulos";
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
  if (!permitirLlamadaTexto(empresa.id)) return { ok: false, aviso: MENSAJE_FRENO };
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
    const { ficha, leyoFotos } = await analizarProducto(ctx.conexion, { idioma: ctx.idioma, pais: ctx.pais, info, fotos });
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

export type ResultadoTitulos = { ok: true; titulos: string[]; catalogo: string | null; palabras: PalabraClave[]; conTendencias: boolean } | Fallo;

// Paso 2: títulos, solo con la ficha confirmada (se revisa otra vez acá).
export async function proponerTitulosAction(entrada: {
  cuentaMlId: string;
  ficha: unknown;
  categoriaId?: string | null;
  categoriaNombre?: string | null;
  info?: string;
}): Promise<ResultadoTitulos> {
  const ficha = leerFicha(entrada.ficha);
  if (!fichaConfirmada(ficha)) return { ok: false, aviso: "Confirma la ficha antes de pedir títulos." };
  const ctx = await preparar(entrada.cuentaMlId);
  if ("ok" in ctx) return ctx;
  let tendencias: string[] = [];
  if (typeof entrada.categoriaId === "string" && entrada.categoriaId) {
    try {
      const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuenta.id);
      tendencias = (await tendenciasCategoriaMl(ctx.cuenta.siteId, entrada.categoriaId, token)) ?? [];
    } catch (error) {
      registrar("tendencias", error);
    }
  }
  const info = limpiarInfoVendedor(entrada.info);
  const categoria = typeof entrada.categoriaNombre === "string" ? entrada.categoriaNombre.slice(0, 120) : null;
  try {
    const respuesta = await llamarIA(ctx.conexion, promptTitulos({ ficha, idioma: ctx.idioma, pais: ctx.pais, categoria, tendencias, info }), { maxTokens: 800 });
    const propuesta = leerPropuestaTitulos(respuesta, { ficha, tendencias, info });
    if (!propuesta) return { ok: false, aviso: "La IA no devolvió títulos usables. Intenta de nuevo." };
    return { ok: true, ...propuesta, conTendencias: tendencias.length > 0 };
  } catch (error) {
    registrar("titulos", error);
    return { ok: false, aviso: mensajeErrorIA(error) };
  }
}

export type ResultadoDescripcion = { ok: true; descripcion: string } | Fallo;

// Paso 3: descripción, solo con la ficha confirmada. La garantía es la que
// escribió el vendedor (si no escribió nada, no sale esa sección).
export async function escribirDescripcionAction(entrada: { cuentaMlId: string; ficha: unknown; garantia?: string }): Promise<ResultadoDescripcion> {
  const ficha = leerFicha(entrada.ficha);
  if (!fichaConfirmada(ficha)) return { ok: false, aviso: "Confirma la ficha antes de pedir la descripción." };
  const ctx = await preparar(entrada.cuentaMlId);
  if ("ok" in ctx) return ctx;
  try {
    const respuesta = await llamarIA(ctx.conexion, promptDescripcion({ ficha, idioma: ctx.idioma, pais: ctx.pais }), { maxTokens: 1_500 });
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
