import { and, asc, desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { mensajesTicketSoporte, ticketsSoporte, usuarios } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { obtenerMiMembresia } from "@/lib/membresias";
import { creaContador, limpiarVencidos, superaLimite } from "@/lib/limite-peticiones";
import { esUuid, SoporteError, validarMensajeTicket, validarTicket, type EstadoTicket } from "@/lib/soporte/validacion";

export { SoporteError } from "@/lib/soporte/validacion";

// Issue #623 — el vendedor abre tickets de soporte. Permiso: cualquier
// miembro de la empresa (no hay un módulo "soporte" en los roles). Todo
// va por dbComoEmpresa: la RLS por empresa_id es la garantía real; lo
// de acá es el candado de "quién eres" con el usuario de la sesión.

// Freno contra spam: 5 tickets o mensajes por persona cada 10 minutos.
const VENTANA_MS = 10 * 60 * 1000;
const LIMITE = 5;
const envios = creaContador();

function frenarSpam(usuarioId: string): void {
  if (envios.size > 1000) limpiarVencidos(envios, VENTANA_MS);
  if (superaLimite(envios, usuarioId, LIMITE, VENTANA_MS)) {
    throw new SoporteError("Enviaste muchos mensajes seguidos. Espera unos minutos y vuelve a intentar.");
  }
}

export async function requiereMiembroActivo(usuarioId: string, empresaId: string): Promise<void> {
  const membresia = await obtenerMiMembresia(usuarioId, empresaId);
  if (!membresia) throw new SoporteError("No eres miembro de esta empresa.");
}

export type TicketResumen = { id: string; asunto: string; modulo: string; estado: EstadoTicket; creadoTs: Date; actualizadoTs: Date };

export async function listarMisTickets(empresaId: string): Promise<TicketResumen[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: ticketsSoporte.id,
        asunto: ticketsSoporte.asunto,
        modulo: ticketsSoporte.modulo,
        estado: ticketsSoporte.estado,
        creadoTs: ticketsSoporte.creadoTs,
        actualizadoTs: ticketsSoporte.actualizadoTs,
      })
      .from(ticketsSoporte)
      .where(eq(ticketsSoporte.empresaId, empresaId))
      .orderBy(desc(ticketsSoporte.actualizadoTs))
      .limit(100)
  );
}

export async function crearTicket(usuarioId: string, empresaId: string, asunto: unknown, mensaje: unknown, modulo: unknown): Promise<string> {
  const datos = validarTicket(asunto, mensaje, modulo);
  await requiereMiembroActivo(usuarioId, empresaId);
  frenarSpam(usuarioId);
  return dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx
      .insert(ticketsSoporte)
      .values({ empresaId, creadoPor: usuarioId, ...datos })
      .returning({ id: ticketsSoporte.id });
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "abrir_ticket_soporte",
      entidad: "tickets_soporte",
      entidadId: fila.id,
      detalle: `Abrió el ticket de soporte «${datos.asunto}»`,
    });
    return fila.id;
  });
}

export type MensajeTicket = { id: string; mensaje: string; esSuperadmin: boolean; autorNombre: string; creadoTs: Date };
export type TicketDetalle = TicketResumen & { mensaje: string; autorNombre: string; mensajes: MensajeTicket[] };

// null = no existe o es de otra empresa (la RLS no la deja ver).
export async function obtenerMiTicket(empresaId: string, ticketId: string): Promise<TicketDetalle | null> {
  if (!esUuid(ticketId)) return null;
  return dbComoEmpresa(empresaId, async (tx) => {
    const [ticket] = await tx
      .select({
        id: ticketsSoporte.id,
        asunto: ticketsSoporte.asunto,
        modulo: ticketsSoporte.modulo,
        estado: ticketsSoporte.estado,
        creadoTs: ticketsSoporte.creadoTs,
        actualizadoTs: ticketsSoporte.actualizadoTs,
        mensaje: ticketsSoporte.mensaje,
        autorNombre: usuarios.nombre,
      })
      .from(ticketsSoporte)
      .innerJoin(usuarios, eq(usuarios.id, ticketsSoporte.creadoPor))
      .where(and(eq(ticketsSoporte.id, ticketId), eq(ticketsSoporte.empresaId, empresaId)));
    if (!ticket) return null;

    const mensajes = await tx
      .select({
        id: mensajesTicketSoporte.id,
        mensaje: mensajesTicketSoporte.mensaje,
        esSuperadmin: mensajesTicketSoporte.esSuperadmin,
        autorNombre: usuarios.nombre,
        creadoTs: mensajesTicketSoporte.creadoTs,
      })
      .from(mensajesTicketSoporte)
      .innerJoin(usuarios, eq(usuarios.id, mensajesTicketSoporte.autorUsuarioId))
      .where(eq(mensajesTicketSoporte.ticketId, ticketId))
      .orderBy(asc(mensajesTicketSoporte.creadoTs));
    return { ...ticket, mensajes };
  });
}

// El vendedor responde en su ticket; uno resuelto no admite más
// mensajes (abre otro) porque el estado solo lo cambia el superadmin.
export async function responderMiTicket(usuarioId: string, empresaId: string, ticketId: string, mensaje: unknown): Promise<void> {
  const texto = validarMensajeTicket(mensaje);
  await requiereMiembroActivo(usuarioId, empresaId);
  if (!esUuid(ticketId)) throw new SoporteError("Ese ticket ya no está disponible.");
  frenarSpam(usuarioId);
  await dbComoEmpresa(empresaId, async (tx) => {
    const [ticket] = await tx
      .select({ estado: ticketsSoporte.estado })
      .from(ticketsSoporte)
      .where(and(eq(ticketsSoporte.id, ticketId), eq(ticketsSoporte.empresaId, empresaId)));
    if (!ticket) throw new SoporteError("Ese ticket ya no está disponible.");
    if (ticket.estado === "resuelto") throw new SoporteError("Este ticket ya está resuelto. Abre uno nuevo si sigues con el problema.");
    await tx.insert(mensajesTicketSoporte).values({ ticketId, autorUsuarioId: usuarioId, esSuperadmin: false, mensaje: texto });
    await tx.update(ticketsSoporte).set({ actualizadoTs: new Date() }).where(eq(ticketsSoporte.id, ticketId));
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "responder_ticket_soporte",
      entidad: "tickets_soporte",
      entidadId: ticketId,
      detalle: "Escribió en su ticket de soporte",
    });
  });
}
