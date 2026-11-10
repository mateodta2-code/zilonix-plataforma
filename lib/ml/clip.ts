import { openAsBlob } from "fs";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { buscarItemsPorSkuMl, leerItemBasicoMl, leerItemCompletoMl, subirClipMl } from "@/lib/ml/cliente";
import { clipRequierePermisoDeApp } from "@/lib/ml/publicar-reglas";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";

// Tarea 2.11 ("Publicar producto y clip") — el clip es un SUB-FLUJO
// APARTE de publicar (decisión de diseño explícita del sistema actual,
// confirmada en PublicarClipML.js: "completamente aparte del
// formulario de Publicar Producto... para no arriesgar tocar nada de
// lo que ya funciona"): siempre se aplica a un ítem que YA existe.

export type ItemEncontradoPorSku = { itemId: string; titulo: string; thumbnail: string | null };

// Mejora deliberada sobre el sistema actual (hallazgo §16.4 del reporte
// de investigación: "buscar-item-por-sku descarga el catálogo COMPLETO
// de la cuenta para encontrar un SKU" — costoso, sin motivo documentado
// para no usar la búsqueda real por seller_sku). Acá se usa el
// endpoint real GET /users/{id}/items/search?seller_sku= directamente.
export async function buscarItemPorSku(empresaId: string, cuenta: { id: string; cuentaIdExterna: string }, sku: string): Promise<ItemEncontradoPorSku | null> {
  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
  // Tarea 2.11, punto 2/3: fetch directo movido a lib/ml/cliente.ts —
  // buscarItemsPorSkuMl valida cuenta.cuentaIdExterna (/^\d+$/) antes
  // de armar la URL. El itemId que vuelve DE Mercado Libre (nunca de
  // nuestro propio formulario) también se valida — leerItemBasicoMl lo
  // exige antes de armar la segunda URL, no se confía en que el
  // primer endpoint haya devuelto algo bien formado.
  const resultados = await buscarItemsPorSkuMl(cuenta.cuentaIdExterna, sku, token);
  const itemId = resultados[0];
  if (!itemId) return null;

  const detalle = await leerItemBasicoMl(itemId, token);
  if (!detalle) return { itemId, titulo: itemId, thumbnail: null };
  return { itemId, titulo: detalle.title ?? itemId, thumbnail: detalle.thumbnail ?? null };
}

// Rama feat-publicar-clip, punto 3 — "busca en TODAS las cuentas
// conectadas de la empresa, en paralelo... foto, título, MLA/MCO,
// estado de la publicación". `buscarItemPorSku` (arriba) sigue
// intacta — la usa app/panel/publicar/importadores/ (Parte 3, "importar
// por SKU propio"), un flujo totalmente distinto — esto es una función
// NUEVA, con `leerItemCompletoMl` (más rico: status/thumbnail) en vez
// de `leerItemBasicoMl`.
export type ItemClipCandidato = {
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  status: string | null;
  // "activo" = Mercado Libre confirma status==="active" — una
  // publicación pausada/cerrada puede seguir recibiendo un Clip según
  // la documentación, pero la UI necesita distinguirla para no
  // ofrecerla marcada por defecto (ver FilaBusquedaClip, más abajo).
  activo: boolean;
};

export async function buscarItemParaClip(empresaId: string, cuenta: { id: string; cuentaIdExterna: string }, sku: string): Promise<ItemClipCandidato | null> {
  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
  const resultados = await buscarItemsPorSkuMl(cuenta.cuentaIdExterna, sku, token);
  const itemId = resultados[0];
  if (!itemId) return null;
  const detalle = await leerItemCompletoMl(itemId, token);
  if (!detalle) return { itemId, titulo: itemId, thumbnail: null, status: null, activo: false };
  return { itemId, titulo: detalle.title ?? itemId, thumbnail: detalle.thumbnail, status: detalle.status, activo: detalle.status === "active" };
}

export type FilaBusquedaClip = {
  cuentaId: string;
  nickname: string;
  encontrado: boolean;
  itemId: string | null;
  titulo: string | null;
  thumbnail: string | null;
  activo: boolean;
  // Por qué esta fila queda deshabilitada en la tabla (nunca se
  // adivina el motivo en la UI — viene armado de acá, con el dato
  // real: no se encontró el SKU, o se encontró pero está pausada/
  // cerrada, o la cuenta dio un error real al buscar).
  motivoNoDisponible: string | null;
};

const CONCURRENCIA_BUSQUEDA_SKU = 5;

// Punto 3 del pedido — "en TODAS las cuentas conectadas, en paralelo,
// con un tope de concurrencia". Cada cuenta se busca independiente —
// si una cuenta puntual falla (token vencido, Mercado Libre caído),
// esa fila queda con el motivo real, nunca tira abajo la búsqueda de
// las demás cuentas (conConcurrenciaLimitada no atrapa errores por su
// cuenta — ACÁ es donde se atrapan, por diseño).
export async function buscarSkuEnTodasLasCuentas(
  empresaId: string,
  cuentas: { id: string; nickname: string; cuentaIdExterna: string }[],
  sku: string
): Promise<FilaBusquedaClip[]> {
  return conConcurrenciaLimitada(cuentas, CONCURRENCIA_BUSQUEDA_SKU, async (cuenta) => {
    try {
      const item = await buscarItemParaClip(empresaId, cuenta, sku);
      if (!item) {
        return { cuentaId: cuenta.id, nickname: cuenta.nickname, encontrado: false, itemId: null, titulo: null, thumbnail: null, activo: false, motivoNoDisponible: "Sin ese SKU en esta cuenta." };
      }
      return {
        cuentaId: cuenta.id,
        nickname: cuenta.nickname,
        encontrado: true,
        itemId: item.itemId,
        titulo: item.titulo,
        thumbnail: item.thumbnail,
        activo: item.activo,
        motivoNoDisponible: item.activo ? null : `Publicación ${item.status ?? "no activa"} — no se puede subir un Clip hasta reactivarla.`,
      };
    } catch (error) {
      return {
        cuentaId: cuenta.id,
        nickname: cuenta.nickname,
        encontrado: false,
        itemId: null,
        titulo: null,
        thumbnail: null,
        activo: false,
        motivoNoDisponible: error instanceof Error ? error.message : "No se pudo consultar esta cuenta.",
      };
    }
  });
}

export type ResultadoClip = { status: string; clipUuid: string | null; siteIds: string[] };

// Tarea 2.11, punto CSRF/error-codes — app/api/ml/clip/route.ts nunca
// manda texto libre a la URL del redirect (issue real: un mensaje con
// el detalle crudo de Mercado Libre terminaba visible en la barra de
// direcciones, y encima pisado en el historial del navegador). Clases
// propias para que la ruta mapee por `instanceof` a un código fijo de
// una lista cerrada, en vez de adivinar por el texto del mensaje —
// el mensaje completo (hasta 800 caracteres del cuerpo real de ML, ver
// más abajo) sigue existiendo para el log del servidor, nunca para la
// URL.
// Caso real (Mateo, 9/11, STOREKINGSAS — Mercado Líder Gold): este
// 403 NUNCA es reputación — ver el comentario de
// clipRequierePermisoDeApp (lib/ml/publicar-reglas.ts). Investigación
// del 10/11 (mismo caso): tampoco es un permiso de la app mal
// configurado en el DevCenter — es que POST /marketplace/items/{id}/
// clips/upload está documentado SOLO para Global Selling (ver el
// comentario de subirClipMl, lib/ml/cliente.ts). Este error ahora se
// lanza únicamente cuando LAS DOS rutas (la de Global Selling y su
// reintento local) fallaron por permiso/ruta inaplicable — nunca ya
// sugiere revisar el DevCenter ni reconectar la cuenta, porque eso
// nunca fue la causa real. `detalle` guarda el HTTP + cuerpo crudo de
// las dos respuestas (hasta 800 caracteres en total) para un
// desplegable "Ver detalle" en la UI — nunca mezclado con el mensaje
// principal, que tiene que quedar corto y accionable.
export class ClipPermisoDeAppRequeridoError extends Error {
  constructor(public readonly detalle: string) {
    super(
      "La API pública de Clips de Mercado Libre está documentada solo para Global Selling. Mercado Libre rechazó la subida por API en esta publicación — el Clip se puede subir directamente desde el panel de Mercado Libre."
    );
  }
}
export class ClipSinRespuestaError extends Error {}
export class ClipRechazadoError extends Error {}

// §10 — contrato real confirmado por la documentación oficial de
// Mercado Libre ("Working with Clips"): POST .../clips/upload,
// multipart/form-data, solo "file" + header Authorization (el boundary
// lo pone `fetch` con FormData — nunca fijar content-type a mano).
// Advertencia explícita heredada del código original: ninguna de las
// dos rutas de este módulo (ver subirClipMl, lib/ml/cliente.ts) se
// confirmó todavía contra una cuenta real — si Mercado Libre responde
// distinto a lo documentado, el error real queda visible tal cual,
// nunca se traga ni se adivina.
//
// Decisión tomada a propósito sobre una ambigüedad real del sistema
// actual (hallazgo §16.1): el comentario original documenta un campo
// "sites" ([{site_id, logistic_type}], vacío = todos los sitios) que el
// código nunca mandaba. Acá se omite explícitamente en LAS DOS rutas
// (equivalente documentado a "todos los sitios disponibles"), igual
// que el comportamiento real que ya corrió en producción —
// "sites" es del contrato de Global Selling, nunca de un vendedor local.
// Tarea 2.11, punto 2/3: fetch directo movido a subirClipMl
// (lib/ml/cliente.ts) — valida itemId con el mismo patrón de siempre,
// ANTES de armar la URL.
//
// Rama feat-publicar-clip — reemplaza la versión anterior, que recibía
// el video entero como `Buffer` (280MB posibles en memoria, a la vez
// por cada cuenta — justo lo que el pedido prohíbe). Ahora recibe la
// RUTA del archivo temporal (ya en disco, por streaming — ver
// lib/ml/video-externo.ts y lib/trabajos/subirClipMultiCuenta.ts) y usa
// `fs.openAsBlob` (Node ≥20, estable): un Blob real respaldado por el
// archivo, que `fetch`/`FormData` leen por streaming directo desde
// disco — nunca carga el archivo completo en memoria para subirlo.
// Varias cuentas pueden llamar esto con la MISMA ruta al mismo tiempo
// (concurrencia 2, ver el trabajo de arriba) sin pisarse: cada llamada
// abre su propio handle de lectura, el archivo nunca se modifica.
//
// Investigación del 10/11 (caso STOREKINGSAS, Refs #380/#381) — la ruta
// POST /marketplace/items/{id}/clips/upload está documentada SOLO para
// Global Selling (ítems CBT); para un vendedor local da 400/403/404 sin
// que eso diga nada sobre el permiso de la app ni el video. Se arma el
// FormData DE NUEVO para el reintento porque un FormData ya pasado a
// `fetch` no se puede reusar en una segunda llamada (el stream del Blob
// que lo respalda ya se consumió) — `construirFormularioClip` vuelve a
// abrir el mismo archivo por streaming, nunca lo carga completo en
// memoria.
async function construirFormularioClip(rutaArchivo: string, filename: string, contentType: string): Promise<FormData> {
  const blob = await openAsBlob(rutaArchivo, { type: contentType || "video/mp4" });
  const form = new FormData();
  form.append("file", blob, filename || "clip.mp4");
  return form;
}

// 400, 403 o 404 en /marketplace/items/{id}/clips/upload: los tres
// pueden significar "esta ruta no aplica a este ítem local", nunca
// solo el 403 de política (PA_UNAUTHORIZED_RESULT_FROM_POLICIES) ya
// conocido — se reintenta siempre contra la ruta local antes de decidir
// nada.
function requiereReintentoRutaLocal(status: number): boolean {
  return status === 400 || status === 403 || status === 404;
}

// "Las dos rutas fallaron por permiso/ruta inaplicable" (nunca un error
// real del video): 403/404 directos, o el código de política ya
// conocido en el cuerpo de la respuesta — mismo criterio que
// clipRequierePermisoDeApp, pero sumando el status real de cada ruta,
// que acá sí se conoce.
function esFalloDePermisoORutaInaplicable(status: number, textoCrudo: string): boolean {
  return status === 403 || status === 404 || clipRequierePermisoDeApp(textoCrudo);
}

export async function subirClipItemDesdeArchivo(token: string, itemId: string, rutaArchivo: string, filename: string, contentType: string): Promise<ResultadoClip> {
  const formMarketplace = await construirFormularioClip(rutaArchivo, filename, contentType);
  const primero = await subirClipMl(itemId, token, formMarketplace);

  let resultado = primero;
  let intentoLocal: { ok: boolean; status: number; textoCrudo: string } | null = null;
  if (!primero.ok && requiereReintentoRutaLocal(primero.status)) {
    const formLocal = await construirFormularioClip(rutaArchivo, filename, contentType);
    intentoLocal = await subirClipMl(itemId, token, formLocal, "local");
    resultado = intentoLocal;
  }

  if (!resultado.ok) {
    // Solo si LAS DOS rutas (la de Global Selling y su reintento local)
    // fallaron por permiso/ruta inaplicable: nunca se sugiere ya
    // revisar el DevCenter ni reconectar la cuenta, eso nunca fue la
    // causa real (ver el comentario de ClipPermisoDeAppRequeridoError).
    if (intentoLocal && esFalloDePermisoORutaInaplicable(primero.status, primero.textoCrudo) && esFalloDePermisoORutaInaplicable(intentoLocal.status, intentoLocal.textoCrudo)) {
      const detalle = `Global Selling (HTTP ${primero.status}): ${primero.textoCrudo} | Local (HTTP ${intentoLocal.status}): ${intentoLocal.textoCrudo}`.slice(0, 800);
      throw new ClipPermisoDeAppRequeridoError(detalle);
    }
    // status === 0 = tiempo agotado o falla de red subiendo el video —
    // textoCrudo queda vacío, nunca un HTTP real que mostrar.
    if (resultado.status === 0) {
      throw new ClipSinRespuestaError("Mercado Libre no respondió a tiempo subiendo el video; revisa en Mercado Libre si el clip se subió antes de reintentar.");
    }
    // Otro rechazo real (ej. un 400 real de archivo en la ruta que sí
    // corresponde) — el detalle real de la ruta que de verdad decidió,
    // nunca el de la primera si hubo reintento.
    throw new ClipRechazadoError(`Mercado Libre rechazó el video (HTTP ${resultado.status}): ${resultado.textoCrudo.slice(0, 800)}`);
  }
  let data: { status?: string; clip_uuid?: string; site_ids?: string[] };
  try {
    data = JSON.parse(resultado.textoCrudo);
  } catch {
    throw new ClipRechazadoError(`Mercado Libre devolvió una respuesta inesperada: ${resultado.textoCrudo.slice(0, 400)}`);
  }
  // status: "accepted" = recibido, no publicado — Mercado Libre lo
  // modera (24-48h) antes de que quede visible.
  return { status: data.status ?? "desconocido", clipUuid: data.clip_uuid ?? null, siteIds: data.site_ids ?? [] };
}

// Requisitos reales documentados por Mercado Libre (nunca validados en
// el sistema actual — oportunidad real de mejora, hallazgo §16.3):
// MP4/MOV/MPEG/AVI, 10 a 61 segundos, máximo 280MB, mínimo 360×640
// (vertical). Acá solo se valida lo que se puede comprobar sin decodificar
// el video (tipo y tamaño) — duración/resolución exigirían decodificarlo,
// fuera de alcance de esta validación previa.
const TIPOS_VIDEO_VALIDOS = new Set(["video/mp4", "video/quicktime", "video/mpeg", "video/x-msvideo"]);
// Exportado: app/api/ml/clip/route.ts lo usa para el rechazo temprano
// por content-length (con margen por el overhead de multipart), antes
// de leer el cuerpo entero.
export const TAMANO_MAXIMO_CLIP_BYTES = 280 * 1024 * 1024;

export class ClipInvalidoError extends Error {}
// Subclase, no una clase aparte: así un `toThrow(ClipInvalidoError)` ya
// escrito sigue pasando, y app/api/ml/clip/route.ts puede seguir
// distinguiendo "tamaño" de "tipo" por `instanceof` (revisando esta
// clase, más específica, ANTES que ClipInvalidoError genérica).
export class ClipDemasiadoGrandeError extends ClipInvalidoError {}

export function validarArchivoClip(contentType: string, tamanoBytes: number): void {
  if (!TIPOS_VIDEO_VALIDOS.has(contentType)) {
    throw new ClipInvalidoError("El video tiene que ser MP4, MOV, MPEG o AVI.");
  }
  if (tamanoBytes > TAMANO_MAXIMO_CLIP_BYTES) {
    throw new ClipDemasiadoGrandeError("El video no puede superar 280MB — es el límite real de Mercado Libre para Clips.");
  }
}

// Rama feat-publicar-clip, punto 2 ("Revisión antes de subir, en el
// navegador") — requisitos reales de duración/orientación/resolución
// que `validarArchivoClip` (arriba) nunca pudo validar porque exigen
// decodificar el video (acá YA vienen leídos, por el <video> del
// navegador — ver app/panel/publicar/clip/leerMetadatosVideo.ts, que sí
// toca el DOM y por eso no se puede probar con vitest). Pura a
// propósito: recibe los 4 números ya leídos, nunca un archivo ni un
// elemento del DOM — se puede probar con casos simples, sin navegador.
export type MetadatosVideoClip = { duracionSegundos: number; ancho: number; alto: number; tamanoBytes: number };
export type ProblemaVideoClip = "duracion_corta" | "duracion_larga" | "no_vertical" | "resolucion_baja" | "demasiado_grande";

export const MENSAJES_PROBLEMA_VIDEO_CLIP: Record<ProblemaVideoClip, string> = {
  duracion_corta: "El video dura menos de 10 segundos — Mercado Libre exige entre 10 y 61 segundos.",
  duracion_larga: "El video dura más de 61 segundos — Mercado Libre exige entre 10 y 61 segundos.",
  no_vertical: "El video tiene que ser vertical (más alto que ancho) — este no lo es.",
  resolucion_baja: "El video tiene que medir al menos 360×640 — este mide menos.",
  demasiado_grande: "El video no puede superar 280MB — es el límite real de Mercado Libre para Clips.",
};

// Devuelve TODOS los problemas reales encontrados (nunca solo el
// primero) — la UI (punto 2 del pedido) tiene que avisar en claro cada
// cosa que falta corregir a la vez, no una por una en rondas.
export function problemasDeVideoClip(metadatos: MetadatosVideoClip): ProblemaVideoClip[] {
  const problemas: ProblemaVideoClip[] = [];
  if (metadatos.duracionSegundos < 10) problemas.push("duracion_corta");
  if (metadatos.duracionSegundos > 61) problemas.push("duracion_larga");
  if (metadatos.alto <= metadatos.ancho) problemas.push("no_vertical");
  if (metadatos.alto < 640 || metadatos.ancho < 360) problemas.push("resolucion_baja");
  if (metadatos.tamanoBytes > TAMANO_MAXIMO_CLIP_BYTES) problemas.push("demasiado_grande");
  return problemas;
}
