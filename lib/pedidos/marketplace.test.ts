import { describe, expect, it } from "vitest";
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import { formatearMontoEnMoneda, parsearMarketplace, productosDeItemsFalabella, seccionesDeMarketplace } from "./marketplace";

// Issue #422 — filtro de marketplace de /panel/pedidos y armado de la
// fila de Falabella (puro, sin base).

describe("parsearMarketplace (lista blanca)", () => {
  it("acepta solo todos, ml y falabella", () => {
    expect(parsearMarketplace("ml")).toBe("ml");
    expect(parsearMarketplace("falabella")).toBe("falabella");
    expect(parsearMarketplace("todos")).toBe("todos");
  });

  it("cualquier otra cosa (vacío, desconocido, arreglo) cae a todos", () => {
    expect(parsearMarketplace(undefined)).toBe("todos");
    expect(parsearMarketplace("")).toBe("todos");
    expect(parsearMarketplace("amazon")).toBe("todos");
    expect(parsearMarketplace("'; drop table pedidos;--")).toBe("todos");
    expect(parsearMarketplace(["falabella", "ml"])).toBe("falabella");
  });
});

describe("seccionesDeMarketplace", () => {
  it("todos muestra las dos; cada filtro, solo la suya", () => {
    expect(seccionesDeMarketplace("todos")).toEqual({ mercadoLibre: true, falabella: true });
    expect(seccionesDeMarketplace("ml")).toEqual({ mercadoLibre: true, falabella: false });
    expect(seccionesDeMarketplace("falabella")).toEqual({ mercadoLibre: false, falabella: true });
  });
});

describe("formatearMontoEnMoneda", () => {
  it("una moneda de un sitio conocido usa formatearMoneda de ese sitio", () => {
    expect(formatearMontoEnMoneda("78000.00", "COP")).toBe(formatearMoneda(78000, "MCO"));
    expect(formatearMontoEnMoneda("1500.5", "CLP")).toBe(formatearMoneda(1500.5, "MLC"));
  });

  it("una moneda fuera de SITIOS_ML nunca se pinta como COP", () => {
    expect(formatearMontoEnMoneda("120.50", "PEN")).toBe(`${formatearNumero(120.5, undefined)} PEN`);
  });

  it("un total que no es número se muestra como —", () => {
    expect(formatearMontoEnMoneda("abc", "COP")).toBe("—");
  });
});

describe("productosDeItemsFalabella", () => {
  it("saca nombre y SKU de cada línea", () => {
    expect(
      productosDeItemsFalabella([
        { Name: "Lámpara LED", Sku: "LAMP-1", PaidPrice: "1.00" },
        { Name: "Cable USB", Sku: "CAB-2" },
      ])
    ).toEqual([
      { nombre: "Lámpara LED", sku: "LAMP-1" },
      { nombre: "Cable USB", sku: "CAB-2" },
    ]);
  });

  it("no inventa: sin SKU va null, sin nada se omite, JSONB raro da lista vacía", () => {
    expect(productosDeItemsFalabella([{ Name: "Solo nombre" }, {}, null, "texto"])).toEqual([{ nombre: "Solo nombre", sku: null }]);
    expect(productosDeItemsFalabella({ Name: "no es arreglo" })).toEqual([]);
  });
});
