import { describe, expect, it } from "vitest";
import { codigosParaMaestra, parsearComboSku, resolverCostoSku, type MaestraSku } from "./combo-sku";

// Issue #130 (maestra de #127) — regla de costo de los SKU combo X2/X3
// (Sharel, 29-oct-2026). Puras, sin base.

function fila(costo: string | null, extra: Partial<MaestraSku> = {}): MaestraSku {
  return { costo, empaque: null, empaqueProveedor: null, envioAgencia: null, ...extra };
}

describe("parsearComboSku", () => {
  it("solo X2 y X3 al final, con base no vacía", () => {
    expect(parsearComboSku("BASEX2")).toEqual({ base: "BASE", multiplicador: 2 });
    expect(parsearComboSku("BASEX3")).toEqual({ base: "BASE", multiplicador: 3 });
    expect(parsearComboSku("BASEXX2")).toEqual({ base: "BASEX", multiplicador: 2 });
    expect(parsearComboSku("BASE-X2")).toEqual({ base: "BASE-", multiplicador: 2 });
    for (const sku of ["X2", "X3", "BASEX1", "BASEX4", "BASEX5", "BASEX12", "BASEX22", "AGUJA2", "BASE"]) {
      expect(parsearComboSku(sku)).toBeNull();
    }
  });
});

describe("resolverCostoSku", () => {
  it("la fila exacta con costo gana aunque la base tenga otro costo", () => {
    const exacta = fila("25000.00", { empaque: "800.00" });
    const r = resolverCostoSku("BASEX2", new Map([["BASEX2", exacta], ["BASE", fila("10000.00")]]));
    expect(r).toEqual({ costoUnitario: "25000.00", origen: "exacto", filaCargos: exacta });
  });

  it("exacta sin costo y base con costo: base × N, cargos de la exacta", () => {
    const exacta = fila(null, { empaque: "700.00", envioAgencia: "3000.00" });
    const r = resolverCostoSku("BASEX3", new Map([["BASEX3", exacta], ["BASE", fila("10000.00", { empaque: "1000.00" })]]));
    expect(r).toEqual({ costoUnitario: "30000.00", origen: "combo_base", filaCargos: exacta });
  });

  it("sin fila exacta: cargos de la base", () => {
    const base = fila("10000.00", { empaque: "1000.00", envioAgencia: "5000.00" });
    expect(resolverCostoSku("BASEX2", new Map([["BASE", base]]))).toEqual({ costoUnitario: "20000.00", origen: "combo_base", filaCargos: base });
  });

  it("base sin costo o sin fila: sin costo", () => {
    const base = fila(null);
    expect(resolverCostoSku("BASEX2", new Map([["BASE", base]]))).toEqual({ costoUnitario: null, origen: null, filaCargos: base });
    expect(resolverCostoSku("BASEX2", new Map())).toEqual({ costoUnitario: null, origen: null, filaCargos: undefined });
  });

  it("base 0.00 es válido y centavos exactos", () => {
    expect(resolverCostoSku("BASEX2", new Map([["BASE", fila("0.00")]]))).toMatchObject({ costoUnitario: "0.00", origen: "combo_base" });
    expect(resolverCostoSku("BASEX3", new Map([["BASE", fila("12345.67")]]))).toMatchObject({ costoUnitario: "37037.01", origen: "combo_base" });
  });

  it("no combos: AGUJA2, BASEX4 y null quedan sin costo", () => {
    expect(resolverCostoSku("AGUJA2", new Map([["AGUJA", fila("5000.00")]]))).toMatchObject({ costoUnitario: null, origen: null, filaCargos: undefined });
    expect(resolverCostoSku("BASEX4", new Map([["BASE", fila("5000.00")]]))).toMatchObject({ costoUnitario: null, origen: null, filaCargos: undefined });
    expect(resolverCostoSku(null, new Map([["BASE", fila("5000.00")]]))).toEqual({ costoUnitario: null, origen: null, filaCargos: undefined });
  });
});

describe("codigosParaMaestra", () => {
  it("agrega la base de los combos sin duplicar", () => {
    expect(codigosParaMaestra(["BASEX2", "BASEX3", "BASE", "AGUJA2", "OTROX4"])).toEqual(["BASEX2", "BASE", "BASEX3", "AGUJA2", "OTROX4"]);
  });
});
