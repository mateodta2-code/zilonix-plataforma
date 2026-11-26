import { describe, expect, it } from "vitest";
import type { CalidadItemMl, CompetenciaItemMl, ExperienciaCompraMl } from "@/lib/ml/cliente";
import { armarRecomendaciones, STOCK_BAJO } from "@/lib/optimizacion/recomendaciones";

const item = { stock: 50, estado: "active" };
const competencia = (boosts: CompetenciaItemMl["boosts"]): CompetenciaItemMl => ({ estado: "competing", precioParaGanar: null, boosts, motivo: null });
const calidad = (pendientes: string[]): CalidadItemMl => ({ puntaje: 70, nivel: "Estándar", pendientes });
const experiencia = (soluciones: (string | null)[]): ExperienciaCompraMl => ({
  color: "yellow",
  texto: "Regular",
  valor: 50,
  titulo: null,
  subtitulos: [],
  congelada: null,
  problemas: soluciones.map((s, i) => ({ cantidad: 1, etiqueta: `p${i}`, motivo: null, detalle: null, solucion: s })),
});

describe("armarRecomendaciones", () => {
  it("sin datos no inventa nada", () => {
    expect(armarRecomendaciones({ competencia: null, calidad: null, experiencia: null, item })).toEqual([]);
  });

  it("boosts en oportunidad, conocidos y desconocidos; ignora los demás estados", () => {
    const r = armarRecomendaciones({
      competencia: competencia([
        { id: "free_shipping", estado: "opportunity", descripcion: null },
        { id: "free_installments", estado: "opportunity", descripcion: null },
        { id: "fulfillment", estado: "opportunity", descripcion: null },
        { id: "same_day_shipping", estado: "opportunity", descripcion: null },
        { id: "nuevo", estado: "opportunity", descripcion: "Texto de ML" },
        { id: "raro", estado: "opportunity", descripcion: null },
        { id: "shipping_collect", estado: "boosted", descripcion: "x" },
      ]),
      calidad: null,
      experiencia: null,
      item,
    });
    expect(r.map((x) => x.texto)).toEqual(["Ofrece envío gratis", "Ofrece cuotas sin interés", "Usa Mercado Envíos Full", "Ofrece envío en el día", "Texto de ML"]);
    expect(r.every((x) => x.origen === "competencia")).toBe(true);
  });

  it("calidad y experiencia, en ese orden, con el texto de ML", () => {
    const r = armarRecomendaciones({ competencia: null, calidad: calidad(["Agrega fotos"]), experiencia: experiencia(["Despacha más rápido", null]), item });
    expect(r.map((x) => [x.origen, x.texto])).toEqual([
      ["calidad", "Agrega fotos"],
      ["experiencia", "Despacha más rápido"],
    ]);
  });

  it("sin repetidos", () => {
    const r = armarRecomendaciones({ competencia: null, calidad: calidad(["Agrega fotos", "agrega fotos"]), experiencia: experiencia(["Agrega fotos"]), item });
    expect(r).toHaveLength(1);
  });

  it("stock bajo solo si está activa", () => {
    const base = { competencia: null, calidad: null, experiencia: null };
    expect(armarRecomendaciones({ ...base, item: { stock: STOCK_BAJO, estado: "active" } }).map((x) => x.texto)).toEqual(["Agrega más stock"]);
    expect(armarRecomendaciones({ ...base, item: { stock: STOCK_BAJO + 1, estado: "active" } })).toEqual([]);
    expect(armarRecomendaciones({ ...base, item: { stock: 0, estado: "paused" } })).toEqual([]);
    expect(armarRecomendaciones({ ...base, item: { stock: null, estado: "active" } })).toEqual([]);
  });
});
