"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { CambioRolInvalidoError, cambiarRolDeMiembro, QuitarAccesoInvalidoError, quitarAccesoDeMiembro } from "@/lib/personas";
import { requierePermiso, SoloDuenoError } from "@/lib/permisos";

// Issue #370 — cambiar el rol de alguien de la empresa sin volver a
// invitarlo. Pide personas.modificar acá y otra vez en
// cambiarRolDeMiembro (lib/personas.ts), que además aplica la regla de
// no escalada, protege al Dueño y deja el cambio en la bitácora.

const RUTA = "/panel/personas";

export async function cambiarRolAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "personas", "modificar");

  const membresiaId = String(formData.get("membresiaId") ?? "");
  const claveRol = String(formData.get("rol") ?? "");

  let destino: string;
  try {
    const { antes, despues } = await cambiarRolDeMiembro(empresaId, usuarioId, membresiaId, claveRol);
    revalidatePath(RUTA);
    destino = conMensaje(RUTA, "ok", antes === despues ? `Ya tenía el rol ${despues}.` : `Rol cambiado de ${antes} a ${despues}.`);
  } catch (error) {
    if (!(error instanceof CambioRolInvalidoError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}

// 25-nov — «Quitar acceso» (solo el Dueño; quitarAccesoDeMiembro lo vuelve
// a exigir y protege al Dueño y a uno mismo).
export async function quitarAccesoAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  const membresiaId = String(formData.get("membresiaId") ?? "");

  let destino: string;
  try {
    const { email } = await quitarAccesoDeMiembro(empresaId, usuarioId, membresiaId);
    revalidatePath(RUTA);
    destino = conMensaje(RUTA, "ok", `${email} ya no tiene acceso a la empresa.`);
  } catch (error) {
    if (!(error instanceof QuitarAccesoInvalidoError) && !(error instanceof SoloDuenoError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}

