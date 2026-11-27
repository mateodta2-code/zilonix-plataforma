"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conMensaje } from "@/lib/finanzas/contexto-accion";
import { accesoBodega } from "@/lib/bodega/contexto";
import { SedeBodegaError, cambiarActivaSede, crearSede, editarSede } from "@/lib/bodega/sedes";

const RUTA = "/bodega/sedes";

function datos(formData: FormData) {
  return { nombre: String(formData.get("nombre") ?? ""), direccion: String(formData.get("direccion") ?? ""), ciudad: String(formData.get("ciudad") ?? "") };
}

// Las tres acciones: solo admin_bodega (revalidado acá y otra vez en
// lib/bodega/sedes.ts + RLS). Nada se borra.
async function ejecutar(mensajeOk: string, trabajo: (bodegaId: string, usuarioId: string, rol: string) => Promise<void>) {
  const { usuario, decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) throw new Error("No tienes permiso para cambiar las sedes.");
  let destino: string;
  try {
    await trabajo(decision.membresia.bodegaId, usuario.id, decision.membresia.rol);
    revalidatePath(RUTA);
    destino = conMensaje(RUTA, "ok", mensajeOk);
  } catch (error) {
    if (!(error instanceof SedeBodegaError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}

export async function crearSedeAction(formData: FormData) {
  await ejecutar("Sede agregada.", (b, u, r) => crearSede(b, u, r, datos(formData)).then(() => undefined));
}

export async function editarSedeAction(formData: FormData) {
  await ejecutar("Sede guardada.", (b, u, r) => editarSede(b, u, r, String(formData.get("sedeId") ?? ""), datos(formData)));
}

export async function cambiarActivaSedeAction(formData: FormData) {
  const activa = String(formData.get("activa") ?? "") === "1";
  await ejecutar(activa ? "Sede reactivada." : "Sede desactivada.", (b, u, r) => cambiarActivaSede(b, u, r, String(formData.get("sedeId") ?? ""), activa));
}
