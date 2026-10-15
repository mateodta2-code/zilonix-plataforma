"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { ACCIONES, MODULOS, reemplazarPermisosDeRol, type Accion, type Modulo } from "@/lib/roles";

export async function guardarPermisosAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const empresaId = cookies().get("empresa_actual")?.value;
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresa = propias.find((e) => e.id === empresaId);
  if (!empresa) throw new Error("No se encontró tu empresa activa.");

  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  if (miMembresia?.rolNombre !== "Dueño") {
    throw new Error("Solo el Dueño puede ajustar permisos.");
  }

  const rolId = String(formData.get("rolId") ?? "");
  if (!rolId) throw new Error("Falta el rol.");

  const permisos: { modulo: Modulo; accion: Accion; alcance: "todo" | "propio" }[] = [];
  for (const modulo of MODULOS) {
    for (const accion of ACCIONES) {
      const valor = String(formData.get(`permiso__${modulo}__${accion}`) ?? "no");
      if (valor === "todo" || valor === "propio") {
        permisos.push({ modulo, accion, alcance: valor });
      }
    }
  }

  await reemplazarPermisosDeRol(empresa.id, rolId, permisos);
  revalidatePath(`/panel/roles/${rolId}`);
  redirect("/panel/roles");
}
