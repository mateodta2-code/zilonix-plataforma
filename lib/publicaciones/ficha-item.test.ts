import { describe, expect, it } from "vitest";
import { fichaConfirmada } from "./ficha";
import { fichaDesdeItem } from "./ficha-item";

describe("fichaDesdeItem", () => {
  it("arma la ficha solo con lo publicado, todo origen vendedor y confirmada", () => {
    const r = fichaDesdeItem({
      titulo: "Garrafa Térmica 1 L",
      atributos: [
        { id: "COLOR", nombre: "Color", valor: "Negro" },
        { id: "MATERIAL", nombre: "Material", valor: "Acero" },
        { id: "BRAND", nombre: "Marca", valor: "Acme" },
        { id: "GTIN", nombre: "Código universal", valor: "7701234567890" },
      ],
      descripcion: "<p>Mantiene el calor 12 horas.</p>",
    });
    expect(r).not.toBeNull();
    expect(fichaConfirmada(r!.ficha)).toBe(true);
    expect(r!.ficha.nombre).toEqual({ valor: "Garrafa Térmica 1 L", origen: "vendedor" });
    expect(r!.ficha.color.valor).toBe("Negro");
    expect(r!.ficha.material.valor).toBe("Acero");
    expect(r!.ficha.caracteristicas.valor).toEqual(["Marca: Acme"]);
    expect(r!.info).toBe("Mantiene el calor 12 horas.");
    for (const c of Object.values(r!.ficha)) expect(c.origen).toBe("vendedor");
  });

  it("sin título no hay ficha", () => {
    expect(fichaDesdeItem({ titulo: "  ", atributos: [] })).toBeNull();
    expect(fichaDesdeItem({ titulo: null, atributos: [] })).toBeNull();
  });

  it("sin atributos ni descripción sirve solo con el título", () => {
    const r = fichaDesdeItem({ titulo: "Audífonos", atributos: [], descripcion: null });
    expect(r?.ficha.color.valor).toBeNull();
    expect(r?.info).toBe("");
    expect(r && fichaConfirmada(r.ficha)).toBe(true);
  });
});
