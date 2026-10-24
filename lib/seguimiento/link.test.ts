import { describe, expect, it } from "vitest";
import { interpretarEnlaceProducto, interpretarEnlaceTienda } from "./link";

describe("interpretarEnlaceProducto", () => {
  it("link real de publicación (articulo.mercadolibre.com.co/MCO-...) -> item", () => {
    expect(interpretarEnlaceProducto("https://articulo.mercadolibre.com.co/MCO-1234567890-reloj-_JM")).toEqual({
      recursoMl: "item",
      mlIdExterno: "MCO1234567890",
    });
  });

  it("link de catálogo (.../p/MCOxxxx) -> product", () => {
    expect(interpretarEnlaceProducto("https://www.mercadolibre.com.co/reloj-digital/p/MCO9876543")).toEqual({
      recursoMl: "product",
      mlIdExterno: "MCO9876543",
    });
  });

  it("id de item pegado directo (sin guion) -> item", () => {
    expect(interpretarEnlaceProducto("MCO1234567890")).toEqual({ recursoMl: "item", mlIdExterno: "MCO1234567890" });
  });

  it("con espacios alrededor: se recortan antes de interpretar", () => {
    expect(interpretarEnlaceProducto("  MCO111  ")).toEqual({ recursoMl: "item", mlIdExterno: "MCO111" });
  });

  it("texto que no es ni link ni id reconocible -> null, nunca inventa uno", () => {
    expect(interpretarEnlaceProducto("esto no es un link de Mercado Libre")).toBeNull();
    expect(interpretarEnlaceProducto("")).toBeNull();
  });
});

describe("interpretarEnlaceTienda", () => {
  it("seller_id numérico pegado directo", () => {
    expect(interpretarEnlaceTienda("123456789")).toBe("123456789");
  });

  it("link con _CustId_", () => {
    expect(interpretarEnlaceTienda("https://listado.mercadolibre.com.co/_CustId_123456789_OrderId_SOLD")).toBe("123456789");
  });

  it("con espacios alrededor: se recortan antes de interpretar", () => {
    expect(interpretarEnlaceTienda("  123456789  ")).toBe("123456789");
  });

  it("link con nickname (sin _CustId_ ni id numérico): null, nunca adivina un id", () => {
    expect(interpretarEnlaceTienda("https://www.mercadolibre.com.co/pagina/unatienda")).toBeNull();
  });

  it("texto vacío o irreconocible -> null", () => {
    expect(interpretarEnlaceTienda("")).toBeNull();
    expect(interpretarEnlaceTienda("no es nada")).toBeNull();
  });
});
