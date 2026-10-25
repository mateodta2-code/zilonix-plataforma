import { describe, expect, it } from "vitest";
import { franjaBogota, limiteFranjaDeHoy } from "./franja";

// Issue #244 — 13:00 Bogotá = 18:00 UTC es el corte. Instantes elegidos
// lejos del borde a propósito (las corridas reales son ~09:00 y ~18:00
// Bogotá, con horas de margen de cada lado del corte).
describe("franjaBogota (issue #244)", () => {
  it("09:00 Bogotá (14:00 UTC) es manana", () => {
    expect(franjaBogota(new Date("2026-03-10T14:00:00.000Z"))).toBe("manana");
  });

  it("18:00 Bogotá (23:00 UTC) es tarde", () => {
    expect(franjaBogota(new Date("2026-03-10T23:00:00.000Z"))).toBe("tarde");
  });

  it("justo antes del corte (12:59 Bogotá = 17:59 UTC) sigue siendo manana", () => {
    expect(franjaBogota(new Date("2026-03-10T17:59:00.000Z"))).toBe("manana");
  });

  it("justo en el corte (13:00 Bogotá = 18:00 UTC) ya es tarde", () => {
    expect(franjaBogota(new Date("2026-03-10T18:00:00.000Z"))).toBe("tarde");
  });
});

describe("limiteFranjaDeHoy (issue #244)", () => {
  it("medianoche UTC de un día + el corte da exactamente las 18:00 UTC de ese mismo día", () => {
    const medianocheUtc = new Date("2026-03-10T00:00:00.000Z");
    expect(limiteFranjaDeHoy(medianocheUtc).toISOString()).toBe("2026-03-10T18:00:00.000Z");
  });

  it("un instante antes del límite da manana, uno después da tarde — consistente con franjaBogota", () => {
    const medianocheUtc = new Date("2026-03-10T00:00:00.000Z");
    const limite = limiteFranjaDeHoy(medianocheUtc);
    const antes = new Date(limite.getTime() - 1);
    const despues = new Date(limite.getTime());
    expect(franjaBogota(antes)).toBe("manana");
    expect(franjaBogota(despues)).toBe("tarde");
  });
});
