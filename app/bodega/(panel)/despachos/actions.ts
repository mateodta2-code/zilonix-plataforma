"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conMensaje } from "@/lib/finanzas/contexto-accion";
import { accesoBodega } from "@/lib/bodega/contexto";
import { DespachoBodegaError, marcarPreparado } from "@/lib/bodega/despachos";

const RUTA = "/bodega/despachos";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// admin_bodega y operario. Descuenta stock y deja auditoría en una sola
// transacción (lib/bodega/despachos.ts); si no alcanza el stock, avisa y no
// descuenta nada.
export async function marcarPreparadoAction(formData: FormData) {
  const { usuario, decision } = await accesoBodega("bodega");
  if (!decision.ok) throw new Error("No tienes permiso para preparar despachos.");
  let destino: string;
  try {
    const despachoId = String(formData.get("despachoId") ?? "");
    if (!UUID_RE.test(despachoId)) throw new DespachoBodegaError("Despacho no válido.");
    await marcarPreparado(decision.membresia.bodegaId, usuario.id, despachoId, decision.membresia.rol);
    revalidatePath(RUTA);
    revalidatePath("/bodega/inventario");
    destino = conMensaje(RUTA, "ok", "Despacho preparado y stock descontado.");
  } catch (error) {
    if (!(error instanceof DespachoBodegaError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}
