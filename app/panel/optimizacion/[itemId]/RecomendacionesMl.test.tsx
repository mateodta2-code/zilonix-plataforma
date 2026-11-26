// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CalidadItemMl, CompetenciaItemMl, ExperienciaCompraMl } from "@/lib/ml/cliente";
import { RecomendacionesMl, tonoDeColor } from "./RecomendacionesMl";

afterEach(cleanup);

const calidad: CalidadItemMl = { puntaje: 72, nivel: "Estándar", pendientes: ["Agrega fotos", "Completa la ficha"] };
const experiencia: ExperienciaCompraMl = {
  color: "yellow",
  texto: "Regular",
  valor: 50,
  titulo: "Tu experiencia puede mejorar",
  subtitulos: [],
  congelada: "Congelada por 30 días",
  problemas: [{ cantidad: 2, etiqueta: "delivery", motivo: "Entrega", detalle: "Llegó tarde", solucion: "Despacha más rápido" }],
};
const competencia: CompetenciaItemMl = {
  estado: "competing",
  precioParaGanar: null,
  motivo: null,
  boosts: [
    { id: "fulfillment", estado: "boosted", descripcion: null },
    { id: "free_shipping", estado: "opportunity", descripcion: null },
  ],
};
const base = { competenciaAplica: true, item: { stock: 2, estado: "active" }, idioma: "es-CO" };

describe("RecomendacionesMl", () => {
  it("todo bien: las tres filas y la lista de recomendaciones", () => {
    render(<RecomendacionesMl {...base} calidad={calidad} experiencia={experiencia} competencia={competencia} />);
    expect(screen.getByText("Recomendaciones de Mercado Libre")).toBeTruthy();
    expect(screen.getByText("2 objetivos pendientes")).toBeTruthy();
    expect(screen.getByText("Regular")).toBeTruthy();
    expect(screen.getByText("Congelada por 30 días")).toBeTruthy();
    expect(screen.getByText("Full: Tienes")).toBeTruthy();
    expect(screen.getByText("Envío gratis: Te falta")).toBeTruthy();
    const lista = screen.getByLabelText("Recomendaciones");
    for (const t of ["Ofrece envío gratis", "Agrega fotos", "Despacha más rápido", "Agrega más stock"]) expect(lista.textContent).toContain(t);
    expect(screen.queryByText("Mercado Libre no respondió")).toBeNull();
  });

  it("una fila caída: solo esa lo dice y las demás siguen", () => {
    render(<RecomendacionesMl {...base} calidad={calidad} experiencia={null} competencia={competencia} />);
    expect(screen.getAllByText("Mercado Libre no respondió")).toHaveLength(1);
    expect(screen.getByText("Estándar")).toBeTruthy();
    expect(screen.getByText("Full: Tienes")).toBeTruthy();
  });

  it("sin catálogo la competencia no aplica y no es una falla", () => {
    render(<RecomendacionesMl {...base} competenciaAplica={false} calidad={calidad} experiencia={experiencia} competencia={null} />);
    expect(screen.getByText(/No aplica/)).toBeTruthy();
    expect(screen.queryByText("Mercado Libre no respondió")).toBeNull();
  });

  it("color de ML a tono del chip", () => {
    expect(tonoDeColor("green")).toBe("exito");
    expect(tonoDeColor("orange")).toBe("advertencia");
    expect(tonoDeColor("red")).toBe("peligro");
    expect(tonoDeColor("gray")).toBe("neutro");
    expect(tonoDeColor(null)).toBe("neutro");
  });
});
