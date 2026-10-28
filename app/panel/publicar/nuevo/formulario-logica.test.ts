import { describe, expect, it } from "vitest";
import { esRellenoFalsoDimensiones, fotosDentroDelLimite, productoCartesiano, serializarCategoriaOverride, serializarClaveValor } from "./formulario-logica";

describe("esRellenoFalsoDimensiones — ADENDO UX de Publicar, punto 9", () => {
  it("las 4 medidas en 1 (relleno falso): true", () => {
    expect(esRellenoFalsoDimensiones({ peso: "1", largo: "1", ancho: "1", alto: "1" })).toBe(true);
  });

  it("las 4 medidas por debajo de 1 (ej. 0.5): también true — nunca solo exactamente '1'", () => {
    expect(esRellenoFalsoDimensiones({ peso: "0.5", largo: "1", ancho: "0.8", alto: "0" })).toBe(true);
  });

  it("medidas reales (alguna > 1): false, nunca bloquea un paquete real", () => {
    expect(esRellenoFalsoDimensiones({ peso: "500", largo: "20", ancho: "15", alto: "10" })).toBe(false);
  });

  it("una sola medida en 1 pero las demás reales: false — no todas son <=1", () => {
    expect(esRellenoFalsoDimensiones({ peso: "500", largo: "1", ancho: "15", alto: "10" })).toBe(false);
  });

  it("alguna medida vacía (todavía sin completar): false — no se bloquea algo a medio llenar", () => {
    expect(esRellenoFalsoDimensiones({ peso: "1", largo: "1", ancho: "1", alto: "" })).toBe(false);
  });

  it("valor no numérico: false, nunca lanza", () => {
    expect(esRellenoFalsoDimensiones({ peso: "mucho", largo: "1", ancho: "1", alto: "1" })).toBe(false);
  });
});

describe("productoCartesiano — ADENDO UX de Publicar, punto 4 (editor de variantes)", () => {
  it("un solo eje: una combinación por valor", () => {
    expect(productoCartesiano({ TALLA: ["S", "M", "L"] }, ["TALLA"])).toEqual([{ TALLA: "S" }, { TALLA: "M" }, { TALLA: "L" }]);
  });

  it("dos ejes: el producto cartesiano completo, en orden", () => {
    const resultado = productoCartesiano({ TALLA: ["S", "M"], COLOR: ["Rojo", "Azul"] }, ["TALLA", "COLOR"]);
    expect(resultado).toEqual([
      { TALLA: "S", COLOR: "Rojo" },
      { TALLA: "S", COLOR: "Azul" },
      { TALLA: "M", COLOR: "Rojo" },
      { TALLA: "M", COLOR: "Azul" },
    ]);
  });

  it("un eje sin ningún valor elegido todavía: sin combinaciones (nunca inventa una vacía)", () => {
    expect(productoCartesiano({ TALLA: [] }, ["TALLA"])).toEqual([]);
  });

  it("sin ejes: sin combinaciones", () => {
    expect(productoCartesiano({}, [])).toEqual([]);
  });
});

describe("serializarClaveValor — mismo formato que parsearLineasClaveValor (nuevo/actions.ts) ya lee", () => {
  it("arma 'ID=valor' por línea", () => {
    expect(serializarClaveValor({ BRAND: "Genérica", GTIN: "7701234567890" })).toBe("BRAND=Genérica\nGTIN=7701234567890");
  });

  it("omite valores vacíos (el parser los ignora igual, nunca manda una línea basura)", () => {
    expect(serializarClaveValor({ BRAND: "Genérica", GENDER: "" })).toBe("BRAND=Genérica");
  });

  it("sin nada lleno: string vacío", () => {
    expect(serializarClaveValor({})).toBe("");
  });
});

describe("serializarCategoriaOverride — mismo formato 'siteId::título=categoryId' que ya lee nuevo/actions.ts", () => {
  it("arma la clave real", () => {
    expect(serializarCategoriaOverride("MCO", "Reloj Casio Digital", "MCO1234")).toBe("MCO::Reloj Casio Digital=MCO1234");
  });

  it("sin título o sin categoría: string vacío, nunca una clave a medias", () => {
    expect(serializarCategoriaOverride("MCO", "", "MCO1234")).toBe("");
    expect(serializarCategoriaOverride("MCO", "Reloj", "")).toBe("");
  });
});

describe("fotosDentroDelLimite — ADENDO UX de Publicar, punto 5 (respetar max_pictures)", () => {
  it("recorta al límite real de la categoría", () => {
    expect(fotosDentroDelLimite(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
  });

  it("sin límite conocido todavía (null): no recorta nada", () => {
    expect(fotosDentroDelLimite(["a", "b", "c"], null)).toEqual(["a", "b", "c"]);
  });

  it("menos fotos que el límite: se quedan todas", () => {
    expect(fotosDentroDelLimite(["a"], 12)).toEqual(["a"]);
  });
});
