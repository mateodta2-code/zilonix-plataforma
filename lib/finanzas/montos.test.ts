import { describe, expect, it } from "vitest";
import { MontoInvalidoError, validarMonto } from "./montos";

describe("validarMonto (issue #127)", () => {
  it("vacío es null; cero es un valor real", () => {
    expect(validarMonto(null, "x")).toBeNull();
    expect(validarMonto(undefined, "x")).toBeNull();
    expect(validarMonto("  ", "x")).toBeNull();
    expect(validarMonto(0, "x")).toBe("0");
    expect(validarMonto("0.00", "x")).toBe("0.00");
  });

  it("acepta hasta 2 decimales", () => {
    expect(validarMonto("3000", "x")).toBe("3000");
    expect(validarMonto(" 2500.5 ", "x")).toBe("2500.5");
    expect(validarMonto(1999.99, "x")).toBe("1999.99");
  });

  it("rechaza negativos, más de 2 decimales, texto y números que no caben", () => {
    for (const valor of ["-1", "1.005", "abc", "1e3", "1234567890123", "1,5"]) {
      expect(() => validarMonto(valor, "x")).toThrow(MontoInvalidoError);
    }
  });
});
