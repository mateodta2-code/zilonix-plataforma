import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./index";
import { dbComoEmpresa } from "./empresa-context";
import { dbSuperadmin } from "./superadmin-context";
import { empresas } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";
import { registrarIngresoEmpresa } from "../lib/ingresos";
import { listarEmpresasConConteo } from "../lib/superadmin";

// Empresas inactivas (25-nov, migración 0051) — contra Postgres real: el
// ingreso se anota solo en la empresa de la sesión, como mucho una vez por
// hora, app_user no escribe la columna directo y el superadmin la lee.
describe("empresas.ultimo_ingreso_ts", () => {
  let empresaA: string;
  let empresaB: string;
  const ingresoDe = async (id: string) => (await dbSuperadmin.select({ t: empresas.ultimoIngresoTs }).from(empresas).where(eq(empresas.id, id)))[0].t;

  beforeAll(async () => {
    const ctx = await crearDosEmpresas();
    empresaA = ctx.empresaAId;
    empresaB = ctx.empresaBId;
  });

  it("anota solo la empresa de la sesión", async () => {
    expect(await ingresoDe(empresaA)).toBeNull();
    await registrarIngresoEmpresa(empresaA);
    expect(await ingresoDe(empresaA)).toBeInstanceOf(Date);
    expect(await ingresoDe(empresaB)).toBeNull();
  });

  it("como mucho una vez por hora", async () => {
    const primero = await ingresoDe(empresaA);
    await registrarIngresoEmpresa(empresaA);
    expect((await ingresoDe(empresaA))?.getTime()).toBe(primero?.getTime());
  });

  it("app_user no escribe la columna directo, ni sin empresa en la sesión", async () => {
    await expect(dbComoEmpresa(empresaB, (tx) => tx.update(empresas).set({ ultimoIngresoTs: new Date() }).where(eq(empresas.id, empresaB)))).rejects.toThrow();
    // Sin app.empresa_actual la función no toca nada.
    await db.execute(sql`select registrar_ingreso_empresa()`);
    expect(await ingresoDe(empresaB)).toBeNull();
  });

  it("el superadmin la ve en la lista de empresas", async () => {
    const fila = (await listarEmpresasConConteo()).find((e) => e.id === empresaA);
    expect(fila?.ultimoIngresoTs).toBeInstanceOf(Date);
    expect((await listarEmpresasConConteo()).find((e) => e.id === empresaB)?.ultimoIngresoTs).toBeNull();
  });

  it("la función no la puede llamar el superadmin", async () => {
    await expect(dbSuperadmin.execute(sql`select registrar_ingreso_empresa()`)).rejects.toThrow();
  });
});
