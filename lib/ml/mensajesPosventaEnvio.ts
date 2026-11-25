// Posventa-Mensajes (Refs #645) — ESCRITURA de mensajes post-venta. Solo
// APIs documentadas de Mercado Libre, siempre por escribirMl (cliente.ts).
// Quien llama ya validó permiso, cuenta de la empresa y tipo/tamaño del
// archivo; aquí se vuelve a validar antes de salir, y NUNCA se loguea el
// texto del mensaje ni el token.

import { LimiteMercadoLibreError, escribirMl } from "@/lib/ml/cliente";
import { PATRON_ID_PACK, PATRON_ID_VENDEDOR_ML } from "@/lib/ml/mensajesPosventa";
import { MAX_ADJUNTOS_POR_MENSAJE, REGLAS_ADJUNTO_MENSAJE, validarAdjuntos, validarTextoMensaje, type ReglasAdjunto } from "@/lib/posventa/adjuntos";

const BASE = "https://api.mercadolibre.com";

export type ArchivoSubida = { nombre: string; tipo: string; bytes: ArrayBuffer };
export type ResultadoEnvioMl = { ok: true } | { ok: false; mensaje: string };

export function mensajeErrorEnvio(status: number): string {
  if (status === 401 || status === 403) return "Mercado Libre no autorizó el envío. Reconecta la cuenta e intenta de nuevo.";
  if (status === 404) return "Mercado Libre no encontró la conversación.";
  if (status === 400 || status === 422) return "Mercado Libre rechazó el mensaje. Revisa que no tenga datos personales, links ni lenguaje ofensivo.";
  return "No se pudo enviar ahora. Intenta de nuevo en un momento.";
}

// Sube un archivo y devuelve el nombre/id con el que se asocia al mensaje.
// `ruta` y `campoId` cambian según sea mensaje de venta o reclamo.
export async function subirArchivoMl(url: string, token: string, archivo: ArchivoSubida, reglas: ReglasAdjunto, campoId: "id" | "file_name"): Promise<{ ok: true; id: string } | { ok: false; mensaje: string }> {
  const motivo = validarAdjuntos([{ nombre: archivo.nombre, tipo: archivo.tipo, tamano: archivo.bytes.byteLength }], reglas);
  if (motivo) return { ok: false, mensaje: motivo };
  const form = new FormData();
  form.append("file", new Blob([archivo.bytes], { type: archivo.tipo || "application/octet-stream" }), archivo.nombre);
  const resp = await escribirMl<Record<string, unknown>>(url, token, "POST", form);
  const id = resp.data?.[campoId] ?? resp.data?.id ?? resp.data?.file_name;
  if (!resp.ok || typeof id !== "string" || !id) return { ok: false, mensaje: mensajeErrorEnvio(resp.ok ? 502 : resp.status) };
  return { ok: true, id };
}

export type EntradaMensajeVenta = {
  token: string;
  siteId: string;
  packOOrden: string;
  vendedorId: string;
  compradorId: string;
  texto: string;
  archivos: ArchivoSubida[];
};

// 1) sube cada adjunto (POST /messages/attachments), 2) envía el mensaje
// con los ids (POST /messages/packs/{pack}/sellers/{seller}).
export async function enviarMensajeVentaMl(e: EntradaMensajeVenta): Promise<ResultadoEnvioMl> {
  if (!PATRON_ID_PACK.test(e.packOOrden) || !PATRON_ID_VENDEDOR_ML.test(e.vendedorId) || !PATRON_ID_VENDEDOR_ML.test(e.compradorId) || !/^[A-Z]{3}$/.test(e.siteId)) {
    return { ok: false, mensaje: "Datos de la venta inválidos." };
  }
  const motivoTexto = validarTextoMensaje(e.texto, e.archivos.length > 0);
  if (motivoTexto) return { ok: false, mensaje: motivoTexto };
  if (e.archivos.length > MAX_ADJUNTOS_POR_MENSAJE) return { ok: false, mensaje: `Máximo ${MAX_ADJUNTOS_POR_MENSAJE} adjuntos por mensaje.` };
  const motivoArchivos = validarAdjuntos(e.archivos.map((a) => ({ nombre: a.nombre, tipo: a.tipo, tamano: a.bytes.byteLength })), REGLAS_ADJUNTO_MENSAJE);
  if (motivoArchivos) return { ok: false, mensaje: motivoArchivos };

  try {
    const ids: string[] = [];
    for (const archivo of e.archivos) {
      const sub = await subirArchivoMl(`${BASE}/messages/attachments?tag=post_sale&site_id=${e.siteId}`, e.token, archivo, REGLAS_ADJUNTO_MENSAJE, "id");
      if (!sub.ok) return sub;
      ids.push(sub.id);
    }
    const cuerpo: Record<string, unknown> = {
      from: { user_id: e.vendedorId },
      to: { user_id: e.compradorId },
      text: e.texto.trim(),
    };
    if (ids.length > 0) cuerpo.attachments = ids;
    const resp = await escribirMl(`${BASE}/messages/packs/${e.packOOrden}/sellers/${e.vendedorId}?tag=post_sale`, e.token, "POST", cuerpo);
    return resp.ok ? { ok: true } : { ok: false, mensaje: mensajeErrorEnvio(resp.status) };
  } catch (error) {
    if (error instanceof LimiteMercadoLibreError) return { ok: false, mensaje: "Mercado Libre pide esperar un momento. Intenta de nuevo en un minuto." };
    throw error;
  }
}
