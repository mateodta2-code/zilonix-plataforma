"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { aceptarInvitacion } from "@/lib/invitaciones";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

export async function aceptarInvitacionAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const token = String(formData.get("token") ?? "");
  if (!token) throw new Error("Falta el token de la invitación.");

  const { empresaId } = await aceptarInvitacion(token, usuario.id);

  cookies().set("empresa_actual", empresaId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/panel");
}
