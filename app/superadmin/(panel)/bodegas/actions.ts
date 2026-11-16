"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { BodegaInvalidaError, crearBodega, invitarAdminBodega, reactivarBodega, suspenderBodega } from "@/lib/superadmin-bodegas";

// Toda acción pide sesión de superadmin propia y deja su renglón en
// auditoria (lib/superadmin-bodegas.ts). Un error esperado vuelve a la
// pantalla con su mensaje (?error=), nunca un 500.
function conError(ruta: string, error: unknown): never {
  if (!(error instanceof BodegaInvalidaError)) throw error;
  redirect(`${ruta}?error=${encodeURIComponent(error.message)}`);
}

export async function crearBodegaAction(formData: FormData) {
  const { usuarioId } = await requiereSesionSuperadmin();
  let id: string;
  try {
    ({ id } = await crearBodega(usuarioId, { nombre: String(formData.get("nombre") ?? ""), nit: String(formData.get("nit") ?? "") }));
  } catch (error) {
    conError("/superadmin/bodegas", error);
  }
  revalidatePath("/superadmin/bodegas");
  redirect(`/superadmin/bodegas/${id}`);
}

export async function invitarAdminBodegaAction(formData: FormData) {
  const { usuarioId } = await requiereSesionSuperadmin();
  const bodegaId = String(formData.get("bodegaId") ?? "");
  const ruta = `/superadmin/bodegas/${bodegaId}`;
  let token: string;
  try {
    ({ token } = await invitarAdminBodega(usuarioId, bodegaId, String(formData.get("email") ?? "")));
  } catch (error) {
    conError(ruta, error);
  }
  redirect(`${ruta}?token=${encodeURIComponent(token)}`);
}

export async function suspenderBodegaAction(formData: FormData) {
  const { usuarioId } = await requiereSesionSuperadmin();
  const bodegaId = String(formData.get("bodegaId") ?? "");
  try {
    await suspenderBodega(usuarioId, bodegaId, String(formData.get("motivo") ?? ""));
  } catch (error) {
    conError(`/superadmin/bodegas/${bodegaId}`, error);
  }
  revalidatePath("/superadmin/bodegas");
  redirect(`/superadmin/bodegas/${bodegaId}`);
}

export async function reactivarBodegaAction(formData: FormData) {
  const { usuarioId } = await requiereSesionSuperadmin();
  const bodegaId = String(formData.get("bodegaId") ?? "");
  try {
    await reactivarBodega(usuarioId, bodegaId);
  } catch (error) {
    conError(`/superadmin/bodegas/${bodegaId}`, error);
  }
  revalidatePath("/superadmin/bodegas");
  redirect(`/superadmin/bodegas/${bodegaId}`);
}
