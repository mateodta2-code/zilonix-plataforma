import { describe, expect, it } from "vitest";
import { mostrarPorcentaje, mostrarPorcentajeEntero } from "./formato";

// Issue #131 — % de la tabla del detalle sin decimales (Sharel, 29-oct).

describe("mostrarPorcentajeEntero", () => {
  it("redondea al entero, la mitad hacia arriba", () => {
    expect(mostrarPorcentajeEntero("33.15")).toBe("33 %");
    expect(mostrarPorcentajeEntero("19.49")).toBe("19 %");
    expect(mostrarPorcentajeEntero("12.50")).toBe("13 %");
    expect(mostrarPorcentajeEntero("99.99")).toBe("100 %");
    expect(mostrarPorcentajeEntero("0.00")).toBe("0 %");
    expect(mostrarPorcentajeEntero("7")).toBe("7 %");
  });

  it("negativos: la mitad lejos de cero; -0,4 queda en 0 sin signo", () => {
    expect(mostrarPorcentajeEntero("-12.50")).toBe("-13 %");
    expect(mostrarPorcentajeEntero("-3.20")).toBe("-3 %");
    expect(mostrarPorcentajeEntero("-0.40")).toBe("0 %");
  });

  it("null es «—», y mostrarPorcentaje no cambia", () => {
    expect(mostrarPorcentajeEntero(null)).toBe("—");
    expect(mostrarPorcentaje("23.45")).toBe("23,45 %");
  });
});
