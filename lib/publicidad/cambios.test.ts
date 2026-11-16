import { describe, expect, it } from "vitest";
import { detectarCambios, direccionCambio } from "@/lib/publicidad/cambios";

describe("historial de presupuesto y ROAS objetivo", () => {
  const antes = { presupuestoDiario: "50000.00", roasObjetivo: "8.00" };

  it("la primera lectura no deja cambios", () => {
    expect(detectarCambios(null, antes)).toEqual([]);
  });

  it("el mismo valor con otro formato no es un cambio", () => {
    expect(detectarCambios(antes, { presupuestoDiario: "50000", roasObjetivo: "8" })).toEqual([]);
  });

  it("anota presupuesto y ROAS cuando cambian", () => {
    expect(detectarCambios(antes, { presupuestoDiario: "60000", roasObjetivo: "10.5" })).toEqual([
      { campo: "presupuesto_diario", valorAnterior: "50000.00", valorNuevo: "60000" },
      { campo: "roas_objetivo", valorAnterior: "8.00", valorNuevo: "10.5" },
    ]);
  });

  it("pasar a sin dato también es un cambio", () => {
    expect(detectarCambios(antes, { presupuestoDiario: null, roasObjetivo: "8.00" })).toEqual([
      { campo: "presupuesto_diario", valorAnterior: "50000.00", valorNuevo: null },
    ]);
    expect(detectarCambios({ presupuestoDiario: null, roasObjetivo: null }, { presupuestoDiario: null, roasObjetivo: null })).toEqual([]);
  });

  it("dice si subió o bajó", () => {
    expect(direccionCambio("50000.00", "60000")).toBe("subio");
    expect(direccionCambio("8.00", "6.5")).toBe("bajo");
    expect(direccionCambio(null, "8")).toBe("otro");
  });
});
