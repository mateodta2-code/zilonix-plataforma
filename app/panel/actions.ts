"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Tarea 1.6 — el selector de "cambiar de empresa en 1 clic". Nunca
// confía a ciegas en el empresaId que manda el formulario: lo revisa
// contra las membresías reales del usuario antes de activarlo. RLS ya
// bloquearía igual una empresa ajena (política aislamiento_empresas),
// pero así el error es un mensaje claro en vez de una pantalla vacía
// sin explicación.
export async function cambiarEmpresaActiva(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const empresaId = String(formData.get("empresaId") ?? "");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  if (!propias.some((e) => e.id === empresaId)) {
    throw new Error("No tienes membresía en esa empresa.");
  }

  cookies().set("empresa_actual", empresaId, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/panel");
}
