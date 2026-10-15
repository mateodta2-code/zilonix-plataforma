"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { concederAccesoTemporal, revocarAccesoTemporal } from "@/lib/acceso-temporal";

async function empresaYUsuarioDeQuienLlama() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const empresaId = cookies().get("empresa_actual")?.value;
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresa = propias.find((e) => e.id === empresaId);
  if (!empresa) throw new Error("No se encontró tu empresa activa.");

  // Tarea 1.11 — conceder o revocar acceso a soporte es tan sensible
  // como ajustar permisos: mismo candado que usa /panel/roles.
  await requierePermiso(usuario.id, empresa.id, "configuracion", "autorizar");

  return { empresa, usuarioId: usuario.id };
}

export async function concederAccesoAction(formData: FormData) {
  const { empresa, usuarioId } = await empresaYUsuarioDeQuienLlama();

  const alcance = String(formData.get("alcance") ?? "").trim();
  const horas = Number(formData.get("horas") ?? 0);
  if (!alcance) throw new Error("Describe qué puede ver soporte.");
  if (!Number.isFinite(horas) || horas <= 0 || horas > 24 * 15) {
    // 15 días (360h) — mismo tope que ya probó funcionar en Olist Tiny
    // (docs/investigacion/olist-tiny.md, sección D).
    throw new Error("Las horas de validez tienen que estar entre 1 y 360 (15 días).");
  }

  await concederAccesoTemporal(empresa.id, usuarioId, alcance, horas);
  revalidatePath("/panel/soporte");
}

export async function revocarAccesoAction(formData: FormData) {
  const { empresa, usuarioId } = await empresaYUsuarioDeQuienLlama();

  const accesoId = String(formData.get("accesoId") ?? "");
  if (!accesoId) throw new Error("Falta el acceso a revocar.");

  await revocarAccesoTemporal(empresa.id, accesoId, usuarioId);
  revalidatePath("/panel/soporte");
}
