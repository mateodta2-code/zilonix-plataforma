import { describe, expect, it } from "vitest";
import { esLinkCortoMl, idCompetenciaDesdeLink, limpiarTituloCompetencia } from "@/lib/publicaciones/competencia";

describe("link de la competencia → id (solo el texto del link)", () => {
  it("publicación, catálogo y ?wid=, del país de la cuenta", () => {
    expect(idCompetenciaDesdeLink("https://articulo.mercadolibre.com.co/MCO-1234567890-bebedero-colibri-_JM", "MCO")).toEqual({ tipo: "item", id: "MCO1234567890" });
    expect(idCompetenciaDesdeLink("https://www.mercadolibre.com.co/bebedero/p/MCO22334455", "MCO")).toEqual({ tipo: "producto", id: "MCO22334455" });
    expect(idCompetenciaDesdeLink("https://www.mercadolibre.com.co/bebedero/p/MCO22334455?wid=MCO998877665", "MCO")).toEqual({ tipo: "item", id: "MCO998877665" });
    expect(idCompetenciaDesdeLink("https://produto.mercadolivre.com.br/MLB-123456789-garrafa", "MLB")).toEqual({ tipo: "item", id: "MLB123456789" });
    expect(idCompetenciaDesdeLink("https://articulo.mercadolibre.com.mx/MLM-55554444-x", "MLM")).toEqual({ tipo: "item", id: "MLM55554444" });
  });

  it("otro país, otro sitio, http o texto raro: null", () => {
    expect(idCompetenciaDesdeLink("https://articulo.mercadolibre.com.mx/MLM-55554444-x", "MCO")).toBeNull();
    expect(idCompetenciaDesdeLink("https://mercadolibre.com.co.ataque.com/MCO-1234567890", "MCO")).toBeNull();
    expect(idCompetenciaDesdeLink("http://articulo.mercadolibre.com.co/MCO-1234567890", "MCO")).toBeNull();
    expect(idCompetenciaDesdeLink("no es un link", "MCO")).toBeNull();
    expect(idCompetenciaDesdeLink("https://articulo.mercadolibre.com.co/MCO-1234567890", "mco")).toBeNull();
  });

  it("título pegado: sin etiquetas ni saltos, recortado", () => {
    expect(limpiarTituloCompetencia("  Bebedero <b>colibrí</b>\n x2 ")).toBe("Bebedero b colibrí /b x2");
    expect(limpiarTituloCompetencia(5)).toBe("");
    expect(limpiarTituloCompetencia("a".repeat(500))).toHaveLength(200);
  });
});

describe("esLinkCortoMl — links de «Compartir» de la app", () => {
  it("reconoce meli.la y nada más", () => {
    expect(esLinkCortoMl("https://meli.la/2AbCdEf")).toBe(true);
    expect(esLinkCortoMl("https://articulo.mercadolibre.com.co/MCO-123")).toBe(false);
    expect(esLinkCortoMl("https://meli.la.evil.com/x")).toBe(false);
    expect(esLinkCortoMl("no es un link")).toBe(false);
  });
});
