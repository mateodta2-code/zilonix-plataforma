"use server";

import { redirect } from "next/navigation";
import { accesoBodega } from "@/lib/bodega/contexto";
import { crearInvitacionBodega } from "@/lib/bodega/invitaciones";

// Solo admin_bodega, revalidado acá (el HTML se puede manipular).
export async function crearInvitacionBodegaAction(formData: FormData) {
  const { usuario, decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) throw new Error("No tienes permiso para invitar personas.");

  const { token } = await crearInvitacionBodega({
    bodegaId: decision.membresia.bodegaId,
    bodegaNombre: decision.membresia.bodegaNombre,
    email: String(formData.get("email") ?? ""),
    rol: String(formData.get("rol") ?? ""),
    invitadoPor: usuario.id,
  });
  redirect(`/bodega/invitar/listo?token=${encodeURIComponent(token)}`);
}
