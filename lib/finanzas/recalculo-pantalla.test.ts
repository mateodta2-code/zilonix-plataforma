import { describe, expect, it } from "vitest";
import { MENSAJE_FILTRO_VACIO, parsearFiltroRecalculo } from "./recalculo-pantalla";

// Issue #131 (Parte C) — filtro del panel de recálculo, puro.

describe("parsearFiltroRecalculo", () => {
  it("días de Bogotá: «Desde» al inicio del día, «Hasta» incluido → fin exclusivo", () => {
    const r = parsearFiltroRecalculo({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(r).toEqual({
      ok: true,
      filtro: { skuCodigo: undefined, desde: new Date("2026-10-01T05:00:00.000Z"), hasta: new Date("2026-11-01T05:00:00.000Z") },
      normalizado: {
        skuCodigo: undefined,
        desde: "2026-10-01",
        hasta: "2026-10-31",
        desdeIso: "2026-10-01T05:00:00.000Z",
        hastaIso: "2026-11-01T05:00:00.000Z",
      },
    });
  });

  it("un solo día (desde = hasta) es válido; SKU solo, con espacios, también", () => {
    expect(parsearFiltroRecalculo({ desde: "2026-10-05", hasta: "2026-10-05" }).ok).toBe(true);
    const sku = parsearFiltroRecalculo({ skuCodigo: "  base ", desde: "", hasta: "  " });
    expect(sku).toMatchObject({ ok: true, filtro: { skuCodigo: "base", desde: undefined, hasta: undefined } });
  });

  it("sin SKU ni fechas, fechas inválidas o al revés: mensaje claro", () => {
    expect(parsearFiltroRecalculo({})).toEqual({ ok: false, mensaje: MENSAJE_FILTRO_VACIO });
    expect(parsearFiltroRecalculo({ skuCodigo: "  " })).toEqual({ ok: false, mensaje: MENSAJE_FILTRO_VACIO });
    expect(parsearFiltroRecalculo({ desde: "2026-02-30" })).toEqual({ ok: false, mensaje: "La fecha «Desde» no es válida." });
    expect(parsearFiltroRecalculo({ hasta: "31/10/2026" })).toEqual({ ok: false, mensaje: "La fecha «Hasta» no es válida." });
    expect(parsearFiltroRecalculo({ desde: "2026-10-10", hasta: "2026-10-09" })).toEqual({
      ok: false,
      mensaje: "La fecha «Hasta» no puede ser anterior a «Desde».",
    });
  });
});
