import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa, dbComoInvitacion } from "./empresa-context";
import { db } from "./index";
import { invitaciones, membresias, roles, usuarios } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearInvitacion, aceptarInvitacion } from "../lib/invitaciones";

async function insertarUsuarioDePrueba(id: string) {
  await db.insert(usuarios).values({ id, email: `prueba-${id.slice(0, 8)}@zilonix.test`, nombre: "Usuario de prueba 1.7" });
}

// Tarea 1.7 — prueba real de la política nueva de `invitaciones`
// (mitad "invitacion_token_actual", ver db/rls-setup.sql): quien tiene
// el token puede leer y aceptar esa fila puntual sin ser miembro de la
// empresa, pero nunca puede verla sin el token, ni ver la de otra
// empresa adivinando uno. Corre contra el mismo Postgres real que las
// pruebas de las tareas 1.4 y 1.6 — RLS no se simula con un mock.
//
// Issue #39 — empresaA/empresaB salen ahora de crearDosEmpresas()
// (db/test-utils/aislamiento.ts) en vez de armarse a mano acá.
describe("invitaciones por token (RLS, tarea 1.7)", () => {
  let contexto: ContextoDosEmpresas;
  let empresaAId: string;
  let empresaBId: string;
  const usuarioInvitadoId = randomUUID();
  let tokenA: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    empresaAId = contexto.empresaAId;
    empresaBId = contexto.empresaBId;
    await insertarUsuarioDePrueba(usuarioInvitadoId);

    const { token } = await crearInvitacion({
      empresaId: empresaAId,
      empresaNombre: "Empresa A (prueba 1.7)",
      email: "invitado-1.7@zilonix.test",
      rolNombre: "Operador",
      invitadoPor: usuarioInvitadoId, // solo necesita ser un usuario válido para la FK
    });
    tokenA = token;
  });

  it("con el token correcto, se puede leer la invitación sin ser miembro de la empresa", async () => {
    const vistas = await dbComoInvitacion(tokenA, null, (tx) => tx.select().from(invitaciones).where(eq(invitaciones.token, tokenA)));
    expect(vistas).toHaveLength(1);
    expect(vistas[0].rolNombre).toBe("Operador");
  });

  it("con un token adivinado (no existe), no se ve ninguna fila", async () => {
    const vistas = await dbComoInvitacion("token-adivinado-no-existe", null, (tx) => tx.select().from(invitaciones));
    expect(vistas).toHaveLength(0);
  });

  it("empresa B no ve la invitación de empresa A ni por su propio contexto normal", async () => {
    const vistas = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(invitaciones).where(eq(invitaciones.token, tokenA)));
    expect(vistas).toHaveLength(0);
  });

  it("aceptar la invitación crea la membresía y la marca aceptada", async () => {
    const { empresaId } = await aceptarInvitacion(tokenA, usuarioInvitadoId);
    expect(empresaId).toBe(empresaAId);

    const membresia = await dbComoEmpresa(empresaAId, (tx) =>
      tx.select().from(membresias).where(eq(membresias.usuarioId, usuarioInvitadoId))
    );
    expect(membresia).toHaveLength(1);

    const invitacion = await dbComoInvitacion(tokenA, null, (tx) => tx.select().from(invitaciones).where(eq(invitaciones.token, tokenA)));
    expect(invitacion[0].aceptadaTs).not.toBeNull();
  });

  it("aceptarla de nuevo (link abierto dos veces) no falla ni duplica la membresía", async () => {
    await expect(aceptarInvitacion(tokenA, usuarioInvitadoId)).resolves.toEqual({ empresaId: empresaAId });
    const membresia = await dbComoEmpresa(empresaAId, (tx) =>
      tx.select().from(membresias).where(eq(membresias.usuarioId, usuarioInvitadoId))
    );
    expect(membresia).toHaveLength(1);
  });

  it("una SEGUNDA invitación distinta a la misma empresa, para quien ya es miembro, no revienta la transacción", async () => {
    // Tarea 1.12 — bug real encontrado en vivo en staging: esto es
    // distinto al test de "aceptarla de nuevo" de arriba. Ahí
    // aceptadaTs YA estaba puesto en la MISMA fila, así que el insert
    // ni se intentaba. Acá es una invitación NUEVA (token distinto,
    // aceptadaTs todavía null) a la MISMA empresa para alguien que ya
    // es miembro por otro camino — el insert SÍ se intenta, choca con
    // la restricción única, y ahí es donde un try/catch sin savepoint
    // dejaba la transacción envenenada y el UPDATE de después también
    // fallaba.
    const { token: tokenSegunda } = await crearInvitacion({
      empresaId: empresaAId,
      empresaNombre: "Empresa A (prueba 1.7)",
      email: "invitado-1.7-otra-vez@zilonix.test",
      rolNombre: "Contador",
      invitadoPor: usuarioInvitadoId,
    });

    await expect(aceptarInvitacion(tokenSegunda, usuarioInvitadoId)).resolves.toEqual({ empresaId: empresaAId });

    const membresia = await dbComoEmpresa(empresaAId, (tx) =>
      tx.select().from(membresias).where(eq(membresias.usuarioId, usuarioInvitadoId))
    );
    expect(membresia).toHaveLength(1); // sigue siendo una sola, no duplicada

    const invitacionSegunda = await dbComoInvitacion(tokenSegunda, null, (tx) =>
      tx.select().from(invitaciones).where(eq(invitaciones.token, tokenSegunda))
    );
    expect(invitacionSegunda[0].aceptadaTs).not.toBeNull(); // el UPDATE sí corrió
  });

  it("una invitación ya vencida no se puede aceptar", async () => {
    const { token: tokenVencido } = await crearInvitacion({
      empresaId: empresaAId,
      empresaNombre: "Empresa A (prueba 1.7)",
      email: "vencido-1.7@zilonix.test",
      rolNombre: "Contador",
      invitadoPor: usuarioInvitadoId,
    });
    // Se vence a mano, directo en la base (sin pasar por la app), para
    // probar el caso sin esperar 7 días de verdad.
    await dbComoInvitacion(tokenVencido, null, (tx) =>
      tx.update(invitaciones).set({ expiraTs: new Date(Date.now() - 1000) }).where(eq(invitaciones.token, tokenVencido))
    );

    const otroUsuarioId = randomUUID();
    await insertarUsuarioDePrueba(otroUsuarioId);
    await expect(aceptarInvitacion(tokenVencido, otroUsuarioId)).rejects.toThrow();
  });

  // Issue #39 — plantilla genérica sobre invitaciones, independiente de
  // la política especial "por token" que prueban los "it" de arriba:
  // confirma que, por el camino normal (empresa_actual), el aislamiento
  // de siempre también sigue intacto en esta tabla.
  it("plantilla de aislamiento genérica (issue #39): empresa B nunca ve, edita ni borra una invitación de empresa A", async () => {
    const rolDePrueba = randomUUID();
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(roles).values({ id: rolDePrueba, nombre: "Rol de prueba (aislamiento)", empresaId: empresaAId })
    );

    await afirmarAislamiento(contexto, invitaciones, (tx, empresaId) =>
      tx
        .insert(invitaciones)
        .values({
          empresaId,
          email: `aislamiento-${randomUUID()}@zilonix.test`,
          rolId: rolDePrueba,
          empresaNombre: "Empresa de prueba (aislamiento)",
          rolNombre: "Rol de prueba",
          token: randomUUID(),
          invitadoPor: usuarioInvitadoId,
          expiraTs: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        })
        .returning({ id: invitaciones.id })
    );
  });
});
