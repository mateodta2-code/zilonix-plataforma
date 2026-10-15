"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { crearInvitacion } from "@/lib/invitaciones";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { NOMBRES_PLANTILLA, type NombrePlantilla } from "@/lib/roles";
import { requierePermiso } from "@/lib/permisos";

export async function crearInvitacionAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const empresaId = cookies().get("empresa_actual")?.value;
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresa = propias.find((e) => e.id === empresaId);
  if (!empresa) throw new Error("No se encontró tu empresa activa.");

  // Tarea 1.8 — invitar es "crear" en "personas". Reemplaza el
  // candado "solo el Dueño invita" de la 1.7: requierePermiso() lanza
  // SinPermisoError si el rol de quien manda el formulario no lo
  // tiene, aunque haya manipulado el HTML para saltarse la pantalla.
  await requierePermiso(usuario.id, empresa.id, "personas", "crear");

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
