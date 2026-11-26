"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { randomUUID } from "crypto";
import { CloudinaryNoConfiguradoError } from "@/lib/cloudinary";
import { validarImagenesTicket } from "@/lib/soporte/imagenes";
import { subirImagenesTicket } from "@/lib/soporte/subirImagenes";
import { crearTicket, obtenerMiTicket, requiereMiembroActivo, responderMiTicket, SoporteError } from "@/lib/soporte/tickets";
import { validarMensajeTicket, validarTicket } from "@/lib/soporte/validacion";

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
    if (error instanceof CloudinaryNoConfiguradoError) return { ok: false, error: "No se pudieron guardar las imágenes. Envía el mensaje sin ellas o vuelve a intentar más tarde." };
    console.error("[soporte] no se pudo guardar", error);
    return { ok: false, error: "No se pudo enviar. Vuelve a intentar en un momento." };
  }
}

// Capturas (25-nov): FormData con campos «imagen» (ya reducidas a JPEG en el
// navegador). Orden: se valida el texto, la membresía y las imágenes, y
// recién ahí se suben (privadas) con el id del ticket ya generado.
async function leerImagenes(datos: FormData | undefined): Promise<Uint8Array[]> {
  const archivos = (datos?.getAll?.("imagen") ?? []).filter((v): v is File => v instanceof File && v.size > 0);
  const bytes = await Promise.all(archivos.map(async (a) => new Uint8Array(await a.arrayBuffer())));
  const problema = validarImagenesTicket(bytes);
  if (problema) throw new SoporteError(problema);
  return bytes;
}

export async function abrirTicketAction(asunto: string, mensaje: string, modulo: string, imagenes?: FormData): Promise<EstadoTicketAccion> {
  return ejecutar(async (usuarioId, empresaId) => {
    validarTicket(asunto, mensaje, modulo);
    await requiereMiembroActivo(usuarioId, empresaId);
    const bytes = await leerImagenes(imagenes);
    const nuevoId = randomUUID();
    const ids = bytes.length > 0 ? await subirImagenesTicket(empresaId, nuevoId, bytes) : [];
    const ticketId = await crearTicket(usuarioId, empresaId, asunto, mensaje, modulo, { ticketId: nuevoId, imagenes: ids });
    revalidatePath("/panel/tickets");
    return { ok: true, ticketId };
  });
}

export async function responderTicketAction(ticketId: string, mensaje: string, imagenes?: FormData): Promise<EstadoTicketAccion> {
  return ejecutar(async (usuarioId, empresaId) => {
    validarMensajeTicket(mensaje);
    await requiereMiembroActivo(usuarioId, empresaId);
    const bytes = await leerImagenes(imagenes);
    let ids: string[] = [];
    if (bytes.length > 0) {
      // Antes de subir: el ticket es de su empresa (RLS) y sigue abierto.
      const ticket = await obtenerMiTicket(empresaId, ticketId);
      if (!ticket) throw new SoporteError("Ese ticket ya no está disponible.");
      if (ticket.estado === "resuelto") throw new SoporteError("Este ticket ya está resuelto. Abre uno nuevo si sigues con el problema.");
      ids = await subirImagenesTicket(empresaId, ticketId, bytes);
    }
    await responderMiTicket(usuarioId, empresaId, ticketId, mensaje, ids);
    revalidatePath(`/panel/tickets/${ticketId}`);
    revalidatePath("/panel/tickets");
    return { ok: true };
  });
}
