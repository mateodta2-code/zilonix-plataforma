"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { crearInvitacion } from "@/lib/invitaciones";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { NOMBRES_PLANTILLA, type NombrePlantilla } from "@/lib/roles";

export async function crearInvitacionAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const empresaId = cookies().get("empresa_actual")?.value;
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresa = propias.find((e) => e.id === empresaId);
  if (!empresa) throw new Error("No se encontró tu empresa activa.");

  // Gatillo mínimo a propósito: solo el Dueño invita. La función
  // completa de permisos por acción ("¿puede autorizar en personas?")
  // es la tarea 1.8 — esto es un candado de sentido común mientras
  // tanto, no el mecanismo final.
  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  if (miMembresia?.rolNombre !== "Dueño") {
    throw new Error("Solo el Dueño de la empresa puede invitar.");
  }

  const email = String(formData.get("email") ?? "").trim();
  const rolNombre = String(formData.get("rol") ?? "") as NombrePlantilla;
  if (!email) throw new Error("El correo es obligatorio.");
  if (!NOMBRES_PLANTILLA.includes(rolNombre)) throw new Error("Elige un rol válido.");

  const { token } = await crearInvitacion({
    empresaId: empresa.id,
    empresaNombre: empresa.nombre,
    email,
    rolNombre,
    invitadoPor: usuario.id,
  });

  redirect(`/panel/invitar/listo?token=${encodeURIComponent(token)}`);
}
