"use server";

import { revalidatePath } from "next/cache";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { cambiarPlanEmpresa, editarNotasEmpresa, reactivarEmpresa, suspenderEmpresa } from "@/lib/superadmin-empresas";

// Toda acción pide sesión de superadmin propia y deja su renglón en
// auditoria (lib/superadmin-empresas.ts). El id de la empresa viene de un
// campo oculto: se valida como uuid dentro de la consulta, nunca se usa en SQL crudo.
async function entrada(formData: FormData) {
  const { usuarioId } = await requiereSesionSuperadmin();
  const empresaId = String(formData.get("empresaId") ?? "");
  return { usuarioId, empresaId };
}

function refrescar(empresaId: string) {
  revalidatePath("/superadmin");
  revalidatePath(`/superadmin/${empresaId}`);
}

export async function cambiarPlanAction(formData: FormData) {
  const { usuarioId, empresaId } = await entrada(formData);
  await cambiarPlanEmpresa(usuarioId, empresaId, String(formData.get("plan") ?? ""));
  refrescar(empresaId);
}

export async function suspenderAction(formData: FormData) {
  const { usuarioId, empresaId } = await entrada(formData);
  await suspenderEmpresa(usuarioId, empresaId, String(formData.get("motivo") ?? ""));
  refrescar(empresaId);
}

export async function reactivarAction(formData: FormData) {
  const { usuarioId, empresaId } = await entrada(formData);
  await reactivarEmpresa(usuarioId, empresaId);
  refrescar(empresaId);
}

export async function editarNotasAction(formData: FormData) {
  const { usuarioId, empresaId } = await entrada(formData);
  await editarNotasEmpresa(usuarioId, empresaId, String(formData.get("notas") ?? ""));
  refrescar(empresaId);
}
