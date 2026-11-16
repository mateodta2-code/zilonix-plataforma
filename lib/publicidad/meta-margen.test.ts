import { describe, expect, it } from "vitest";
import { leerMetaMargen, metaComoPorcentaje, mitadDeMeta } from "@/lib/publicidad/meta-margen";
import { margenRealProducto, semaforoMargen } from "@/lib/publicidad/kpis";

describe("meta de margen (semáforo de productos)", () => {
  it("lee el porcentaje del formulario y lo guarda en fracción", () => {
    expect(leerMetaMargen("30")).toBe("0.3000");
    expect(leerMetaMargen(" 27,5 % ")).toBe("0.2750");
    expect(leerMetaMargen("1")).toBe("0.0100");
    expect(leerMetaMargen("99")).toBe("0.9900");
  });

  it("rechaza lo que no es una meta posible", () => {
    for (const malo of ["", "0", "100", "-5", "abc", "30.123", "150"]) expect(leerMetaMargen(malo)).toBeNull();
  });

  it("muestra la fracción guardada como porcentaje", () => {
    expect(metaComoPorcentaje("0.3000")).toBe("30");
    expect(metaComoPorcentaje("0.2750")).toBe("27,5");
    expect(metaComoPorcentaje("0.0500")).toBe("5");
    expect(mitadDeMeta("0.3000")).toBe("0.1500");
    expect(mitadDeMeta("0.2750")).toBe("0.1375");
  });
});

describe("margen real por producto", () => {
  const base = {
    precio: "100000.00",
    costo: "40000.00",
    empaque: "2000.00",
    envioAgencia: "3000.00",
    comisionMl: "15000.00",
    envioMl: "10000.00",
    compradorPagaEnvio: false,
  };

  it("resta costo, empaque, envío a agencia, comisión y envío de Mercado Libre", () => {
    expect(margenRealProducto(base)).toEqual({ tipo: "ok", ganancia: "30000.00", margen: "0.3000" });
  });

  it("el envío de Mercado Libre solo cuenta si lo paga el vendedor", () => {
    expect(margenRealProducto({ ...base, compradorPagaEnvio: true })).toEqual({ tipo: "ok", ganancia: "40000.00", margen: "0.4000" });
  });

  it("empaque y envío a agencia vacíos cuentan como $0; ganancia negativa se muestra", () => {
    expect(margenRealProducto({ ...base, empaque: null, envioAgencia: null })).toEqual({
      tipo: "ok",
      ganancia: "35000.00",
      margen: "0.3500",
    });
    expect(margenRealProducto({ ...base, costo: "90000.00" })).toEqual({ tipo: "ok", ganancia: "-20000.00", margen: "-0.2000" });
  });

  it("sin costo cargado o sin datos de Mercado Libre no inventa un margen", () => {
    expect(margenRealProducto({ ...base, costo: null })).toEqual({ tipo: "sin_costo" });
    expect(margenRealProducto({ ...base, precio: null })).toEqual({ tipo: "sin_datos" });
    expect(margenRealProducto({ ...base, comisionMl: null })).toEqual({ tipo: "sin_datos" });
    expect(margenRealProducto({ ...base, envioMl: null })).toEqual({ tipo: "sin_datos" });
  });

  it("franjas a partir de la meta: verde desde la meta, amarillo desde la mitad", () => {
    expect(semaforoMargen("0.3000", "0.30")).toBe("verde");
    expect(semaforoMargen("0.2999", "0.30")).toBe("amarillo");
    expect(semaforoMargen("0.1500", "0.30")).toBe("amarillo");
    expect(semaforoMargen("0.1499", "0.30")).toBe("rojo");
    expect(semaforoMargen("-0.2000", "0.30")).toBe("rojo");
    // Otra meta: las franjas se recalculan solas.
    expect(semaforoMargen("0.2000", "0.40")).toBe("amarillo");
    expect(semaforoMargen("0.1900", "0.40")).toBe("rojo");
  });
});
