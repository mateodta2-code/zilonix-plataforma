import { describe, expect, it } from "vitest";
import { leerCompetenciaItem, leerExperienciaCompra, localeExperienciaCompra } from "@/lib/ml/cliente";

describe("leerCompetenciaItem", () => {
  it("lee estado, precio, boosts y motivo", () => {
    const r = leerCompetenciaItem({
      status: "competing",
      price_to_win: 95000,
      reason: ["not_winning"],
      boosts: [
        { id: "free_shipping", status: "opportunity", description: "Envío gratis" },
        { id: "fulfillment", status: "boosted" },
        { status: "x" },
      ],
    });
    expect(r.estado).toBe("competing");
    expect(r.precioParaGanar).toBe(95000);
    expect(r.motivo).toBe("not_winning");
    expect(r.boosts).toEqual([
      { id: "free_shipping", estado: "opportunity", descripcion: "Envío gratis" },
      { id: "fulfillment", estado: "boosted", descripcion: null },
    ]);
  });

  it("sin boosts: lista vacía y los campos de hoy intactos", () => {
    expect(leerCompetenciaItem({ status: "winning", price_to_win: 10 })).toEqual({ estado: "winning", precioParaGanar: 10, boosts: [], motivo: null });
    expect(leerCompetenciaItem(null)).toEqual({ estado: null, precioParaGanar: null, boosts: [], motivo: null });
  });
});

describe("leerExperienciaCompra", () => {
  it("reemplaza placeholders o los quita", () => {
    const r = leerExperienciaCompra({
      reputation: { color: "green", text: "Buena", value: 80 },
      title: { text: "Tuvo {0} reclamos", placeholders: ["3"] },
      subtitles: [{ text: "Revisa {0} el envío" }, { text: "" }],
      metrics_details: {
        problems: [
          {
            quantity: 2,
            tag: "delivery",
            level_two: { title: { text: "Entrega" } },
            level_three: { title: { text: "Llegó tarde" }, remedy: { text: "Despacha en {0} horas", placeholders: [24] } },
          },
        ],
      },
    });
    expect(r).toMatchObject({ color: "green", texto: "Buena", valor: 80, titulo: "Tuvo 3 reclamos", subtitulos: ["Revisa el envío"], congelada: null });
    expect(r.problemas).toEqual([{ cantidad: 2, etiqueta: "delivery", motivo: "Entrega", detalle: "Llegó tarde", solucion: "Despacha en 24 horas" }]);
  });

  it("sin problemas y con publicación congelada", () => {
    const r = leerExperienciaCompra({ reputation: { color: "gray", text: "Sin datos" }, freeze: { text: "Congelada por 30 días" } });
    expect(r.problemas).toEqual([]);
    expect(r.congelada).toBe("Congelada por 30 días");
  });
});

describe("localeExperienciaCompra", () => {
  it("sale del idioma de la cuenta y respeta la lista blanca", () => {
    expect(localeExperienciaCompra("es-CO")).toBe("es_CO");
    expect(localeExperienciaCompra("pt-BR")).toBe("pt_BR");
    expect(localeExperienciaCompra("fr-FR")).toBeNull();
    expect(localeExperienciaCompra(undefined)).toBeNull();
  });
});
