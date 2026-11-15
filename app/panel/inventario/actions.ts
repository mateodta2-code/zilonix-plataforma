"use server";

import { redirect } from "next/navigation";
import { requierePermiso } from "@/lib/permisos";
import { aplicarMovimientos } from "@/lib/inventario/movimientos";
import { resolverAlerta } from "@/lib/inventario/alertas";
import { conAviso, enteroDe, mensajeParaPersona, textoDe, usuarioYEmpresaActiva } from "@/lib/inventario/sesion";

const RUTA = "/panel/inventario";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El formulario trae un id generado al pintarse: un doble clic manda el
// mismo y el segundo envío no mueve nada (clave de idempotencia).
function claveManual(formData: FormData): string {
  const id = String(formData.get("operacionId") ?? "");
  if (!UUID_RE.test(id)) redirect(conAviso(RUTA, "error", "El formulario está vencido: recarga la página."));
  return `manual:${id}`;
}

export async function ajustarStockAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const nota = textoDe(formData.get("nota"));
  if (!nota) redirect(conAviso(RUTA, "error", "Un ajuste necesita el motivo (conteo, daño, pérdida...)."));
  const claveIdempotencia = claveManual(formData);
  let resultado;
  try {
    resultado = await aplicarMovimientos(empresaId, {
      claveIdempotencia,
      origen: "manual",
      actor: { tipo: "persona", usuarioId },
      nota,
      lineas: [
        {
          tipo: "ajuste",
          bodegaId: String(formData.get("bodegaId") ?? ""),
          skuId: String(formData.get("skuId") ?? ""),
          cantidad: enteroDe(formData.get("cantidad")),
        },
      ],
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", resultado.aplicado ? "Ajuste registrado en el kardex." : "Ese ajuste ya estaba registrado."));
}

export async function trasladarStockAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const claveIdempotencia = claveManual(formData);
  let resultado;
  try {
    resultado = await aplicarMovimientos(empresaId, {
      claveIdempotencia,
      origen: "traslado",
      actor: { tipo: "persona", usuarioId },
      nota: textoDe(formData.get("nota")),
      lineas: [
        {
          tipo: "traslado",
          bodegaId: String(formData.get("bodegaOrigenId") ?? ""),
          bodegaDestinoId: String(formData.get("bodegaDestinoId") ?? ""),
          skuId: String(formData.get("skuId") ?? ""),
          cantidad: enteroDe(formData.get("cantidad")),
        },
      ],
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", resultado.aplicado ? "Traslado registrado." : "Ese traslado ya estaba registrado."));
}

export async function resolverAlertaAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const decision = formData.get("decision") === "aplicar" ? "aplicada" : "descartada";
  try {
    await resolverAlerta(empresaId, usuarioId, String(formData.get("alertaId") ?? ""), decision);
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", decision === "aplicada" ? "Marcado como aplicado." : "Regla no aplicada para ese SKU."));
}
