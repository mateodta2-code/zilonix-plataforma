import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dbSuperadmin } from "@/db/superadmin-context";
import { auditoria, empresas, mensajesTicketSoporte, ticketsSoporte, usuarios } from "@/db/schema";
import { requiereSuperadmin } from "@/lib/superadmin";
import { ESTADOS_TICKET, esUuid, SoporteError, validarMensajeTicket, type EstadoTicket } from "@/lib/soporte/validacion";
import { esArchivoValido, publicIdDe } from "@/lib/soporte/imagenes";
import { archivosDe } from "@/lib/soporte/tickets";

// Issue #623, parte 2 — el superadmin atiende los tickets. Siempre con
// dbSuperadmin. D8: solo se lee el ticket, su conversación, el nombre de
// la empresa y el de quien escribe; nada de pedidos, productos ni compradores.

export type TicketParaAtender = {
  id: string;
  empresaId: string;
  empresaNombre: string;
  asunto: string;
  modulo: string;
  estado: EstadoTicket;
  creadoTs: Date;
  actualizadoTs: Date;
};

export function filtroEstadoValido(valor: unknown): EstadoTicket | undefined {
  return ESTADOS_TICKET.find((e) => e === valor);
}

export async function listarTodosLosTickets(superadminUsuarioId: string, estado?: EstadoTicket, limite = 200): Promise<TicketParaAtender[]> {
  await requiereSuperadmin(superadminUsuarioId);
  return dbSuperadmin
    .select({
      id: ticketsSoporte.id,
      empresaId: ticketsSoporte.empresaId,
      empresaNombre: empresas.nombre,
      asunto: ticketsSoporte.asunto,
      modulo: ticketsSoporte.modulo,
      estado: ticketsSoporte.estado,
      creadoTs: ticketsSoporte.creadoTs,
      actualizadoTs: ticketsSoporte.actualizadoTs,
    })
    .from(ticketsSoporte)
    .innerJoin(empresas, eq(empresas.id, ticketsSoporte.empresaId))
    .where(estado ? eq(ticketsSoporte.estado, estado) : undefined)
    .orderBy(desc(ticketsSoporte.actualizadoTs))
    .limit(limite);
}

export type MensajeParaAtender = { id: string; mensaje: string; esSuperadmin: boolean; autorNombre: string; creadoTs: Date };
export type TicketDetalleSuperadmin = TicketParaAtender & { mensaje: string; autorNombre: string; imagenes: string[]; mensajes: (MensajeParaAtender & { imagenes: string[] })[] };

export async function obtenerTicketParaAtender(superadminUsuarioId: string, ticketId: string): Promise<TicketDetalleSuperadmin | null> {
  await requiereSuperadmin(superadminUsuarioId);
  if (!esUuid(ticketId)) return null;
  const [ticket] = await dbSuperadmin
    .select({
      id: ticketsSoporte.id,
      empresaId: ticketsSoporte.empresaId,
      empresaNombre: empresas.nombre,
      asunto: ticketsSoporte.asunto,
      modulo: ticketsSoporte.modulo,
      estado: ticketsSoporte.estado,
      creadoTs: ticketsSoporte.creadoTs,
      actualizadoTs: ticketsSoporte.actualizadoTs,
      mensaje: ticketsSoporte.mensaje,
      autorNombre: usuarios.nombre,
      imagenes: ticketsSoporte.imagenes,
    })
    .from(ticketsSoporte)
    .innerJoin(empresas, eq(empresas.id, ticketsSoporte.empresaId))
    .innerJoin(usuarios, eq(usuarios.id, ticketsSoporte.creadoPor))
    .where(eq(ticketsSoporte.id, ticketId));
  if (!ticket) return null;
  const mensajes = await dbSuperadmin
    .select({
      id: mensajesTicketSoporte.id,
      mensaje: mensajesTicketSoporte.mensaje,
      esSuperadmin: mensajesTicketSoporte.esSuperadmin,
      autorNombre: usuarios.nombre,
      creadoTs: mensajesTicketSoporte.creadoTs,
      imagenes: mensajesTicketSoporte.imagenes,
    })
    .from(mensajesTicketSoporte)
    .innerJoin(usuarios, eq(usuarios.id, mensajesTicketSoporte.autorUsuarioId))
    .where(eq(mensajesTicketSoporte.ticketId, ticketId))
    .orderBy(asc(mensajesTicketSoporte.creadoTs));
  // Capturas (25-nov): lo que el vendedor adjuntó a propósito en su ticket,
  // como el texto. Solo los archivos de la carpeta de esa empresa y ese ticket.
  return {
    ...ticket,
    imagenes: archivosDe(ticket.imagenes, ticket.empresaId, ticketId),
    mensajes: mensajes.map((m) => ({ ...m, imagenes: archivosDe(m.imagenes, ticket.empresaId, ticketId) })),
  };
}

// El id privado de una captura para el SUPERADMIN: solo si está en ese ticket.
export async function imagenDeTicketSuperadmin(superadminUsuarioId: string, ticketId: string, archivo: string): Promise<string | null> {
  if (!esArchivoValido(archivo)) return null;
  const ticket = await obtenerTicketParaAtender(superadminUsuarioId, ticketId);
  if (!ticket) return null;
  const todas = [...ticket.imagenes, ...ticket.mensajes.flatMap((m) => m.imagenes)];
  return todas.includes(archivo) ? publicIdDe(ticket.empresaId, ticketId, archivo) : null;
}

// Responde y, si el ticket seguía abierto, lo pasa a «en curso».
// Todo en una transacción con su fila de auditoría.
export async function responderComoSuperadmin(superadminUsuarioId: string, ticketId: string, mensaje: unknown): Promise<void> {
  await requiereSuperadmin(superadminUsuarioId);
  const texto = validarMensajeTicket(mensaje);
  if (!esUuid(ticketId)) throw new SoporteError("Ese ticket ya no está disponible.");
  await dbSuperadmin.transaction(async (tx) => {
    const [ticket] = await tx
      .select({ empresaId: ticketsSoporte.empresaId, estado: ticketsSoporte.estado })
      .from(ticketsSoporte)
      .where(eq(ticketsSoporte.id, ticketId));
    if (!ticket) throw new SoporteError("Ese ticket ya no está disponible.");
    await tx.insert(mensajesTicketSoporte).values({ ticketId, autorUsuarioId: superadminUsuarioId, esSuperadmin: true, mensaje: texto });
    await tx
      .update(ticketsSoporte)
      .set({ actualizadoTs: new Date(), ...(ticket.estado === "abierto" ? { estado: "en_curso" as const } : {}) })
      .where(eq(ticketsSoporte.id, ticketId));
    await tx.insert(auditoria).values({
      id: randomUUID(),
      empresaId: ticket.empresaId,
      usuarioId: superadminUsuarioId,
      actorTipo: "persona",
      accion: "superadmin_responder_ticket_soporte",
      entidad: "tickets_soporte",
      entidadId: ticketId,
      detalle: "Soporte respondió un ticket",
    });
  });
}

export async function cambiarEstadoTicket(superadminUsuarioId: string, ticketId: string, estado: unknown): Promise<void> {
  await requiereSuperadmin(superadminUsuarioId);
  const nuevo = filtroEstadoValido(estado);
  if (!nuevo) throw new SoporteError("Estado no válido.");
  if (!esUuid(ticketId)) throw new SoporteError("Ese ticket ya no está disponible.");
  await dbSuperadmin.transaction(async (tx) => {
    const [ticket] = await tx
      .select({ empresaId: ticketsSoporte.empresaId, estado: ticketsSoporte.estado })
      .from(ticketsSoporte)
      .where(and(eq(ticketsSoporte.id, ticketId)));
    if (!ticket) throw new SoporteError("Ese ticket ya no está disponible.");
    if (ticket.estado === nuevo) return;
    await tx.update(ticketsSoporte).set({ estado: nuevo, actualizadoTs: new Date() }).where(eq(ticketsSoporte.id, ticketId));
    await tx.insert(auditoria).values({
      id: randomUUID(),
      empresaId: ticket.empresaId,
      usuarioId: superadminUsuarioId,
      actorTipo: "persona",
      accion: "superadmin_cambiar_estado_ticket_soporte",
      entidad: "tickets_soporte",
      entidadId: ticketId,
      valorAnterior: ticket.estado,
      valorNuevo: nuevo,
      detalle: "Soporte cambió el estado de un ticket",
    });
  });
}
