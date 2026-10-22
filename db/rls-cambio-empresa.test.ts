import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa, dbComoUsuario } from "./empresa-context";
import { db } from "./index";
import { empresas, membresias, roles, usuarios } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";

// Tarea 1.6 — prueba real de la política nueva que agrega esta tarea a
// rls-setup.sql (aislamiento_empresas/aislamiento_membresias, mitad
// "usuario_actual"): un usuario con membresía en varias empresas puede
// listarlas todas para el selector, pero nunca ve la membresía ni la
// empresa de otra persona. Corre contra el mismo Postgres real que la
// prueba de la tarea 1.4 (ver ese archivo) — RLS no se puede probar con
// un mock.
//
// Issue #39 — empresaA/empresaB salen ahora de crearDosEmpresas()
// (db/test-utils/aislamiento.ts); empresaC sigue armándose a mano
// porque la plantilla solo crea 2 empresas y este archivo necesita una
// tercera (usuario1 es dueño de A y B; usuario2, de C). usuario1Id y
// usuario2Id tampoco salen de la plantilla: son los usuarios con
// membresía cruzada que prueba este archivo, no "el usuario de cada
// empresa" que crea crearDosEmpresas() para otros fines.
describe("listar las empresas propias de un usuario (RLS, tarea 1.6)", () => {
  let contexto: ContextoDosEmpresas;
  let empresaAId: string;
  let empresaBId: string;
  const empresaCId = randomUUID();
  const usuario1Id = randomUUID();
  const usuario2Id = randomUUID();

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    empresaAId = contexto.empresaAId;
    empresaBId = contexto.empresaBId;

    // usuario1 queda en 2 empresas (A y B); usuario2 queda en una
    // tercera (C) que usuario1 nunca debe ver.
    await db.insert(usuarios).values([
      { id: usuario1Id, email: `u1-${usuario1Id.slice(0, 8)}@zilonix.test`, nombre: "Usuario 1 (prueba 1.6)" },
      { id: usuario2Id, email: `u2-${usuario2Id.slice(0, 8)}@zilonix.test`, nombre: "Usuario 2 (prueba 1.6)" },
    ]);

    await dbComoEmpresa(empresaCId, (tx) =>
      tx.insert(empresas).values({ id: empresaCId, nombre: "Empresa C (prueba 1.6)", nit: `TEST-${empresaCId.slice(0, 8)}` })
    );

    for (const [empresaId, usuarioDueno] of [
      [empresaAId, usuario1Id],
      [empresaBId, usuario1Id],
      [empresaCId, usuario2Id],
    ] as const) {
      const rolId = randomUUID();
      await dbComoEmpresa(empresaId, async (tx) => {
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

  // Issue #39 — plantilla genérica sobre membresias (la otra tabla
  // central de este archivo, aparte de empresas, que sí tiene columnas
  // id + empresa_id): confirma que, por FUERA de la regla especial de
  // "usuario ve sus propias membresías" que prueban los "it" de arriba,
  // el aislamiento normal por empresa_actual también sigue intacto acá.
  it("plantilla de aislamiento genérica (issue #39): empresa B nunca ve, edita ni borra una membresía de empresa A", async () => {
    const rolDePrueba = randomUUID();
    const usuarioDePrueba = randomUUID();
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(roles).values({ id: rolDePrueba, nombre: "Rol de prueba (aislamiento)", empresaId: empresaAId })
    );
    await db.insert(usuarios).values({
      id: usuarioDePrueba,
      email: `aislamiento-${usuarioDePrueba.slice(0, 8)}@zilonix.test`,
      nombre: "Usuario de prueba (aislamiento)",
    });

    await afirmarAislamiento(contexto, membresias, (tx, empresaId) =>
      tx.insert(membresias).values({ usuarioId: usuarioDePrueba, empresaId, rolId: rolDePrueba }).returning({ id: membresias.id })
    );
  });
});
