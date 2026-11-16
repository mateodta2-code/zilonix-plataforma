"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conMensaje } from "@/lib/finanzas/contexto-accion";
import { accesoBodega } from "@/lib/bodega/contexto";
import { CambioBodegaInvalidoError, cambiarActivoDeMiembro, cambiarRolDeMiembro } from "@/lib/bodega/miembros";

const RUTA = "/bodega/personas";

// Ambas acciones: solo admin_bodega (revalidado acá), nunca sobre uno
// mismo ni sobre otro administrador (lib/bodega/miembros.ts).
export async function cambiarRolBodegaAction(formData: FormData) {
  const { usuario, decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) throw new Error("No tienes permiso para cambiar roles.");
  let destino: string;
  try {
    const { antes, despues } = await cambiarRolDeMiembro(decision.membresia.bodegaId, usuario.id, String(formData.get("miembroId") ?? ""), String(formData.get("rol") ?? ""));
    revalidatePath(RUTA);
    destino = conMensaje(RUTA, "ok", antes === despues ? `Ya tenía el rol ${despues}.` : `Rol cambiado de ${antes} a ${despues}.`);
  } catch (error) {
    if (!(error instanceof CambioBodegaInvalidoError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}

export async function cambiarActivoAction(formData: FormData) {
  const { usuario, decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) throw new Error("No tienes permiso para desactivar personas.");
  const activo = String(formData.get("activo") ?? "") === "1";
  let destino: string;
  try {
    await cambiarActivoDeMiembro(decision.membresia.bodegaId, usuario.id, String(formData.get("miembroId") ?? ""), activo);
    revalidatePath(RUTA);
    destino = conMensaje(RUTA, "ok", activo ? "Persona reactivada." : "Persona desactivada.");
  } catch (error) {
    if (!(error instanceof CambioBodegaInvalidoError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}
