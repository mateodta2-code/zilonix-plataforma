"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_BODEGA_ACTUAL } from "@/lib/bodega/contexto";
import { InvitacionBodegaInvalidaError, aceptarInvitacionBodega } from "@/lib/bodega/invitaciones";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

export async function aceptarInvitacionBodegaAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token) throw new Error("Falta el token de la invitación.");
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect(`/bodega/iniciar-sesion?redirect_url=${encodeURIComponent(`/invitacion-bodega/${token}`)}`);

  let destino: string;
  try {
    const { bodegaId, rol } = await aceptarInvitacionBodega(token, usuario.id);
    cookies().set(COOKIE_BODEGA_ACTUAL, bodegaId, { httpOnly: true, sameSite: "lax", path: "/" });
    destino = rol === "domiciliario" ? "/domiciliario" : "/bodega";
  } catch (error) {
    if (!(error instanceof InvitacionBodegaInvalidaError)) throw error;
    destino = `/invitacion-bodega/${encodeURIComponent(token)}?error=${encodeURIComponent(error.message)}`;
  }
  redirect(destino);
}
