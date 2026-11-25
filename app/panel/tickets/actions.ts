"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { crearTicket, responderMiTicket, SoporteError } from "@/lib/soporte/tickets";

export type EstadoTicketAccion = { ok: true; ticketId?: string } | { ok: false; error: string };

// Permiso: cualquier miembro de la empresa activa. La empresa y el
// usuario salen siempre de la sesión (obtenerContextoPanel), nunca de
// lo que mande el cliente; lib/soporte/tickets.ts vuelve a comprobar
// la membresía y la RLS por empresa es el candado final. Un error que
// no sea SoporteError nunca llega al cliente con su texto crudo.
async function ejecutar(fn: (usuarioId: string, empresaId: string) => Promise<EstadoTicketAccion>): Promise<EstadoTicketAccion> {
  const { usuario, activa } = await obtenerContextoPanel();
  if (!usuario) redirect("/sign-in");
  try {
    return await fn(usuario.id, activa.id);
  } catch (error) {
    if (error instanceof SoporteError) return { ok: false, error: error.message };
    console.error("[soporte] no se pudo guardar", error);
    return { ok: false, error: "No se pudo enviar. Vuelve a intentar en un momento." };
  }
}

export async function abrirTicketAction(asunto: string, mensaje: string, modulo: string): Promise<EstadoTicketAccion> {
  return ejecutar(async (usuarioId, empresaId) => {
    const ticketId = await crearTicket(usuarioId, empresaId, asunto, mensaje, modulo);
    revalidatePath("/panel/tickets");
    return { ok: true, ticketId };
  });
}

export async function responderTicketAction(ticketId: string, mensaje: string): Promise<EstadoTicketAccion> {
  return ejecutar(async (usuarioId, empresaId) => {
    await responderMiTicket(usuarioId, empresaId, ticketId, mensaje);
    revalidatePath(`/panel/tickets/${ticketId}`);
    revalidatePath("/panel/tickets");
    return { ok: true };
  });
}
