import { describe, expect, it } from "vitest";
import { leerOfertasCompetencia } from "@/lib/ml/cliente";
import { alertasComparacion, elegirCompetidores, rotuloReputacion, type FilaComparacion } from "@/lib/optimizacion/competencia";

function fila(parcial: Partial<FilaComparacion>): FilaComparacion {
  return {
    itemId: "MCO1",
    propia: false,
    titulo: null,
    foto: null,
    precio: 100000,
    precioOriginal: null,
    tipoPublicacion: "gold_pro",
    envioGratis: true,
    full: true,
    fotos: 8,
    video: false,
    descripcion: true,
    reputacion: null,
    ...parcial,
  };
}

describe("vendedores del mismo producto (forma confirmada en staging, #466/#467)", () => {
  it("lee precio, precio original, tipo, envío gratis y Full", () => {
    const ofertas = leerOfertasCompetencia({
      paging: { total: 2 },
      results: [
        { item_id: "MCO10", seller_id: 123, price: 29900, original_price: 49900, listing_type_id: "gold_pro", shipping: { free_shipping: true, logistic_type: "fulfillment" } },
        { item_id: "no-id", price: 1 },
        { item_id: "MCO11", seller_id: "abc", price: 31000, original_price: null, listing_type_id: "gold_special", shipping: { free_shipping: false, logistic_type: "xd_drop_off" } },
      ],
    });
    expect(ofertas).toEqual([
      { itemId: "MCO10", vendedorId: "123", precio: 29900, precioOriginal: 49900, tipoPublicacion: "gold_pro", envioGratis: true, full: true },
      { itemId: "MCO11", vendedorId: null, precio: 31000, precioOriginal: null, tipoPublicacion: "gold_special", envioGratis: false, full: false },
    ]);
  });
});

describe("comparación", () => {
  it("los más baratos primero y como máximo 10", () => {
    const otras = Array.from({ length: 12 }, (_, i) => fila({ itemId: `MCO${i}`, precio: 1000 * (12 - i) }));
    const elegidas = elegirCompetidores([...otras, fila({ itemId: "SIN", precio: null })]);
    expect(elegidas).toHaveLength(10);
    expect(elegidas[0].precio).toBe(1000);
  });

  it("alertas de lo que te falta, con cuántos lo tienen", () => {
    const propia = fila({ propia: true, precio: 112000, envioGratis: false, full: false, tipoPublicacion: "gold_special", fotos: 4, video: false, descripcion: false });
    const otras = [fila({ itemId: "A", precio: 100000, video: true, fotos: 10 }), fila({ itemId: "B", precio: 105000, envioGratis: false, full: false })];
    expect(alertasComparacion(propia, otras)).toEqual([
      "Tu precio está 12 % arriba del más barato.",
      "Te falta envío gratis (1 de 2 lo tienen).",
      "Te falta Full (1 de 2 lo tienen).",
      "Te faltan las cuotas de Premium (2 de 2 son Premium).",
      "Tienes 4 fotos; el que más tiene, 10.",
      "Te falta video (1 de 2 lo tienen).",
      "Tu publicación no tiene descripción.",
    ]);
  });

  it("sin datos no acusa nada; si vas mejor, no hay alertas", () => {
    const propia = fila({ propia: true, precio: 90000, fotos: null, video: null, descripcion: null, envioGratis: null, full: null, tipoPublicacion: null });
    expect(alertasComparacion(propia, [fila({ itemId: "A" })])).toEqual([]);
    expect(alertasComparacion(fila({ propia: true }), [])).toEqual([]);
  });

  it("reputación legible", () => {
    expect(rotuloReputacion({ nivel: "5_green", lider: "gold" })).toBe("Nivel 5 verde · MercadoLíder Gold");
    expect(rotuloReputacion({ nivel: "3_yellow", lider: null })).toBe("Nivel 3 amarillo");
    expect(rotuloReputacion({ nivel: "raro", lider: "otro" })).toBe("raro · otro");
    expect(rotuloReputacion(null)).toBe("—");
  });
});
