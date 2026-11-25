"use server";

import { requierePermiso } from "@/lib/permisos";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { PATRON_ID_RECLAMO, obtenerDetalleReclamoMl } from "@/lib/ml/reclamos";
import { enviarMensajeReclamoMl } from "@/lib/ml/reclamosMensajes";
import { puedeEscribirEnReclamo } from "@/lib/posventa/reclamoAcciones";
import { sugerirRespuestasPosventa, type SugerenciaPosventa } from "@/lib/ia/respuestasPosventa";
import { archivosDeFormulario, auditarMensaje, resolverContextoPosventa, superaLimiteEnvio, superaLimiteIA } from "@/lib/posventa/servidor";
import { validarTextoMensaje } from "@/lib/posventa/adjuntos";

// Posventa-Mensajes (Refs #645) — escribir en un reclamo. Las acciones
// disponibles se vuelven a leer de ML (no se confía en lo que manda el
// navegador): si el vendedor no tiene send_message_to_*, no se llama a ML.
const permisoEscribir = (usuarioId: string, empresaId: string) => requierePermiso(usuarioId, empresaId, "ventas", "modificar");

export type ResultadoEnvioAccion = { ok: boolean; mensaje: string };
export type ResultadoSugerenciaAccion = { ok: true; opciones: SugerenciaPosventa[] } | { ok: false; mensaje: string; sinIA?: boolean };

export async function enviarMensajeReclamoAction(formData: FormData): Promise<ResultadoEnvioAccion> {
  const reclamoId = formData.get("reclamoId");
  const texto = formData.get("texto");
  const resultado = await resolverContextoPosventa(formData.get("cuentaId"), permisoEscribir);
  if (!resultado.ok) return resultado;
  const { ctx } = resultado;
  if (typeof reclamoId !== "string" || !PATRON_ID_RECLAMO.test(reclamoId) || typeof texto !== "string") return { ok: false, mensaje: "Datos inválidos." };
  const archivos = await archivosDeFormulario(formData);
  if (!archivos) return { ok: false, mensaje: "Máximo 3 adjuntos por mensaje." };
  const motivo = validarTextoMensaje(texto, archivos.length > 0);
  if (motivo) return { ok: false, mensaje: motivo };
  if (superaLimiteEnvio(ctx.empresaId)) return { ok: false, mensaje: "Demasiados envíos seguidos. Espera un minuto e intenta de nuevo." };

  try {
    const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuenta.id);
    const detalle = await obtenerDetalleReclamoMl(reclamoId, token, ctx.cuenta.cuentaIdExterna);
    if (!puedeEscribirEnReclamo(detalle.reclamo.etapa, detalle.accionesVendedor)) return { ok: false, mensaje: "Mercado Libre no habilita escribir en este reclamo ahora." };
    const envio = await enviarMensajeReclamoMl({ token, reclamoId, etapa: detalle.reclamo.etapa, accionesVendedor: detalle.accionesVendedor, texto, archivos });
    if (!envio.ok) return { ok: false, mensaje: envio.mensaje };
    await auditarMensaje(ctx, "reclamo.mensaje_enviado", reclamoId, archivos.length);
    return { ok: true, mensaje: "Mensaje enviado." };
  } catch (error) {
    console.warn(`[reclamos/mensaje] envío falló: ${error instanceof Error ? error.name : "error"}`);
    return { ok: false, mensaje: "No se pudo enviar ahora. Intenta de nuevo en un momento." };
  }
}

export async function sugerirRespuestaReclamoAction(entrada: { cuentaId: string; reclamoId: string }): Promise<ResultadoSugerenciaAccion> {
  const resultado = await resolverContextoPosventa(entrada.cuentaId, permisoEscribir);
  if (!resultado.ok) return resultado;
  const { ctx } = resultado;
  if (typeof entrada.reclamoId !== "string" || !PATRON_ID_RECLAMO.test(entrada.reclamoId)) return { ok: false, mensaje: "Datos inválidos." };
  if (superaLimiteIA(ctx.empresaId, ctx.usuarioId)) return { ok: false, mensaje: "Demasiadas sugerencias seguidas. Espera un minuto." };
  try {
    const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuenta.id);
    const d = await obtenerDetalleReclamoMl(entrada.reclamoId, token, ctx.cuenta.cuentaIdExterna);
    const producto = d.venta.productos[0];
    const r = await sugerirRespuestasPosventa(ctx.empresaId, {
      tipo: "reclamo",
      motivo: d.motivo?.detalle ?? d.motivo?.nombre ?? d.reclamo.motivoId,
      resolucionPedida: d.resoluciones.find((x) => x.rol === "complainant")?.resolucion ?? null,
      etapa: d.reclamo.etapa,
      plazo: d.plazo,
      producto: producto?.titulo ?? null,
      variacion: producto?.variaciones.map((v) => `${v.nombre}: ${v.valor}`).join(", ") || null,
      mensajes: d.mensajes.slice(-8).map((m) => ({ autor: m.rolEmisor === "respondent" ? "vendedor" : "comprador", texto: m.texto })),
    });
    if (r.estado === "ok") return { ok: true, opciones: r.opciones };
    return { ok: false, mensaje: r.mensaje, sinIA: r.estado === "sin_ia" };
  } catch {
    return { ok: false, mensaje: "No se pudieron generar sugerencias ahora." };
  }
}
