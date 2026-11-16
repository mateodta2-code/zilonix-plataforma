"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conMensaje } from "@/lib/finanzas/contexto-accion";
import { accesoBodega } from "@/lib/bodega/contexto";
import { CambioBodegaInvalidoError, actualizarDatosBodega } from "@/lib/bodega/miembros";

const RUTA = "/bodega/configuracion";

export async function guardarDatosBodegaAction(formData: FormData) {
  const { usuario, decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) throw new Error("No tienes permiso para editar la bodega.");
  let destino: string;
  try {
    await actualizarDatosBodega(decision.membresia.bodegaId, usuario.id, { nombre: String(formData.get("nombre") ?? ""), nit: String(formData.get("nit") ?? "") });
    revalidatePath("/bodega", "layout");
    destino = conMensaje(RUTA, "ok", "Datos guardados.");
  } catch (error) {
    if (!(error instanceof CambioBodegaInvalidoError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}
