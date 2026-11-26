import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { crearTicket, imagenDeMiTicket, obtenerMiTicket, responderMiTicket, SoporteError } from "../lib/soporte/tickets";
import { imagenDeTicketSuperadmin, obtenerTicketParaAtender, responderComoSuperadmin } from "../lib/soporte/superadmin";
import { carpetaSoporte } from "../lib/soporte/imagenes";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { mensajesTicketSoporte, membresias, roles, ticketsSoporte, usuarios } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";

// Capturas en tickets de soporte (25-nov, migración 0052) — contra Postgres
// real. En la base solo se guardan ids privados de Cloudinary; acá no se
// sube nada. Lo que se prueba: solo se aceptan ids de la carpeta de esa
// empresa y ese ticket, cada empresa ve solo las suyas, el superadmin ve
// las del ticket que atiende y nadie las cambia después.
describe("tickets_soporte: imágenes", () => {
  let c: ContextoDosEmpresas;
  const superadminId = randomUUID();
  const ticketId = randomUUID();
  const a1 = randomUUID();
  const a2 = randomUUID();
  const r1 = randomUUID();
  const id = (empresaId: string, ticket: string, archivo: string) => `${carpetaSoporte(empresaId)}/${ticket}-${archivo}`;

  beforeAll(async () => {
    c = await crearDosEmpresas();
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
    await db.insert(usuarios).values({ id: superadminId, email: `sa-img-${superadminId.slice(0, 8)}@zilonix.test`, nombre: "SA Imagenes", esSuperadmin: true });
    await crearTicket(c.usuarioAId, c.empresaAId, "No cargan mis pedidos", "Al abrir Pedidos sale un error en blanco.", "Pedidos", {
      ticketId,
      imagenes: [id(c.empresaAId, ticketId, a1), id(c.empresaAId, ticketId, a2)],
    });
    await responderMiTicket(c.usuarioAId, c.empresaAId, ticketId, "Otra captura", [id(c.empresaAId, ticketId, r1)]);
  });

  it("el vendedor ve las capturas del ticket y de sus mensajes", async () => {
    const t = await obtenerMiTicket(c.empresaAId, ticketId);
    expect(t?.imagenes).toEqual([a1, a2]);
    expect(t?.mensajes[0].imagenes).toEqual([r1]);
    await expect(imagenDeMiTicket(c.empresaAId, ticketId, a1)).resolves.toBe(id(c.empresaAId, ticketId, a1));
    await expect(imagenDeMiTicket(c.empresaAId, ticketId, r1)).resolves.toBe(id(c.empresaAId, ticketId, r1));
    // Un archivo que no está en el ticket, no.
    await expect(imagenDeMiTicket(c.empresaAId, ticketId, randomUUID())).resolves.toBeNull();
  });

  it("otra empresa no ve el ticket ni sus capturas", async () => {
    await expect(obtenerMiTicket(c.empresaBId, ticketId)).resolves.toBeNull();
    await expect(imagenDeMiTicket(c.empresaBId, ticketId, a1)).resolves.toBeNull();
  });

  it("el superadmin ve las capturas del ticket que atiende", async () => {
    const t = await obtenerTicketParaAtender(superadminId, ticketId);
    expect(t?.imagenes).toEqual([a1, a2]);
    await expect(imagenDeTicketSuperadmin(superadminId, ticketId, r1)).resolves.toBe(id(c.empresaAId, ticketId, r1));
    await expect(imagenDeTicketSuperadmin(superadminId, ticketId, randomUUID())).resolves.toBeNull();
  });

  it("no acepta ids de otra carpeta (otra empresa, otro ticket o una foto de entrega)", async () => {
    const otro = randomUUID();
    // Otra empresa (mismo ticket), otro ticket (misma empresa) y una foto de entrega.
    for (const ajeno of [id(c.empresaAId, otro, randomUUID()), id(c.empresaBId, randomUUID(), randomUUID()), `zilonix-entregas/${c.empresaBId}/${randomUUID()}`]) {
      await expect(crearTicket(c.usuarioBId, c.empresaBId, "Asunto de prueba", "Mensaje de prueba largo", "Otro", { ticketId: otro, imagenes: [ajeno] })).rejects.toBeInstanceOf(SoporteError);
    }
  });

  it("si un id ajeno llegara a la base igual, nunca se sirve", async () => {
    // Inserción directa (saltándose la lib) con un id de otra empresa.
    const colado = randomUUID();
    await dbComoEmpresa(c.empresaBId, (tx) =>
      tx.insert(ticketsSoporte).values({ id: colado, empresaId: c.empresaBId, creadoPor: c.usuarioBId, asunto: "Colado", mensaje: "Intento colado", modulo: "Otro", imagenes: [id(c.empresaAId, ticketId, a1)] })
    );
    const t = await obtenerMiTicket(c.empresaBId, colado);
    expect(t?.imagenes).toEqual([]);
    await expect(imagenDeMiTicket(c.empresaBId, colado, a1)).resolves.toBeNull();
  });

  it("máximo 3 por mensaje (también en la base) y nadie las cambia después", async () => {
    await expect(
      dbComoEmpresa(c.empresaAId, (tx) =>
        tx.insert(mensajesTicketSoporte).values({ ticketId, autorUsuarioId: c.usuarioAId, mensaje: "cuatro", imagenes: [1, 2, 3, 4].map(() => id(c.empresaAId, ticketId, randomUUID())) })
      )
    ).rejects.toThrow();
    await expect(dbComoEmpresa(c.empresaAId, (tx) => tx.update(ticketsSoporte).set({ imagenes: [] }).where(eq(ticketsSoporte.id, ticketId)))).rejects.toThrow();
    await expect(dbComoEmpresa(c.empresaAId, (tx) => tx.update(mensajesTicketSoporte).set({ imagenes: [] }).where(eq(mensajesTicketSoporte.ticketId, ticketId)))).rejects.toThrow();
  });

  it("el superadmin responde con capturas y la empresa las ve en su ticket", async () => {
    const s1 = randomUUID();
    await responderComoSuperadmin(superadminId, ticketId, "Mira esta captura", [id(c.empresaAId, ticketId, s1)]);
    const t = await obtenerMiTicket(c.empresaAId, ticketId);
    const deSoporte = t?.mensajes.find((m) => m.esSuperadmin);
    expect(deSoporte?.imagenes).toEqual([s1]);
    await expect(imagenDeMiTicket(c.empresaAId, ticketId, s1)).resolves.toBe(id(c.empresaAId, ticketId, s1));
    await expect(imagenDeTicketSuperadmin(superadminId, ticketId, s1)).resolves.toBe(id(c.empresaAId, ticketId, s1));
    // Otra empresa, no.
    await expect(imagenDeMiTicket(c.empresaBId, ticketId, s1)).resolves.toBeNull();
  });

  it("el superadmin tampoco puede adjuntar ids de otra carpeta", async () => {
    await expect(responderComoSuperadmin(superadminId, ticketId, "Captura ajena", [id(c.empresaBId, ticketId, randomUUID())])).rejects.toBeInstanceOf(SoporteError);
    await expect(responderComoSuperadmin(superadminId, ticketId, "Foto de entrega", [`zilonix-entregas/${c.empresaAId}/${randomUUID()}`])).rejects.toBeInstanceOf(SoporteError);
  });
});
