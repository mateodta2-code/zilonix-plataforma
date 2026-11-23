import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { CATEGORIAS_GASTO_BASE, CategoriaGastoInvalidaError, normalizarNombreCategoria } from "./gastos-categorias";

// Issue #422 (fase 4 de Finanzas) — la lista base vive en dos lados: en
// el código (empresas nuevas) y en la migración 0038 (empresas que ya
// existían). Esta prueba evita que se separen, y revisa que la 0037 cree
// las tablas con las restricciones de las que depende la pantalla.

const MIGRACIONES = join(__dirname, "..", "..", "db", "migrations");
const leer = (archivo: string) => readFileSync(join(MIGRACIONES, archivo), "utf8");

describe("migraciones de gastos externos", () => {
  it("0038 siembra exactamente las categorías base, de forma idempotente y sin COMMIT", () => {
    const sql = leer("0038_sembrar_categorias_gasto.sql");
    const sembradas = [...sql.matchAll(/^\s*\('([^']+)'\),?$/gm)].map((m) => m[1]);
    expect(sembradas).toEqual([...CATEGORIAS_GASTO_BASE]);
    expect(sql).toMatch(/ON CONFLICT ON CONSTRAINT categorias_gasto_empresa_nombre_unico DO NOTHING/);
    expect(sql).not.toMatch(/^\s*COMMIT/im);
  });

  it("0037 crea las dos tablas con las FKs de misma empresa y los CHECK", () => {
    const sql = leer("0037_gastos_externos.sql");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "categorias_gasto"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "gastos"/);
    for (const restriccion of [
      "gastos_categoria_misma_empresa_fk",
      "gastos_tercero_misma_empresa_fk",
      "gastos_cuenta_ml_misma_empresa_fk",
      "gastos_cuenta_falabella_misma_empresa_fk",
      "gastos_pago_coherente",
      "gastos_una_tienda",
      "gastos_monto_positivo",
      "categorias_gasto_empresa_nombre_unico",
    ]) {
      expect(sql).toContain(restriccion);
    }
  });

  it("rls-setup.sql activa y fuerza RLS en las dos tablas, sin DELETE para app_user", () => {
    const rls = readFileSync(join(__dirname, "..", "..", "db", "rls-setup.sql"), "utf8");
    for (const tabla of ["categorias_gasto", "gastos"]) {
      expect(rls).toContain(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY;`);
      expect(rls).toContain(`ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY;`);
      expect(rls).toMatch(new RegExp(`CREATE POLICY aislamiento_${tabla} ON ${tabla}\\s+USING \\(empresa_id = current_setting\\('app.empresa_actual', true\\)::uuid\\);`));
    }
    expect(rls).toContain("GRANT SELECT, INSERT, UPDATE ON categorias_gasto, gastos TO app_user;");
  });
});

describe("normalizarNombreCategoria", () => {
  it("recorta y colapsa espacios", () => {
    expect(normalizarNombreCategoria("  Servicios   públicos ")).toBe("Servicios públicos");
  });

  it("rechaza vacío o más de 60 caracteres", () => {
    expect(() => normalizarNombreCategoria("   ")).toThrow(CategoriaGastoInvalidaError);
    expect(() => normalizarNombreCategoria("x".repeat(61))).toThrow(CategoriaGastoInvalidaError);
  });
});
