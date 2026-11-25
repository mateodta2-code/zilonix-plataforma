import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { crearTicket, listarMisTickets, obtenerMiTicket, responderMiTicket, SoporteError } from "../lib/soporte/tickets";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { dbSuperadmin } from "./superadmin-context";
import { auditoria, empresas, mensajesTicketSoporte, roles, membresias, ticketsSoporte, usuarios } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";

// Issue #623 (SA-Soporte, migración 0043) — contra Postgres real: la
// empresa solo ve sus tickets, el superadmin los ve todos pero solo
// puede cambiar estado y responder, y nadie borra ni se hace pasar
// por el otro.
describe("tickets_soporte (RLS, issue #623)", () => {
  let c: ContextoDosEmpresas;
  let ticketAId: string;
  const superadminId = randomUUID();

  beforeAll(async () => {
    c = await crearDosEmpresas();
    // crearTicket exige membresía: un rol y una membresía por empresa.
    for (const [empresaId, usuarioId] of [
      [c.empresaAId, c.usuarioAId],
      [c.empresaBId, c.usuarioBId],
    ] as const) {
      const rolId = randomUUID();
      await dbComoEmpresa(empresaId, async (tx) => {
        await tx.insert(roles).values({ id: rolId, nombre: "Dueño", empresaId });
        await tx.insert(membresias).values({ id: randomUUID(), usuarioId, empresaId, rolId });
      });
    }
    await db.insert(usuarios).values({ id: superadminId, email: `sa-soporte-${superadminId.slice(0, 8)}@zilonix.test`, nombre: "SA Soporte", esSuperadmin: true });

    const fila = await afirmarAislamiento(c, ticketsSoporte, (tx, empresaId) =>
      tx
        .insert(ticketsSoporte)
        .values({ empresaId, creadoPor: c.usuarioAId, asunto: "Ticket de A", mensaje: "Mensaje de A", modulo: "Pedidos" })
        .returning({ id: ticketsSoporte.id })
    );
    ticketAId = fila.id;
  });

  it("el ticket nace abierto y B no lo ve ni en la lista ni por id", async () => {
    const [a] = await listarMisTickets(c.empresaAId);
    expect(a.estado).toBe("abierto");
    expect(await listarMisTickets(c.empresaBId)).toHaveLength(0);
    expect(await obtenerMiTicket(c.empresaBId, ticketAId)).toBeNull();
    expect((await obtenerMiTicket(c.empresaAId, ticketAId))?.asunto).toBe("Ticket de A");
  });

  it("la empresa no puede abrir un ticket ya resuelto ni a nombre de otra empresa", async () => {
    await expect(
      dbComoEmpresa(c.empresaAId, (tx) =>
        tx.insert(ticketsSoporte).values({ empresaId: c.empresaAId, creadoPor: c.usuarioAId, asunto: "x", mensaje: "y", modulo: "Otro", estado: "resuelto" })
      )
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(c.empresaAId, (tx) =>
        tx.insert(ticketsSoporte).values({ empresaId: c.empresaBId, creadoPor: c.usuarioAId, asunto: "x", mensaje: "y", modulo: "Otro" })
      )
    ).rejects.toThrow();
  });

  it("la empresa no puede cambiar el estado ni borrar su ticket", async () => {
    await expect(dbComoEmpresa(c.empresaAId, (tx) => tx.update(ticketsSoporte).set({ estado: "resuelto" }).where(eq(ticketsSoporte.id, ticketAId)))).rejects.toThrow();
    await expect(dbComoEmpresa(c.empresaAId, (tx) => tx.delete(ticketsSoporte).where(eq(ticketsSoporte.id, ticketAId)))).rejects.toThrow();
  });

  it("crearTicket y responderMiTicket guardan el mensaje y dejan auditoría; B no puede responder el de A", async () => {
    const id = await crearTicket(c.usuarioAId, c.empresaAId, "Otro problema real", "No me deja conectar la cuenta", "Mercado Libre");
    await responderMiTicket(c.usuarioAId, c.empresaAId, id, "Adjunto más detalle");
    const detalle = await obtenerMiTicket(c.empresaAId, id);
    expect(detalle?.mensajes.map((m) => [m.mensaje, m.esSuperadmin])).toEqual([["Adjunto más detalle", false]]);

    await expect(responderMiTicket(c.usuarioBId, c.empresaBId, id, "intento de B")).rejects.toThrow(SoporteError);
    const acciones = await dbComoEmpresa(c.empresaAId, (tx) => tx.select({ accion: auditoria.accion }).from(auditoria).where(eq(auditoria.entidadId, id)));
    expect(acciones.map((f) => f.accion).sort()).toEqual(["abrir_ticket_soporte", "responder_ticket_soporte"]);
  });

  it("quien no es miembro de la empresa no abre tickets en ella", async () => {
    await expect(crearTicket(c.usuarioBId, c.empresaAId, "Ticket ajeno", "Intento de otra empresa", "Otro")).rejects.toThrow(SoporteError);
  });

  it("los mensajes siguen al ticket: B no los ve y no puede escribir en el ticket de A", async () => {
    await dbComoEmpresa(c.empresaAId, (tx) => tx.insert(mensajesTicketSoporte).values({ ticketId: ticketAId, autorUsuarioId: c.usuarioAId, mensaje: "hola" }));
    expect(await dbComoEmpresa(c.empresaBId, (tx) => tx.select().from(mensajesTicketSoporte).where(eq(mensajesTicketSoporte.ticketId, ticketAId)))).toHaveLength(0);
    await expect(
      dbComoEmpresa(c.empresaBId, (tx) => tx.insert(mensajesTicketSoporte).values({ ticketId: ticketAId, autorUsuarioId: c.usuarioBId, mensaje: "intruso" }))
    ).rejects.toThrow();
  });

  it("la empresa no se hace pasar por el superadmin", async () => {
    await expect(
      dbComoEmpresa(c.empresaAId, (tx) =>
        tx.insert(mensajesTicketSoporte).values({ ticketId: ticketAId, autorUsuarioId: c.usuarioAId, esSuperadmin: true, mensaje: "falso" })
      )
    ).rejects.toThrow();
  });

  it("el superadmin ve los tickets de ambas empresas, responde y cambia estado, sin borrar", async () => {
    const [ticketB] = await dbComoEmpresa(c.empresaBId, (tx) =>
      tx.insert(ticketsSoporte).values({ empresaId: c.empresaBId, creadoPor: c.usuarioBId, asunto: "Ticket de B", mensaje: "Mensaje de B", modulo: "Otro" }).returning({ id: ticketsSoporte.id })
    );
    const vistos = (await dbSuperadmin.select({ id: ticketsSoporte.id }).from(ticketsSoporte)).map((f) => f.id);
    expect(vistos).toEqual(expect.arrayContaining([ticketAId, ticketB.id]));

    await dbSuperadmin.insert(mensajesTicketSoporte).values({ ticketId: ticketAId, autorUsuarioId: superadminId, esSuperadmin: true, mensaje: "Estamos revisando" });
    await dbSuperadmin.update(ticketsSoporte).set({ estado: "en_curso", actualizadoTs: new Date() }).where(eq(ticketsSoporte.id, ticketAId));

    const detalle = await obtenerMiTicket(c.empresaAId, ticketAId);
    expect(detalle?.estado).toBe("en_curso");
    expect(detalle?.mensajes.some((m) => m.esSuperadmin && m.mensaje === "Estamos revisando")).toBe(true);

    // Solo estado y actualizado_ts; nunca el contenido, ni un mensaje de la empresa, ni borrar.
    await expect(dbSuperadmin.update(ticketsSoporte).set({ asunto: "reescrito" }).where(eq(ticketsSoporte.id, ticketAId))).rejects.toThrow();
    await expect(dbSuperadmin.delete(ticketsSoporte).where(eq(ticketsSoporte.id, ticketAId))).rejects.toThrow();
    await expect(
      dbSuperadmin.insert(mensajesTicketSoporte).values({ ticketId: ticketAId, autorUsuarioId: superadminId, esSuperadmin: false, mensaje: "disfrazado" })
    ).rejects.toThrow();
  });

  it("D8: superadmin_user no lee ninguna otra tabla de negocio de la empresa", async () => {
    // Ejemplo: pedidos y cuentas de Mercado Libre siguen vedados.
    await expect(dbSuperadmin.execute(sql`select 1 from pedidos limit 1`)).rejects.toThrow();
    await expect(dbSuperadmin.execute(sql`select 1 from cuentas_ml limit 1`)).rejects.toThrow();
    // La empresa existe en la lista agregada que ya veía; el ticket no amplía eso.
    expect(await dbSuperadmin.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, c.empresaAId))).toHaveLength(1);
  });
});
