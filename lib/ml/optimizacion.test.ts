import { describe, expect, it } from "vitest";
import {
  calcularConversion,
  contarObjetivosPendientes,
  etiquetaTipoPublicacion,
  formatearConversion,
  hrefOptimizacion,
  interpretarCompetencia,
  leerFiltroOptimizacion,
  lineasDeOrdenesMl,
  precioConPromocion,
  rangoUltimosDias,
  resumirCalidad,
  ventasPorItemEnRango,
} from "./optimizacion";

const fecha = (iso: string) => new Date(iso);

describe("calcularConversion / formatearConversion", () => {
  it("ventas ÷ visitas", () => {
    expect(calcularConversion(5, 100)).toBeCloseTo(0.05);
  });
  it("sin visitas no se estima: null y '—'", () => {
    expect(calcularConversion(3, 0)).toBeNull();
    expect(calcularConversion(3, null)).toBeNull();
    expect(calcularConversion(null, 10)).toBeNull();
    expect(formatearConversion(null, String)).toBe("—");
  });
  it("formatea con el formateador del sitio que le pasan", () => {
    expect(formatearConversion(0.0537, (n) => `n=${n}`)).toBe("n=5.4 %");
  });
});

describe("objetivos de calidad (performance)", () => {
  const performance = {
    score: 78,
    level_wording: "Satisfactoria",
    buckets: [
      {
        variables: [
          {
            rules: [
              { key: "r1", status: "PENDING", wordings: { title: "Agrega una foto en alta calidad" } },
              { key: "r2", status: "COMPLETED", wordings: { title: "Título claro" } },
            ],
          },
          { rules: [{ key: "r3", status: "PENDING" }] },
        ],
      },
      { variables: [{ rules: [{ key: "r4", status: "PENDING", title: "Completa los atributos" }] }] },
    ],
  };
  it("cuenta solo las reglas PENDING y trae su título", () => {
    expect(contarObjetivosPendientes(performance)).toEqual(["Agrega una foto en alta calidad", "r3", "Completa los atributos"]);
  });
  it("resume score, nivel y objetivos", () => {
    expect(resumirCalidad(performance)).toEqual({
      score: 78,
      nivel: "Satisfactoria",
      objetivosPendientes: ["Agrega una foto en alta calidad", "r3", "Completa los atributos"],
    });
  });
  it("respuesta inesperada: sin crash", () => {
    expect(contarObjetivosPendientes(null)).toEqual([]);
    expect(contarObjetivosPendientes({ buckets: "x" })).toEqual([]);
    expect(resumirCalidad({})).toBeNull();
    expect(resumirCalidad("texto")).toBeNull();
  });
});

describe("interpretarCompetencia", () => {
  it("traduce los 4 estados", () => {
    expect(interpretarCompetencia(true, { status: "winning" })?.texto).toBe("Ganando");
    expect(interpretarCompetencia(true, { status: "competing" })?.texto).toBe("Compitiendo");
    expect(interpretarCompetencia(true, { status: "sharing_first_place" })?.texto).toBe("Compartiendo primer lugar");
    expect(interpretarCompetencia(true, { status: "listed", reason: ["motivo_a", "motivo_b"] })).toEqual({
      texto: "Listada (no compite)",
      detalle: "motivo_a, motivo_b",
    });
  });
  it("si no es de catálogo: no compite (sin llamar a la API)", () => {
    expect(interpretarCompetencia(false, null)).toEqual({ texto: "No compite en catálogo", detalle: null });
  });
  it("estado desconocido o respuesta vacía: null (No disponible), nunca inventado", () => {
    expect(interpretarCompetencia(true, { status: "otro" })).toBeNull();
    expect(interpretarCompetencia(true, null)).toBeNull();
  });
});

describe("ventas por ítem en un rango cualquiera", () => {
  const lineas = [
    { itemId: "AAA1", cantidad: 2, fecha: fecha("2026-11-10T10:00:00Z"), cancelada: false },
    { itemId: "AAA1", cantidad: 1, fecha: fecha("2026-11-12T10:00:00Z"), cancelada: false },
    { itemId: "AAA1", cantidad: 5, fecha: fecha("2026-11-12T11:00:00Z"), cancelada: true },
    { itemId: "BBB2", cantidad: 4, fecha: fecha("2026-11-01T10:00:00Z"), cancelada: false },
  ];
  it("agrupa por item, excluye canceladas y fuera de rango", () => {
    expect(ventasPorItemEnRango(lineas, fecha("2026-11-09T00:00:00Z"), fecha("2026-11-16T00:00:00Z"))).toEqual({ AAA1: 3 });
  });
  it("otro rango (no fijo en 7 días)", () => {
    expect(ventasPorItemEnRango(lineas, fecha("2026-10-30T00:00:00Z"), fecha("2026-11-16T00:00:00Z"))).toEqual({ AAA1: 3, BBB2: 4 });
  });
  it("rangoUltimosDias", () => {
    const { desde, hasta } = rangoUltimosDias(7, fecha("2026-11-17T00:00:00Z"));
    expect(hasta.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(desde.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });
  it("lee órdenes crudas de /orders/search y marca las canceladas", () => {
    const l = lineasDeOrdenesMl([
      { status: "paid", date_created: "2026-11-12T10:00:00Z", order_items: [{ item: { id: "AAA1" }, quantity: 2 }] },
      { status: "cancelled", date_created: "2026-11-12T10:00:00Z", order_items: [{ item: { id: "AAA1" }, quantity: 9 }] },
      { status: "paid", date_created: "fecha mala", order_items: [{ item: { id: "AAA1" }, quantity: 1 }] },
      null,
    ]);
    expect(ventasPorItemEnRango(l, fecha("2026-11-01T00:00:00Z"), fecha("2026-11-30T00:00:00Z"))).toEqual({ AAA1: 2 });
  });
});

describe("precio, tipo y filtros", () => {
  it("promoción solo si el regular es mayor", () => {
    expect(precioConPromocion({ monto: 80, regular: 100 })).toEqual({ vigente: 80, regular: 100 });
    expect(precioConPromocion({ monto: 100, regular: 100 })).toBeNull();
    expect(precioConPromocion({ monto: 100, regular: null })).toBeNull();
    expect(precioConPromocion(null)).toBeNull();
  });
  it("tipo de publicación: conocido traducido, desconocido tal cual", () => {
    expect(etiquetaTipoPublicacion("gold_special")).toBe("Clásica");
    expect(etiquetaTipoPublicacion("gold_pro")).toBe("Premium");
    expect(etiquetaTipoPublicacion("nuevo_tipo")).toBe("nuevo_tipo");
    expect(etiquetaTipoPublicacion(null)).toBeNull();
  });
  it("filtro de la URL no confía en la entrada", () => {
    expect(leerFiltroOptimizacion({ estado: "hack", q: "  x ".padEnd(200, "y"), pagina: "-3" })).toEqual({ estado: "todas", q: `x ${"y".repeat(78)}`, pagina: 1 });
    expect(leerFiltroOptimizacion({ estado: "paused", pagina: "3" })).toEqual({ estado: "paused", q: "", pagina: 3 });
  });
  it("hrefOptimizacion omite lo que está por defecto", () => {
    const base = { cuenta: null, filtro: { estado: "todas" as const, q: "", pagina: 1 } };
    expect(hrefOptimizacion(base)).toBe("/panel/optimizacion");
    expect(hrefOptimizacion({ ...base, cuenta: "c1" }, { estado: "active", q: "taza", pagina: 2 })).toBe("/panel/optimizacion?cuenta=c1&estado=active&q=taza&pagina=2");
  });
});
