import { describe, expect, it } from "vitest";
import { ventasDelPeriodo } from "./ventas";

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
