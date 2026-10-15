import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa, dbComoUsuario } from "./empresa-context";
import { db } from "./index";
import { empresas, membresias, roles, usuarios } from "./schema";

// Tarea 1.6 — prueba real de la política nueva que agrega esta tarea a
// rls-setup.sql (aislamiento_empresas/aislamiento_membresias, mitad
// "usuario_actual"): un usuario con membresía en varias empresas puede
// listarlas todas para el selector, pero nunca ve la membresía ni la
// empresa de otra persona. Corre contra el mismo Postgres real que la
// prueba de la tarea 1.4 (ver ese archivo) — RLS no se puede probar con
// un mock.

describe("listar las empresas propias de un usuario (RLS, tarea 1.6)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  const empresaCId = randomUUID();
  const usuario1Id = randomUUID();
  const usuario2Id = randomUUID();

  beforeAll(async () => {
    // usuario1 queda en 2 empresas (A y B); usuario2 queda en una
    // tercera (C) que usuario1 nunca debe ver.
    await db.insert(usuarios).values([
      { id: usuario1Id, email: `u1-${usuario1Id.slice(0, 8)}@zilonix.test`, nombre: "Usuario 1 (prueba 1.6)" },
      { id: usuario2Id, email: `u2-${usuario2Id.slice(0, 8)}@zilonix.test`, nombre: "Usuario 2 (prueba 1.6)" },
    ]);

    for (const [empresaId, nombre] of [
      [empresaAId, "Empresa A (prueba 1.6)"],
      [empresaBId, "Empresa B (prueba 1.6)"],
      [empresaCId, "Empresa C (prueba 1.6)"],
    ] as const) {
      const rolId = randomUUID();
      const usuarioDueno = empresaId === empresaCId ? usuario2Id : usuario1Id;
      await dbComoEmpresa(empresaId, async (tx) => {
        await tx.insert(empresas).values({ id: empresaId, nombre, nit: `TEST-${empresaId.slice(0, 8)}` });
        await tx.insert(roles).values({ id: rolId, nombre: "Dueño", empresaId });
        await tx.insert(membresias).values({ id: randomUUID(), usuarioId: usuarioDueno, empresaId, rolId });
      });
    }
  });

  it("usuario1 ve exactamente sus 2 empresas (A y B), nunca la C", async () => {
    const vistas = await dbComoUsuario(usuario1Id, (tx) =>
      tx
        .select({ id: empresas.id })
        .from(membresias)
        .innerJoin(empresas, eq(membresias.empresaId, empresas.id))
        .where(eq(membresias.usuarioId, usuario1Id))
    );
    const ids = vistas.map((v) => v.id).sort();
    expect(ids).toEqual([empresaAId, empresaBId].sort());
  });

  it("usuario2 ve exactamente su empresa C, nunca A ni B", async () => {
    const vistas = await dbComoUsuario(usuario2Id, (tx) =>
      tx
        .select({ id: empresas.id })
        .from(membresias)
        .innerJoin(empresas, eq(membresias.empresaId, empresas.id))
        .where(eq(membresias.usuarioId, usuario2Id))
    );
    expect(vistas.map((v) => v.id)).toEqual([empresaCId]);
  });

  it("usuario1 no puede listar la membresía de usuario2 pidiéndola directo", async () => {
    const vistas = await dbComoUsuario(usuario1Id, (tx) =>
      tx.select().from(membresias).where(eq(membresias.usuarioId, usuario2Id))
    );
    expect(vistas).toHaveLength(0);
  });

  it("el cambio no afecta el aislamiento ya probado en 1.4: con empresa A activa, sigue sin verse la empresa B", async () => {
    const vistas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(empresas).where(eq(empresas.id, empresaBId)));
    expect(vistas).toHaveLength(0);
  });
});
