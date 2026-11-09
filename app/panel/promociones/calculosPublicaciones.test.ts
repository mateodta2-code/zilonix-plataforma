import { describe, expect, it } from "vitest";
import {
  calcularDesdePorcentaje,
  calcularDesdePrecioFinal,
  formatoEnteroInput,
  parsearNumeroLocal,
  separadoresDe,
  superaMaximoConfigurado,
} from "./calculosPublicaciones";

describe("separadoresDe", () => {
  it("es-CO: punto de miles, coma decimal", () => {
    expect(separadoresDe("es-CO")).toEqual({ miles: ".", decimal: "," });
  });

  it("es-MX (Issue #315, multipaís): coma de miles, punto decimal — nunca igual a es-CO", () => {
    const { miles, decimal } = separadoresDe("es-MX");
    expect(miles).toBe(",");
    expect(decimal).toBe(".");
  });
});

describe("parsearNumeroLocal", () => {
  it("es-CO: '90.000' son noventa mil, nunca noventa con decimales", () => {
    expect(parsearNumeroLocal("90.000", "es-CO")).toBe(90000);
  });

  it("es-MX: '90,000' son noventa mil, nunca noventa con decimales — separador invertido frente a es-CO", () => {
    expect(parsearNumeroLocal("90,000", "es-MX")).toBe(90000);
  });

  it("vacío o no numérico: null, nunca 0", () => {
    expect(parsearNumeroLocal("", "es-CO")).toBeNull();
    expect(parsearNumeroLocal("   ", "es-CO")).toBeNull();
    expect(parsearNumeroLocal("abc", "es-CO")).toBeNull();
  });

  it("decimales: '90.000,5' en es-CO es noventa mil con medio peso", () => {
    expect(parsearNumeroLocal("90.000,5", "es-CO")).toBe(90000.5);
  });
});

describe("formatoEnteroInput", () => {
  it("es-CO agrupa con punto", () => {
    expect(formatoEnteroInput(90000, "es-CO")).toBe("90.000");
  });

  it("es-MX agrupa con coma — nunca el mismo texto que es-CO para el mismo número", () => {
    expect(formatoEnteroInput(90000, "es-MX")).toBe("90,000");
  });

  it("redondea decimales (siempre pesos enteros)", () => {
    expect(formatoEnteroInput(90000.6, "es-CO")).toBe("90.001");
  });
});

describe("calcularDesdePrecioFinal / calcularDesdePorcentaje", () => {
  it("van y vuelven al mismo precio final", () => {
    const desdeFinal = calcularDesdePrecioFinal(100000, 85000);
    expect(desdeFinal.descuentoVendedorPct).toBeCloseTo(15, 5);
    const desdePct = calcularDesdePorcentaje(100000, 15);
    expect(desdePct.precioFinal).toBe(85000);
  });

  it("precio original 0 (o inválido): 0% en vez de NaN/Infinity", () => {
    expect(calcularDesdePrecioFinal(0, 0).descuentoVendedorPct).toBe(0);
  });
});

describe("superaMaximoConfigurado", () => {
  it("un descuento mayor al tope configurado: true", () => {
    expect(superaMaximoConfigurado(100000, 80000, 15)).toBe(true); // 20% > 15%
  });

  it("un descuento dentro del tope: false", () => {
    expect(superaMaximoConfigurado(100000, 90000, 15)).toBe(false); // 10% <= 15%
  });

  it("sin datos suficientes: false, nunca se inventa un 'supera'", () => {
    expect(superaMaximoConfigurado(null, 90000, 15)).toBe(false);
    expect(superaMaximoConfigurado(100000, null, 15)).toBe(false);
  });
});
