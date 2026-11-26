"use server";

import { revalidatePath } from "next/cache";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { CloudinaryNoConfiguradoError } from "@/lib/cloudinary";
import { leerImagenesTicket } from "@/lib/soporte/leerImagenes";
import { subirImagenesTicket } from "@/lib/soporte/subirImagenes";
import { cambiarEstadoTicket, obtenerTicketParaAtender, responderComoSuperadmin } from "@/lib/soporte/superadmin";
import { SoporteError, validarMensajeTicket } from "@/lib/soporte/validacion";

export type ResultadoSoporte = { ok: true } | { ok: false; error: string };

// La sesión superadmin se pide acá y otra vez en lib/soporte/superadmin.ts.
// Un error que no sea SoporteError nunca llega al cliente con su texto crudo.
async function ejecutar(fn: (usuarioId: string) => Promise<void>, ticketId: string): Promise<ResultadoSoporte> {
  const { usuarioId } = await requiereSesionSuperadmin();
  try {
    await fn(usuarioId);
  } catch (error) {
    if (error instanceof SoporteError) return { ok: false, error: error.message };
    if (error instanceof CloudinaryNoConfiguradoError) return { ok: false, error: "No se pudieron guardar las imágenes: falta configurar Cloudinary." };
    console.error("[soporte-superadmin] no se pudo guardar", error);
    return { ok: false, error: "No se pudo guardar. Vuelve a intentar en un momento." };
  }
  revalidatePath("/superadmin/soporte");
  revalidatePath(`/superadmin/soporte/${ticketId}`);
  revalidatePath(`/panel/tickets/${ticketId}`);
  return { ok: true };
}

// Capturas (25-nov): se valida el texto y las imágenes, se confirma que el
// ticket existe, y recién ahí se suben a la carpeta privada de SU empresa
// (así el vendedor las ve en su ticket, como las suyas).
export async function responderTicketSuperadminAction(ticketId: string, mensaje: string, imagenes?: FormData): Promise<ResultadoSoporte> {
  return ejecutar(async (u) => {
    validarMensajeTicket(mensaje);
    const bytes = await leerImagenesTicket(imagenes);
    let ids: string[] = [];
    if (bytes.length > 0) {
      const ticket = await obtenerTicketParaAtender(u, ticketId);
      if (!ticket) throw new SoporteError("Ese ticket ya no está disponible.");
      ids = await subirImagenesTicket(ticket.empresaId, ticketId, bytes);
    }
    await responderComoSuperadmin(u, ticketId, mensaje, ids);
  }, ticketId);
}

export async function cambiarEstadoTicketAction(ticketId: string, estado: string): Promise<ResultadoSoporte> {
  return ejecutar((u) => cambiarEstadoTicket(u, ticketId, estado), ticketId);
}
