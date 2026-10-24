import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { buscarItemsPorSkuMl, leerItemBasicoMl, subirClipMl } from "@/lib/ml/cliente";
import { clipRequiereReputacion } from "@/lib/ml/publicar-reglas";

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

export type ResultadoClip = { status: string; clipUuid: string | null; siteIds: string[] };

// §10 — contrato real confirmado por la documentación oficial de
// Mercado Libre ("Working with Clips"): POST .../clips/upload,
// multipart/form-data, solo "file" + header Authorization (el boundary
// lo pone `fetch` con FormData — nunca fijar content-type a mano).
// Advertencia explícita heredada del código original: este es el ÚNICO
// endpoint del flujo de publicar NUNCA confirmado contra una cuenta
// real — si Mercado Libre responde distinto a lo documentado, el error
// real queda visible tal cual, nunca se traga ni se adivina.
//
// Decisión tomada a propósito sobre una ambigüedad real del sistema
// actual (hallazgo §16.1): el comentario original documenta un campo
// "sites" ([{site_id, logistic_type}], vacío = todos los sitios) que el
// código nunca mandaba. Acá se omite explícitamente (equivalente
// documentado a "todos los sitios disponibles"), igual que el
// comportamiento real que ya corrió en producción.
// Tarea 2.11, punto 2/3: fetch directo movido a subirClipMl
// (lib/ml/cliente.ts) — valida itemId (el que llega de
// app/panel/publicar/clip/actions.ts, de un <input type="hidden"> del
// formulario, nunca confiado sin validar) con el mismo patrón de
// siempre, ANTES de armar la URL.
export async function subirClipItem(token: string, itemId: string, buffer: Buffer | ArrayBuffer, filename: string, contentType: string): Promise<ResultadoClip> {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType || "video/mp4" }), filename || "clip.mp4");

  const { ok, status, textoCrudo } = await subirClipMl(itemId, token, form);
  if (!ok) {
    // BUG real (Mateo, 28/9, comercio FullyLemon): una cuenta recién
    // conectada sin ventas todavía no tiene "color de reputación"
    // asignado, y Mercado Libre bloquea Clips para esa cuenta sin
    // importar el token. No es cuestión de reintentar.
    if (clipRequiereReputacion(textoCrudo)) {
      throw new Error(
        "Mercado Libre no deja subir Clips en esta cuenta todavía — necesita tener un color de reputación asignado (se gana con ventas reales), y una cuenta recién conectada sin historial de ventas no lo tiene. No es un error nuestro; hay que esperar a que la cuenta tenga reputación."
      );
    }
    // status === 0 = tiempo agotado o falla de red subiendo el video —
    // textoCrudo queda vacío, nunca un HTTP real que mostrar.
    if (status === 0) {
      throw new Error("Mercado Libre no respondió a tiempo subiendo el video; revisá en Mercado Libre si el clip se subió antes de reintentar.");
    }
    throw new Error(`Mercado Libre rechazó el video (HTTP ${status}): ${textoCrudo.slice(0, 800)}`);
  }
  let data: { status?: string; clip_uuid?: string; site_ids?: string[] };
  try {
    data = JSON.parse(textoCrudo);
  } catch {
    throw new Error(`Mercado Libre devolvió una respuesta inesperada: ${textoCrudo.slice(0, 400)}`);
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
const TAMANO_MAXIMO_CLIP_BYTES = 280 * 1024 * 1024;

export class ClipInvalidoError extends Error {}

export function validarArchivoClip(contentType: string, tamanoBytes: number): void {
  if (!TIPOS_VIDEO_VALIDOS.has(contentType)) {
    throw new ClipInvalidoError("El video tiene que ser MP4, MOV, MPEG o AVI.");
  }
  if (tamanoBytes > TAMANO_MAXIMO_CLIP_BYTES) {
    throw new ClipInvalidoError("El video no puede superar 280MB — es el límite real de Mercado Libre para Clips.");
  }
}
