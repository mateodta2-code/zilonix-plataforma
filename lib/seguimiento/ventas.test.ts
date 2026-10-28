import { describe, expect, it } from "vitest";
import { ETIQUETA_ESTIMADO } from "@/lib/ml/estimacionVentas";
import { elegirVentasMes, ETIQUETA_MEDIDO, ventasDelPeriodo } from "./ventas";

describe("ventasDelPeriodo — vendidos (sold_quantity, acumulado) de dos fotos reales (issue #196)", () => {
  it("resta normal: actual > anterior", () => {
    expect(ventasDelPeriodo(230, 215)).toBe(15);
  });

  it("sin ventas en el período: 0, un número real, nunca null", () => {
    expect(ventasDelPeriodo(230, 230)).toBe(0);
  });

  it("falta cualquiera de los dos datos: null, nunca 0 ni una resta inventada", () => {
    expect(ventasDelPeriodo(null, 215)).toBeNull();
    expect(ventasDelPeriodo(230, null)).toBeNull();
    expect(ventasDelPeriodo(null, null)).toBeNull();
  });

  it("resultado negativo (vendidos nunca debería bajar): null, nunca un negativo fabricado", () => {
    expect(ventasDelPeriodo(100, 230)).toBeNull();
  });
});

describe("elegirVentasMes — estimado vs medido (issue #222)", () => {
  it("medido gana si no es null, aunque también exista un estimado", () => {
    expect(elegirVentasMes(40, 15)).toEqual({ valor: 15, etiqueta: ETIQUETA_MEDIDO });
  });

  it("medido en 0 (ventas reales en 0 en el período) sigue siendo medido, nunca cae al estimado", () => {
    expect(elegirVentasMes(40, 0)).toEqual({ valor: 0, etiqueta: ETIQUETA_MEDIDO });
  });

  it("sin medido: usa el estimado con su etiqueta de siempre", () => {
    expect(elegirVentasMes(40, null)).toEqual({ valor: 40, etiqueta: ETIQUETA_ESTIMADO });
  });

  it("sin medido ni estimado: valor null, etiqueta Estimado (nunca inventa un número)", () => {
    expect(elegirVentasMes(null, null)).toEqual({ valor: null, etiqueta: ETIQUETA_ESTIMADO });
  });
});
