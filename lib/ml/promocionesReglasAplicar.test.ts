import { describe, expect, it } from "vitest";
import { evaluarReglasAdicionales, type PromocionParaReglas } from "./promocionesReglasAplicar";
import { validarReglasAdicionales, type ReglasAdicionales } from "./promocionesReglasTexto";

function reglas(parcial: Record<string, unknown>): ReglasAdicionales {
  const r = validarReglasAdicionales({ version: 1, ...parcial });
  if (!r.ok) throw new Error(r.error);
  return r.reglas;
}

const PROMO: PromocionParaReglas = {
  skuCodigo: "SKU-X",
  tipoPromocion: "DEAL",
  nombrePromocion: "Campaña Black Friday 2026",
  esCompartida: false,
  fechaInicio: "2026-11-27T00:00:00.000-03:00",
  fechaFin: "2026-11-30T23:59:59.000-03:00",
  precioOriginal: 100000,
  precioSugerido: 60000, // el piso de Finanzas (60% del original → 40% de descuento)
  precioMinimo: 60000,
  maxDiscountedPrice: null,
};

describe("evaluarReglasAdicionales — exclusiones", () => {
  it("sin reglas guardadas: no cambia nada", () => {
    expect(evaluarReglasAdicionales(null, PROMO)).toMatchObject({ excluida: false, precioFinal: 60000, motivoVisible: null });
  });

  it("por nombre (sin mayúsculas ni tildes): «no entrar en Black Friday»", () => {
    const e = evaluarReglasAdicionales(reglas({ exclusiones: [{ tipo: "nombre_promocion", valor: "BLÁCK FRIDAY" }] }), PROMO);
    expect(e.excluida).toBe(true);
    expect(e.motivoVisible).toContain("Excluida por");
    expect(e.motivoVisible).toContain("black friday");
    expect(evaluarReglasAdicionales(reglas({ exclusiones: [{ tipo: "nombre_promocion", valor: "cyber monday" }] }), PROMO).excluida).toBe(false);
  });

  it("por nombre sin nombre de ML: se excluye con motivo claro (nunca se adivina)", () => {
    const e = evaluarReglasAdicionales(reglas({ exclusiones: [{ tipo: "nombre_promocion", valor: "black friday" }] }), { ...PROMO, nombrePromocion: null });
    expect(e.excluida).toBe(true);
    expect(e.motivoVisible).toContain("no se pudo leer el nombre");
  });

  it("por tipo", () => {
    expect(evaluarReglasAdicionales(reglas({ exclusiones: [{ tipo: "tipo_promocion", valor: "deal" }] }), PROMO).excluida).toBe(true);
    expect(evaluarReglasAdicionales(reglas({ exclusiones: [{ tipo: "tipo_promocion", valor: "lightning" }] }), PROMO).excluida).toBe(false);
  });

  it("compartida: solo excluye las compartidas", () => {
    const r = reglas({ exclusiones: [{ tipo: "compartida" }] });
    expect(evaluarReglasAdicionales(r, { ...PROMO, esCompartida: true }).excluida).toBe(true);
    expect(evaluarReglasAdicionales(r, PROMO).excluida).toBe(false);
  });
});

describe("evaluarReglasAdicionales — ventanas de fechas", () => {
  const r = (desde: string, hasta: string) => reglas({ ventanasFecha: [{ desde, hasta, accion: "no_entrar" }] });

  it("excluye una promoción que se cruza con la ventana", () => {
    expect(evaluarReglasAdicionales(r("2026-11-29", "2026-12-05"), PROMO).excluida).toBe(true);
    expect(evaluarReglasAdicionales(r("2026-11-01", "2026-11-27"), PROMO).excluida).toBe(true);
    expect(evaluarReglasAdicionales(r("2026-11-28", "2026-11-29"), PROMO).excluida).toBe(true);
  });

  it("no excluye una promoción fuera de la ventana", () => {
    expect(evaluarReglasAdicionales(r("2026-12-01", "2026-12-31"), PROMO).excluida).toBe(false);
    expect(evaluarReglasAdicionales(r("2026-10-01", "2026-11-26"), PROMO).excluida).toBe(false);
  });

  it("sin fechas de la promoción no se puede verificar: se excluye con motivo", () => {
    const e = evaluarReglasAdicionales(r("2026-12-01", "2026-12-31"), { ...PROMO, fechaInicio: null, fechaFin: null });
    expect(e.excluida).toBe(true);
    expect(e.motivoVisible).toContain("no se pudieron leer las fechas");
  });
});

describe("evaluarReglasAdicionales — máximos y piso", () => {
  it("máximo global: sube el precio hasta el tope de descuento (limitada), con motivo", () => {
    const e = evaluarReglasAdicionales(reglas({ maximoDescuentoPct: 20 }), PROMO);
    expect(e.excluida).toBe(false);
    expect(e.precioFinal).toBe(80000);
    expect(e.maxPctEfectivo).toBe(20);
    expect(e.motivoVisible).toBe("Limitada a 20% por: máximo 20% de descuento");
  });

  it("máximo por SKU solo aplica a ese SKU", () => {
    const r = reglas({ maximoPorSku: [{ sku: "sku-x", maximoPct: 20 }] });
    expect(evaluarReglasAdicionales(r, PROMO).motivoVisible).toBe("Limitada a 20% por: máximo 20% de descuento en el SKU sku-x".replace("sku-x", "sku-x"));
    expect(evaluarReglasAdicionales(r, { ...PROMO, skuCodigo: "OTRO" })).toMatchObject({ precioFinal: 60000, motivoVisible: null });
  });

  it("gana el más estricto entre el global y el del SKU", () => {
    const e = evaluarReglasAdicionales(reglas({ maximoDescuentoPct: 30, maximoPorSku: [{ sku: "SKU-X", maximoPct: 10 }] }), PROMO);
    expect(e.maxPctEfectivo).toBe(10);
    expect(e.precioFinal).toBe(90000);
  });

  it("EL PISO SIEMPRE GANA: nunca baja de él, aunque la regla permita más descuento", () => {
    // La regla permite 60% de descuento (precio 40.000) pero el piso es 60.000.
    const e = evaluarReglasAdicionales(reglas({ maximoDescuentoPct: 60 }), PROMO);
    expect(e.precioFinal).toBe(60000);
    expect(e.motivoVisible).toBeNull();
    // Y con cualquier regla, el precio final nunca queda bajo el piso.
    for (const pct of [1, 10, 25, 40, 50, 99, 100]) {
      const ev = evaluarReglasAdicionales(reglas({ maximoDescuentoPct: pct }), PROMO);
      if (!ev.excluida) expect(ev.precioFinal as number).toBeGreaterThanOrEqual(60000);
    }
  });

  it("si el precio que exige la regla supera el máximo que permite la promoción: se excluye con motivo", () => {
    const e = evaluarReglasAdicionales(reglas({ maximoDescuentoPct: 10 }), { ...PROMO, maxDiscountedPrice: 85000 });
    expect(e.excluida).toBe(true);
    expect(e.motivoVisible).toContain("no permite");
  });

  it("sin precio original no se puede calcular un máximo: se excluye con motivo", () => {
    expect(evaluarReglasAdicionales(reglas({ maximoDescuentoPct: 20 }), { ...PROMO, precioOriginal: null }).excluida).toBe(true);
  });

  it("redondea hacia arriba: nunca queda más descuento del permitido", () => {
    const e = evaluarReglasAdicionales(reglas({ maximoDescuentoPct: 33 }), { ...PROMO, precioOriginal: 99999, precioSugerido: 50000, precioMinimo: 50000 });
    expect(e.precioFinal).toBe(Math.ceil(99999 * 0.67));
  });
});
