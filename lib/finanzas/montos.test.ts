import { describe, expect, it } from "vitest";
import { MontoInvalidoError, mostrarMonto, validarMonto } from "./montos";

describe("mostrarMonto (issue #128)", () => {
  it("formatea con punto de miles y coma decimal, sin pasar por Number", () => {
    expect(mostrarMonto("3000.00")).toBe("$ 3.000");
    expect(mostrarMonto("1234.5")).toBe("$ 1.234,50");
    expect(mostrarMonto("0.00")).toBe("$ 0");
    expect(mostrarMonto("999999999999.99")).toBe("$ 999.999.999.999,99");
    expect(mostrarMonto(null)).toBe("—");
  });
});

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
