import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { cifrarToken } from "../lib/cifrado";
import { listarEmpresasConConteo } from "../lib/superadmin";
import { cambiarPlanEmpresa, EntradaInvalidaError, reactivarEmpresa, suspenderEmpresa } from "../lib/superadmin-empresas";
import { obtenerMiMembresia } from "../lib/membresias";
import { requierePermiso, SinPermisoError } from "../lib/permisos";
import { dbComoEmpresa } from "./empresa-context";
import { dbSuperadmin } from "./superadmin-context";
import { db } from "./index";
import { auditoria, cuentasMl, empresas, membresias, roles, usuarios } from "./schema";

// PR B (Empresas y planes) — contra Postgres real: quién puede cambiar
// qué columna de empresas, qué ve la lista del superadmin y qué pasa
// con una empresa suspendida.
describe("empresas y planes (PR B)", () => {
  const empresaId = randomUUID();
  const rolId = randomUUID();
  const duenoId = randomUUID();
  const superadminId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, async (tx) => {
      await tx.insert(empresas).values({ id: empresaId, nombre: "Empresa Planes (prueba)", nit: `TEST-PL-${empresaId.slice(0, 8)}` });
      await tx.insert(roles).values({ id: rolId, nombre: "Dueño", empresaId });
      await tx.insert(cuentasMl).values({
        empresaId,
        cuentaIdExterna: `ml-${randomUUID()}`,
        nickname: "CUENTA_SECRETA",
        accessTokenCifrado: cifrarToken("a"),
        refreshTokenCifrado: cifrarToken("r"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      });
    });
    await db.insert(usuarios).values([
      { id: duenoId, email: `dueno-pl-${duenoId.slice(0, 8)}@zilonix.test`, nombre: "Dueña" },
      { id: superadminId, email: `sa-pl-${superadminId.slice(0, 8)}@zilonix.test`, nombre: "SA", esSuperadmin: true },
    ]);
    await dbComoEmpresa(empresaId, (tx) => tx.insert(membresias).values({ id: randomUUID(), usuarioId: duenoId, empresaId, rolId }));
  });

  it("una empresa nueva nace con plan 'prueba' y estado 'activa'", async () => {
    const [e] = await dbSuperadmin.select().from(empresas).where(eq(empresas.id, empresaId));
    expect([e.plan, e.estado]).toEqual(["prueba", "activa"]);
  });

  it("la base rechaza un plan o un estado fuera de la lista", async () => {
    await expect(db.execute(sql`update empresas set plan = 'gratis' where id = ${empresaId}`)).rejects.toThrow();
    await expect(db.execute(sql`update empresas set estado = 'borrada' where id = ${empresaId}`)).rejects.toThrow();
  });

  it("superadmin_user NO puede cambiar ninguna otra columna de empresas", async () => {
    for (const cambio of [{ nombre: "x" }, { nit: "x" }, { creadoTs: new Date() }, { id: randomUUID() }]) {
      await expect(dbSuperadmin.update(empresas).set(cambio).where(eq(empresas.id, empresaId))).rejects.toThrow();
    }
  });

  it("app_user NO puede cambiar plan, estado, motivo, fecha de suspensión ni notas", async () => {
    for (const cambio of [
      { plan: "pro" },
      { estado: "suspendida" },
      { suspendidaMotivo: "x" },
      { suspendidaTs: new Date() },
      { notasInternas: "x" },
    ]) {
      await expect(dbComoEmpresa(empresaId, (tx) => tx.update(empresas).set(cambio).where(eq(empresas.id, empresaId)))).rejects.toThrow();
    }
    const [e] = await dbSuperadmin.select().from(empresas).where(eq(empresas.id, empresaId));
    expect([e.plan, e.estado]).toEqual(["prueba", "activa"]);
  });

  it("la lista muestra solo conteos: cuentas conectadas sí, y ningún dato de cuentas, productos ni compradores", async () => {
    const fila = (await listarEmpresasConConteo()).find((e) => e.id === empresaId)!;
    expect(fila.miembros).toBe(1);
    expect(fila.cuentasMl).toBe(1);
    expect(fila.cuentasFalabella).toBe(0);
    expect(JSON.stringify(fila)).not.toContain("CUENTA_SECRETA");
    expect(Object.keys(fila).sort()).toEqual(
      ["creadoTs", "cuentasFalabella", "cuentasMl", "estado", "id", "miembros", "nit", "nombre", "notasInternas", "plan", "suspendidaMotivo", "suspendidaTs", "ultimaActividad"].sort()
    );
    // y la base misma le niega las tablas de negocio
    for (const tabla of ["cuentas_ml", "cuentas_falabella", "pedidos", "publicaciones", "skus", "auditoria"]) {
      await expect(dbSuperadmin.execute(sql.raw(`select 1 from ${tabla} limit 1`))).rejects.toThrow();
    }
  });

  it("cambiar plan queda en auditoria; un plan inválido se rechaza", async () => {
    await cambiarPlanEmpresa(superadminId, empresaId, "pro");
    await expect(cambiarPlanEmpresa(superadminId, empresaId, "gratis")).rejects.toBeInstanceOf(EntradaInvalidaError);
    const filas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(auditoria).where(eq(auditoria.accion, "cambiar_plan_superadmin")));
    expect(filas).toHaveLength(1);
    expect([filas[0].usuarioId, filas[0].valorAnterior, filas[0].valorNuevo]).toEqual([superadminId, "prueba", "pro"]);
    const fila = (await listarEmpresasConConteo()).find((e) => e.id === empresaId)!;
    expect(fila.ultimaActividad).toBeInstanceOf(Date);
  });

  it("suspender exige motivo; una empresa suspendida no pasa requierePermiso y reactivar la devuelve", async () => {
    await expect(suspenderEmpresa(superadminId, empresaId, "   ")).rejects.toBeInstanceOf(EntradaInvalidaError);
    await requierePermiso(duenoId, empresaId, "ventas", "consultar");

    await suspenderEmpresa(superadminId, empresaId, "Falta de pago");
    const m = await obtenerMiMembresia(duenoId, empresaId);
    expect(m?.empresaSuspendida).toBe(true);
    await expect(requierePermiso(duenoId, empresaId, "ventas", "consultar")).rejects.toBeInstanceOf(SinPermisoError);
    const [e] = await dbSuperadmin.select().from(empresas).where(eq(empresas.id, empresaId));
    expect([e.estado, e.suspendidaMotivo]).toEqual(["suspendida", "Falta de pago"]);

    await reactivarEmpresa(superadminId, empresaId);
    await requierePermiso(duenoId, empresaId, "ventas", "consultar");
    const [r] = await dbSuperadmin.select().from(empresas).where(eq(empresas.id, empresaId));
    expect([r.estado, r.suspendidaMotivo, r.suspendidaTs]).toEqual(["activa", null, null]);
  });
});
