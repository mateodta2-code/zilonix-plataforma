import { describe, expect, it } from "vitest";
import { buscarFotoDeHaceUnMes, calcularDelta, calcularVentasHoy } from "./comparativa";

describe("calcularDelta", () => {
  it("resta actual - anterior cuando los dos existen", () => {
    expect(calcularDelta(9, 10)).toBe(-1);
    expect(calcularDelta(50000, 48000)).toBe(2000);
    expect(calcularDelta("90", "100")).toBe(-10); // precio viene como string (numeric de Postgres)
  });

  it("null si falta cualquiera de los dos — nunca NaN", () => {
    expect(calcularDelta(null, 10)).toBeNull();
    expect(calcularDelta(10, null)).toBeNull();
    expect(calcularDelta(null, null)).toBeNull();
  });

  it("0 cuando no cambió nada", () => {
    expect(calcularDelta(5, 5)).toBe(0);
  });
});

describe("calcularVentasHoy", () => {
  it("max(0, actual - anterior) cuando ambos existen", () => {
    expect(calcularVentasHoy(537, 528)).toBe(9);
  });

  // Bug real que esto evita: vendidos es un acumulado histórico de
  // Mercado Libre — nunca debería bajar, pero si algún día lo hace
  // (dato raro de ML), "ventas hoy" nunca debe mostrar un número
  // negativo que no tiene sentido de negocio.
  it("nunca negativo, aunque vendidos haya bajado", () => {
    expect(calcularVentasHoy(500, 510)).toBe(0);
  });

  it("sin foto anterior (o sin dato) -> null, nunca 0 adivinado", () => {
    expect(calcularVentasHoy(537, null)).toBeNull();
    expect(calcularVentasHoy(null, 528)).toBeNull();
  });

  it("sin cambio -> 0", () => {
    expect(calcularVentasHoy(537, 537)).toBe(0);
  });
});

describe("buscarFotoDeHaceUnMes", () => {
  const diasAtras = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const HOY = new Date();

  it("elige la foto más cercana a 30 días atrás entre las que ya tienen al menos 25", () => {
    const fotos = [
      { fecha: diasAtras(2), vendidos: 100 },
      { fecha: diasAtras(10), vendidos: 90 },
      { fecha: diasAtras(29), vendidos: 50 }, // la más cercana a 30
      { fecha: diasAtras(60), vendidos: 10 },
    ];
    expect(buscarFotoDeHaceUnMes(fotos, HOY)?.vendidos).toBe(50);
  });

  it("sin ninguna foto de al menos 25 días -> null, nunca una más reciente que eso", () => {
    const fotos = [
      { fecha: diasAtras(1), vendidos: 100 },
      { fecha: diasAtras(20), vendidos: 90 },
    ];
    expect(buscarFotoDeHaceUnMes(fotos, HOY)).toBeNull();
  });

  it("exactamente 25 días cuenta (el mínimo, no estrictamente mayor)", () => {
    const fotos = [{ fecha: diasAtras(25), vendidos: 77 }];
    expect(buscarFotoDeHaceUnMes(fotos, HOY)?.vendidos).toBe(77);
  });

  it("lista vacía -> null", () => {
    expect(buscarFotoDeHaceUnMes([], HOY)).toBeNull();
  });
});
