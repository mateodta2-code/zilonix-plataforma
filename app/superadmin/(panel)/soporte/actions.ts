"use server";

import { revalidatePath } from "next/cache";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { cambiarEstadoTicket, responderComoSuperadmin } from "@/lib/soporte/superadmin";
import { SoporteError } from "@/lib/soporte/validacion";

export type ResultadoSoporte = { ok: true } | { ok: false; error: string };

// La sesión superadmin se pide acá y otra vez en lib/soporte/superadmin.ts.
// Un error que no sea SoporteError nunca llega al cliente con su texto crudo.
async function ejecutar(fn: (usuarioId: string) => Promise<void>, ticketId: string): Promise<ResultadoSoporte> {
  const { usuarioId } = await requiereSesionSuperadmin();
  try {
    await fn(usuarioId);
  } catch (error) {
    if (error instanceof SoporteError) return { ok: false, error: error.message };
    console.error("[soporte-superadmin] no se pudo guardar", error);
    return { ok: false, error: "No se pudo guardar. Vuelve a intentar en un momento." };
  }
  revalidatePath("/superadmin/soporte");
  revalidatePath(`/superadmin/soporte/${ticketId}`);
  revalidatePath(`/panel/tickets/${ticketId}`);
  return { ok: true };
}

export async function responderTicketSuperadminAction(ticketId: string, mensaje: string): Promise<ResultadoSoporte> {
  return ejecutar((u) => responderComoSuperadmin(u, ticketId, mensaje), ticketId);
}

export async function cambiarEstadoTicketAction(ticketId: string, estado: string): Promise<ResultadoSoporte> {
  return ejecutar((u) => cambiarEstadoTicket(u, ticketId, estado), ticketId);
}
