import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasDisponible, saldosDisponible } from "./schema";
import { SinPermisoError } from "../lib/permisos";
import { crearEmpresaConPermisos } from "../lib/test-utils/empresa-con-permiso";
import { DisponibleInvalidoError } from "../lib/finanzas/disponible";
import {
  cambiarActivaCuentaDisponible,
  crearCuentaDisponible,
  CuentaDisponibleRepetidaError,
  leerDisponible,
  registrarSaldoDisponible,
} from "../lib/finanzas/disponible-consulta";

// Issue #422 (fase 6, Disponible) — cuentas y saldos contra Postgres real
// (RLS no se simula): una empresa nunca ve, edita ni borra las cuentas o
// los saldos de otra, ni puede colgar un saldo de una cuenta ajena.

const HOY = "2026-11-22";
const DIR_MIGRACIONES = join(process.cwd(), "db/migrations");

describe("migración de Disponible", () => {
  // Se busca por contenido, no por nombre: si se regenera con drizzle-kit
  // (otra migración entró antes a main) el número cambia.
  const archivos = readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith(".sql"));
  const archivo = archivos.find((f) => readFileSync(join(DIR_MIGRACIONES, f), "utf8").includes('CREATE TABLE IF NOT EXISTS "cuentas_disponible"'));
  const sqlMigracion = archivo ? readFileSync(join(DIR_MIGRACIONES, archivo), "utf8") : "";

  it("existe una sola, sin COMMIT, y crea las dos tablas", () => {
    expect(archivo).toBeDefined();
    expect(archivos.filter((f) => readFileSync(join(DIR_MIGRACIONES, f), "utf8").includes('"cuentas_disponible" ('))).toHaveLength(1);
    expect(sqlMigracion).not.toMatch(/\bCOMMIT\b/i);
    expect(sqlMigracion).toContain('CREATE TABLE IF NOT EXISTS "saldos_disponible"');
  });

  it("la moneda no tiene default (nunca COP fijo) y el saldo apunta a una cuenta de la misma empresa", () => {
    expect(sqlMigracion).toMatch(/"moneda" text NOT NULL,/);
    expect(sqlMigracion).not.toMatch(/'COP'/);
    expect(sqlMigracion).toContain('FOREIGN KEY ("empresa_id","cuenta_id") REFERENCES "public"."cuentas_disponible"("empresa_id","id")');
  });

  it("rls-setup.sql activa RLS y política en las dos tablas", () => {
    const rls = readFileSync(join(process.cwd(), "db/rls-setup.sql"), "utf8");
    for (const tabla of ["cuentas_disponible", "saldos_disponible"]) {
      expect(rls).toContain(`ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY;`);
      expect(rls).toContain(`CREATE POLICY aislamiento_${tabla} ON ${tabla}`);
    }
  });
});

describe("Disponible (RLS, issue #422)", () => {
  const EDITAR = [
    { modulo: "finanzas" as const, accion: "consultar" as const },
    { modulo: "finanzas" as const, accion: "modificar" as const },
  ];
  let a: { empresaId: string; usuarioId: string };
  let b: { empresaId: string; usuarioId: string };
  let soloVer: { empresaId: string; usuarioId: string };
  let cuentaAId: string;

  beforeAll(async () => {
    a = await crearEmpresaConPermisos("Disponible A", EDITAR);
    b = await crearEmpresaConPermisos("Disponible B", EDITAR);
    soloVer = await crearEmpresaConPermisos("Disponible solo ver", [{ modulo: "finanzas", accion: "consultar" }]);
    ({ id: cuentaAId } = await crearCuentaDisponible({
      ...a,
      nombre: "Ahorros A",
      tipo: "banco",
      entidad: "Bancolombia",
      ultimos4: "1234",
      moneda: "COP",
    }));
    await registrarSaldoDisponible({ ...a, cuentaId: cuentaAId, saldo: "1.000.000", fechaCorte: "2026-11-20", nota: "", hoy: HOY });
    await registrarSaldoDisponible({ ...a, cuentaId: cuentaAId, saldo: "900.000,50", fechaCorte: "2026-11-21", nota: "extracto", hoy: HOY });
  });

  it("A ve su cuenta y sus dos saldos; B no ve nada de A", async () => {
    const deA = await leerDisponible(a.empresaId, a.usuarioId);
    expect(deA.cuentas.map((c) => c.nombre)).toEqual(["Ahorros A"]);
    expect(deA.saldos.map((s) => s.saldo).sort()).toEqual(["1000000.00", "900000.50"]);

    const deB = await leerDisponible(b.empresaId, b.usuarioId);
    expect(deB.cuentas).toHaveLength(0);
    expect(deB.saldos).toHaveLength(0);

    const crudoB = await dbComoEmpresa(b.empresaId, async (tx) => ({
      cuentas: await tx.select().from(cuentasDisponible).where(eq(cuentasDisponible.id, cuentaAId)),
      saldos: await tx.select().from(saldosDisponible).where(eq(saldosDisponible.cuentaId, cuentaAId)),
    }));
    expect(crudoB).toEqual({ cuentas: [], saldos: [] });
  });

  it("B no puede editar la cuenta de A ni colgarle un saldo", async () => {
    const editadas = await dbComoEmpresa(b.empresaId, (tx) =>
      tx.update(cuentasDisponible).set({ activa: false }).where(eq(cuentasDisponible.id, cuentaAId)).returning({ id: cuentasDisponible.id })
    );
    expect(editadas).toHaveLength(0);

    await expect(registrarSaldoDisponible({ ...b, cuentaId: cuentaAId, saldo: "1", fechaCorte: HOY, nota: "", hoy: HOY })).rejects.toBeInstanceOf(
      DisponibleInvalidoError
    );
    // Aun saltándose el helper: ni con su propio empresa_id (FK compuesta)
    // ni con el de A (política de RLS).
    await expect(
      dbComoEmpresa(b.empresaId, (tx) => tx.insert(saldosDisponible).values({ empresaId: b.empresaId, cuentaId: cuentaAId, saldo: "1", fechaCorte: HOY }))
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(b.empresaId, (tx) => tx.insert(saldosDisponible).values({ empresaId: a.empresaId, cuentaId: cuentaAId, saldo: "1", fechaCorte: HOY }))
    ).rejects.toThrow();
  });

  it("con app_user no se borra ni se edita un saldo, aun siendo la empresa dueña", async () => {
    await expect(dbComoEmpresa(a.empresaId, (tx) => tx.delete(saldosDisponible).where(eq(saldosDisponible.cuentaId, cuentaAId)))).rejects.toThrow(
      /permission denied/
    );
    await expect(
      dbComoEmpresa(a.empresaId, (tx) => tx.update(saldosDisponible).set({ saldo: "0" }).where(eq(saldosDisponible.cuentaId, cuentaAId)))
    ).rejects.toThrow(/permission denied/);
    await expect(dbComoEmpresa(a.empresaId, (tx) => tx.delete(cuentasDisponible).where(eq(cuentasDisponible.id, cuentaAId)))).rejects.toThrow(
      /permission denied/
    );
    // De la cuenta solo se cambia «activa».
    await expect(
      dbComoEmpresa(a.empresaId, (tx) => tx.update(cuentasDisponible).set({ nombre: "Otro" }).where(eq(cuentasDisponible.id, cuentaAId)))
    ).rejects.toThrow(/permission denied/);
  });

  it("desactivar y reactivar; una cuenta inactiva no recibe saldos", async () => {
    await cambiarActivaCuentaDisponible({ ...a, cuentaId: cuentaAId, activa: false });
    await expect(registrarSaldoDisponible({ ...a, cuentaId: cuentaAId, saldo: "1", fechaCorte: HOY, nota: "", hoy: HOY })).rejects.toThrow(
      /desactivada/
    );
    await cambiarActivaCuentaDisponible({ ...a, cuentaId: cuentaAId, activa: true });
    await expect(cambiarActivaCuentaDisponible({ ...b, cuentaId: cuentaAId, activa: false })).rejects.toBeInstanceOf(DisponibleInvalidoError);
  });

  it("un cuentaId que no es UUID da «Elige una cuenta.», no el 22P02 de Postgres", async () => {
    for (const cuentaId of ["", "abc", "1; DROP TABLE x", `${cuentaAId}x`]) {
      await expect(registrarSaldoDisponible({ ...a, cuentaId, saldo: "1", fechaCorte: HOY, nota: "", hoy: HOY })).rejects.toThrow(
        new DisponibleInvalidoError("Elige una cuenta.")
      );
      await expect(cambiarActivaCuentaDisponible({ ...a, cuentaId, activa: false })).rejects.toThrow(new DisponibleInvalidoError("Elige una cuenta."));
    }
  });

  it("el mismo nombre se repite entre empresas pero no dentro de una", async () => {
    await expect(
      crearCuentaDisponible({ ...a, nombre: "Ahorros A", tipo: "billetera", entidad: "Nequi", ultimos4: "", moneda: "COP" })
    ).rejects.toBeInstanceOf(CuentaDisponibleRepetidaError);
    await expect(crearCuentaDisponible({ ...b, nombre: "Ahorros A", tipo: "efectivo", entidad: "", ultimos4: "", moneda: "COP" })).resolves.toHaveProperty(
      "id"
    );
  });

  it("permisos: sin permiso no se lee; con solo ver no se crea ni se registra", async () => {
    await expect(leerDisponible(b.empresaId, a.usuarioId)).rejects.toBeInstanceOf(SinPermisoError);
    await expect(leerDisponible(soloVer.empresaId, soloVer.usuarioId)).resolves.toHaveProperty("cuentas");
    await expect(
      crearCuentaDisponible({ ...soloVer, nombre: "Caja", tipo: "efectivo", entidad: "", ultimos4: "", moneda: "COP" })
    ).rejects.toBeInstanceOf(SinPermisoError);
    await expect(registrarSaldoDisponible({ ...soloVer, cuentaId: cuentaAId, saldo: "1", fechaCorte: HOY, nota: "", hoy: HOY })).rejects.toBeInstanceOf(
      SinPermisoError
    );
  });
});
