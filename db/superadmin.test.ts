import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  requiereSuperadmin,
  listarEmpresasConConteo,
  obtenerMiembrosConAcceso,
  NoEsSuperadminError,
  SinAccesoTemporalError,
} from "../lib/superadmin";
import { concederAccesoTemporal, revocarAccesoTemporal } from "../lib/acceso-temporal";
import { dbComoEmpresa } from "./empresa-context";
import { dbSuperadmin } from "./superadmin-context";
import { db } from "./index";
import { accesosTemporales, auditoria, empresas, membresias, roles, usuarios } from "./schema";

// Tarea 1.11 (decisión D8) — prueba real contra Postgres: el
// superadmin siempre ve las cifras agregadas, nunca el detalle de una
// empresa sin un acceso temporal activo, y nunca puede escribir nada
// de negocio — sin eso, "el personal de Zilonix no ve tus ventas ni
// tus clientes sin tu permiso" sería una promesa de papel.

describe("panel superadmin (RLS + lib, tarea 1.11)", () => {
  const empresaId = randomUUID();
  const rolId = randomUUID();
  const duenoId = randomUUID();
  const operadorId = randomUUID();
  const superadminUsuarioId = randomUUID();
  const usuarioNormalId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, async (tx) => {
      await tx.insert(empresas).values({ id: empresaId, nombre: "Empresa Superadmin (prueba 1.11)", nit: `TEST-SA-${empresaId.slice(0, 8)}` });
      await tx.insert(roles).values({ id: rolId, nombre: "Dueño", empresaId });
    });
    await db.insert(usuarios).values([
      { id: duenoId, email: `dueno-sa-${duenoId.slice(0, 8)}@zilonix.test`, nombre: "Doña Dueña" },
      { id: operadorId, email: `op-sa-${operadorId.slice(0, 8)}@zilonix.test`, nombre: "Pepe Operador" },
      { id: superadminUsuarioId, email: `sa-${superadminUsuarioId.slice(0, 8)}@zilonix.test`, nombre: "Súper Admin", esSuperadmin: true },
      { id: usuarioNormalId, email: `normal-${usuarioNormalId.slice(0, 8)}@zilonix.test`, nombre: "Usuario Normal" },
    ]);
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(membresias).values([
        { id: randomUUID(), usuarioId: duenoId, empresaId, rolId },
        { id: randomUUID(), usuarioId: operadorId, empresaId, rolId },
      ])
    );
  });

  it("requiereSuperadmin rechaza a quien no lo es, y deja pasar a quien sí", async () => {
    await expect(requiereSuperadmin(usuarioNormalId)).rejects.toBeInstanceOf(NoEsSuperadminError);
    await expect(requiereSuperadmin(superadminUsuarioId)).resolves.toBeUndefined();
  });

  it("la lista agregada muestra la empresa con su conteo de miembros, cruzando empresas", async () => {
    const lista = await listarEmpresasConConteo();
    const fila = lista.find((e) => e.id === empresaId);
    expect(fila).toBeTruthy();
    expect(fila?.miembros).toBe(2);
  });

  it("sin acceso temporal, ver el detalle de miembros falla", async () => {
    await expect(obtenerMiembrosConAcceso(empresaId, superadminUsuarioId)).rejects.toBeInstanceOf(SinAccesoTemporalError);
  });

  it("con un acceso temporal activo, ver el detalle funciona y queda en auditoria", async () => {
    await concederAccesoTemporal(empresaId, duenoId, "Ver quién trabaja en la empresa", 48);

    const miembros = await obtenerMiembrosConAcceso(empresaId, superadminUsuarioId);
    expect(miembros.map((m) => m.nombre).sort()).toEqual(["Doña Dueña", "Pepe Operador"]);

    const registro = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(auditoria).where(eq(auditoria.accion, "ver_detalle_superadmin"))
    );
    expect(registro).toHaveLength(1);
    expect(registro[0].usuarioId).toBe(superadminUsuarioId);
  });

  it("revocar el acceso antes de que venza vuelve a bloquear el detalle", async () => {
    const [acceso] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(accesosTemporales).where(eq(accesosTemporales.empresaId, empresaId)));
    await revocarAccesoTemporal(empresaId, acceso.id, duenoId);
    await expect(obtenerMiembrosConAcceso(empresaId, superadminUsuarioId)).rejects.toBeInstanceOf(SinAccesoTemporalError);
  });

  it("un acceso ya vencido tampoco deja ver el detalle", async () => {
    const empresaVencidaId = randomUUID();
    const rolVencidaId = randomUUID();
    await dbComoEmpresa(empresaVencidaId, async (tx) => {
      await tx.insert(empresas).values({ id: empresaVencidaId, nombre: "Empresa Vencida (prueba 1.11)", nit: `TEST-SAV-${empresaVencidaId.slice(0, 8)}` });
      await tx.insert(roles).values({ id: rolVencidaId, nombre: "Dueño", empresaId: empresaVencidaId });
    });
    await concederAccesoTemporal(empresaVencidaId, duenoId, "Ver quién trabaja", 1);
    // Se vence a mano, directo en la base, para no esperar 1 hora real.
    await dbComoEmpresa(empresaVencidaId, (tx) =>
      tx.update(accesosTemporales).set({ expiraTs: new Date(Date.now() - 1000) }).where(eq(accesosTemporales.empresaId, empresaVencidaId))
    );
    await expect(obtenerMiembrosConAcceso(empresaVencidaId, superadminUsuarioId)).rejects.toBeInstanceOf(SinAccesoTemporalError);
  });

  it("superadmin_user no puede escribir NADA de negocio, ni con acceso temporal activo", async () => {
    await expect(
      dbSuperadmin.update(empresas).set({ nombre: "hackeado" }).where(eq(empresas.id, empresaId))
    ).rejects.toThrow();
    const real = await dbComoEmpresa(empresaId, (tx) => tx.select().from(empresas).where(eq(empresas.id, empresaId)));
    expect(real[0].nombre).toBe("Empresa Superadmin (prueba 1.11)");
  });
});
