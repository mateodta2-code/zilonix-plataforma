import { describe, expect, it } from "vitest";
import { camposPorConfirmar, fichaConfirmada } from "@/lib/publicaciones/ficha";
import { fichaDesdeItem, infoDeDescripcion } from "./fichaItem";
import { leerAtributosItem } from "@/lib/ml/cliente";

describe("fichaDesdeItem", () => {
  const atributos = [
    { id: "BRAND", nombre: "Marca", valor: "Acme" },
    { id: "COLOR", nombre: "Color", valor: "Azul" },
    { id: "MATERIAL", nombre: "Material", valor: "Acero" },
    { id: "GTIN", nombre: "Código", valor: "123" },
  ];

  it("todo con origen vendedor: queda confirmada, sin inventar", () => {
    const ficha = fichaDesdeItem({ titulo: "  Termo   acero 1 L ", atributos });
    expect(ficha).not.toBeNull();
    expect(ficha!.nombre).toEqual({ valor: "Termo acero 1 L", origen: "vendedor" });
    expect(ficha!.color.valor).toBe("Azul");
    expect(ficha!.material.valor).toBe("Acero");
    expect(ficha!.caracteristicas.valor).toEqual(["Marca: Acme"]);
    expect(camposPorConfirmar(ficha!)).toEqual([]);
    expect(fichaConfirmada(ficha!)).toBe(true);
  });

  it("sin título no hay ficha", () => {
    expect(fichaDesdeItem({ titulo: "   ", atributos })).toBeNull();
  });

  it("sin atributos usa solo el título", () => {
    const ficha = fichaDesdeItem({ titulo: "Termo", atributos: [] })!;
    expect(ficha.color.valor).toBeNull();
    expect(fichaConfirmada(ficha)).toBe(true);
  });
});

describe("infoDeDescripcion / leerAtributosItem", () => {
  it("limpia HTML y recorta", () => {
    expect(infoDeDescripcion("<b>Hola</b>   mundo")).toBe("Hola mundo");
    expect(infoDeDescripcion("a".repeat(2000)).length).toBe(800);
    expect(infoDeDescripcion(null)).toBe("");
  });

  it("lee categoría y atributos con valor", () => {
    const r = leerAtributosItem({ category_id: "MCO1234", attributes: [{ id: "BRAND", name: "Marca", value_name: "Acme" }, { id: "X", name: "Y", value_name: null }, 5] });
    expect(r).toEqual({ categoriaId: "MCO1234", atributos: [{ id: "BRAND", nombre: "Marca", valor: "Acme" }] });
    expect(leerAtributosItem(null)).toEqual({ categoriaId: null, atributos: [] });
  });
});
