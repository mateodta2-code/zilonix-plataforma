// Posventa-Mensajes (Refs #645) — ESCRIBIR en un reclamo. Solo APIs
// documentadas (post-purchase v1) y siempre por escribirMl. Nunca se
// loguea el texto ni el token.

import { LimiteMercadoLibreError, escribirMl } from "@/lib/ml/cliente";
import { PATRON_ID_RECLAMO } from "@/lib/ml/reclamos";
import { mensajeErrorEnvio, subirArchivoMl, type ArchivoSubida, type ResultadoEnvioMl } from "@/lib/ml/mensajesPosventaEnvio";
import { puedeEscribirEnReclamo, receptorYAccion } from "@/lib/posventa/reclamoAcciones";
import { MAX_ADJUNTOS_POR_MENSAJE, REGLAS_ADJUNTO_RECLAMO, validarAdjuntos, validarTextoMensaje } from "@/lib/posventa/adjuntos";

const BASE = "https://api.mercadolibre.com";

export type EntradaMensajeReclamo = {
  token: string;
  reclamoId: string;
  etapa: string | null;
  accionesVendedor: string[];
  texto: string;
  archivos: ArchivoSubida[];
};

export async function enviarMensajeReclamoMl(e: EntradaMensajeReclamo): Promise<ResultadoEnvioMl> {
  if (!PATRON_ID_RECLAMO.test(e.reclamoId)) return { ok: false, mensaje: "Reclamo inválido." };
  if (!puedeEscribirEnReclamo(e.etapa, e.accionesVendedor)) return { ok: false, mensaje: "Mercado Libre no habilita escribir en este reclamo ahora." };
  const motivoTexto = validarTextoMensaje(e.texto, e.archivos.length > 0);
  if (motivoTexto) return { ok: false, mensaje: motivoTexto };
  if (e.archivos.length > MAX_ADJUNTOS_POR_MENSAJE) return { ok: false, mensaje: `Máximo ${MAX_ADJUNTOS_POR_MENSAJE} adjuntos por mensaje.` };
  const motivoArchivos = validarAdjuntos(e.archivos.map((a) => ({ nombre: a.nombre, tipo: a.tipo, tamano: a.bytes.byteLength })), REGLAS_ADJUNTO_RECLAMO);
  if (motivoArchivos) return { ok: false, mensaje: motivoArchivos };

  const base = `${BASE}/post-purchase/v1/claims/${e.reclamoId}`;
  try {
    const nombres: string[] = [];
    for (const archivo of e.archivos) {
      const sub = await subirArchivoMl(`${base}/attachments`, e.token, archivo, REGLAS_ADJUNTO_RECLAMO, "file_name");
      if (!sub.ok) return sub;
      nombres.push(sub.id);
    }
    const cuerpo: Record<string, unknown> = { receiver_role: receptorYAccion(e.etapa).receptor, message: e.texto.trim() };
    if (nombres.length > 0) cuerpo.attachments = nombres;
    const resp = await escribirMl(`${base}/actions/message`, e.token, "POST", cuerpo);
    return resp.ok ? { ok: true } : { ok: false, mensaje: mensajeErrorEnvio(resp.status) };
  } catch (error) {
    if (error instanceof LimiteMercadoLibreError) return { ok: false, mensaje: "Mercado Libre pide esperar un momento. Intenta de nuevo en un minuto." };
    throw error;
  }
}

export { puedeEscribirEnReclamo, receptorYAccion };
