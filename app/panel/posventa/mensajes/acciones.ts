"use server";

import { requierePermiso } from "@/lib/permisos";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { PATRON_ID_PACK, leerCompradorIdMl, leerConversacionMl } from "@/lib/ml/mensajesPosventa";
import { enviarMensajeVentaMl } from "@/lib/ml/mensajesPosventaEnvio";
import { sugerirRespuestasPosventa, type SugerenciaPosventa } from "@/lib/ia/respuestasPosventa";
import { archivosDeFormulario, auditarMensaje, resolverContextoPosventa, superaLimiteEnvio, superaLimiteIA } from "@/lib/posventa/servidor";
import { validarTextoMensaje } from "@/lib/posventa/adjuntos";

// Posventa-Mensajes (Refs #645) — responder a un comprador desde una venta.
// Permiso ventas modificar, cuenta de la empresa, límite por empresa y
// auditoría sin el texto. Nunca se llama a ML si algo de esto falla.
const permisoEscribir = (usuarioId: string, empresaId: string) => requierePermiso(usuarioId, empresaId, "ventas", "modificar");

export type ResultadoEnvioAccion = { ok: boolean; mensaje: string };
export type ResultadoSugerenciaAccion = { ok: true; opciones: SugerenciaPosventa[] } | { ok: false; mensaje: string; sinIA?: boolean };

export async function enviarMensajeVentaAction(formData: FormData): Promise<ResultadoEnvioAccion> {
  const packId = formData.get("packId");
  const texto = formData.get("texto");
  const resultado = await resolverContextoPosventa(formData.get("cuentaId"), permisoEscribir);
  if (!resultado.ok) return resultado;
  const { ctx } = resultado;
  if (typeof packId !== "string" || !PATRON_ID_PACK.test(packId) || typeof texto !== "string") return { ok: false, mensaje: "Datos inválidos." };
  const archivos = await archivosDeFormulario(formData);
  if (!archivos) return { ok: false, mensaje: "Máximo 3 adjuntos por mensaje." };
  const motivo = validarTextoMensaje(texto, archivos.length > 0);
  if (motivo) return { ok: false, mensaje: motivo };
  if (superaLimiteEnvio(ctx.empresaId)) return { ok: false, mensaje: "Demasiados envíos seguidos. Espera un minuto e intenta de nuevo." };

  try {
    const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuenta.id);
    const compradorId = await leerCompradorIdMl(packId, token);
    if (!compradorId) return { ok: false, mensaje: "No se encontró al comprador de esta venta en Mercado Libre." };
    const envio = await enviarMensajeVentaMl({ token, siteId: ctx.cuenta.siteId ?? "", packOOrden: packId, vendedorId: ctx.cuenta.cuentaIdExterna, compradorId, texto, archivos });
    if (!envio.ok) return { ok: false, mensaje: envio.mensaje };
    await auditarMensaje(ctx, "posventa.mensaje_enviado", packId, archivos.length);
    return { ok: true, mensaje: "Mensaje enviado." };
  } catch (error) {
    console.warn(`[posventa/mensajes] envío falló: ${error instanceof Error ? error.name : "error"}`);
    return { ok: false, mensaje: "No se pudo enviar ahora. Intenta de nuevo en un momento." };
  }
}

// Solo sugiere: el texto llena la caja y una persona lo envía.
export async function sugerirRespuestaVentaAction(entrada: { cuentaId: string; packId: string; producto?: string | null; variacion?: string | null }): Promise<ResultadoSugerenciaAccion> {
  const resultado = await resolverContextoPosventa(entrada.cuentaId, permisoEscribir);
  if (!resultado.ok) return resultado;
  const { ctx } = resultado;
  if (typeof entrada.packId !== "string" || !PATRON_ID_PACK.test(entrada.packId)) return { ok: false, mensaje: "Datos inválidos." };
  if (superaLimiteIA(ctx.empresaId, ctx.usuarioId)) return { ok: false, mensaje: "Demasiadas sugerencias seguidas. Espera un minuto." };
  try {
    const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuenta.id);
    const mensajes = await leerConversacionMl(entrada.packId, ctx.cuenta.cuentaIdExterna, token);
    const r = await sugerirRespuestasPosventa(ctx.empresaId, {
      tipo: "mensaje",
      producto: typeof entrada.producto === "string" ? entrada.producto.slice(0, 200) : null,
      variacion: typeof entrada.variacion === "string" ? entrada.variacion.slice(0, 200) : null,
      mensajes: mensajes.slice(-8).map((m) => ({ autor: m.autor, texto: m.texto })),
    });
    if (r.estado === "ok") return { ok: true, opciones: r.opciones };
    return { ok: false, mensaje: r.mensaje, sinIA: r.estado === "sin_ia" };
  } catch {
    return { ok: false, mensaje: "No se pudieron generar sugerencias ahora." };
  }
}
