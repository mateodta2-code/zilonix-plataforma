import { describe, expect, it } from "vitest";
import { fechaDiaLegible, mostrarPorcentaje, mostrarPorcentajeEntero } from "./formato";

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

describe("fechaDiaLegible (detalle día a día, 27-nov)", () => {
  it("pinta el día con semana y mes cortos, sin mover la fecha", () => {
    expect(fechaDiaLegible("2026-11-27")).toBe("Vie 27 nov 2026");
    expect(fechaDiaLegible("2026-11-01")).toBe("Dom 1 nov 2026");
    expect(fechaDiaLegible("2026-12-31")).toBe("Jue 31 dic 2026");
  });
  it("deja tal cual lo que no es un día real", () => {
    expect(fechaDiaLegible("2026-02-30")).toBe("2026-02-30");
    expect(fechaDiaLegible("hoy")).toBe("hoy");
  });
});
