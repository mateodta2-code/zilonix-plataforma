"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { CambioRolInvalidoError, cambiarRolDeMiembro } from "@/lib/personas";
import { requierePermiso } from "@/lib/permisos";

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
