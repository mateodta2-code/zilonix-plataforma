import { describe, expect, it } from "vitest";
import {
  construirLinkMlDeSeguimiento,
  esLinkDeTienda,
  esLinkTiendaOficialSinIdDeVendedor,
  interpretarEnlaceProducto,
  interpretarEnlaceTienda,
} from "./link";

// Issue #192 — bug real: una tienda oficial real de Mercado Libre.
const LINK_TIENDA_OFICIAL_SIN_SELLER =
  "https://www.mercadolibre.com.co/tienda/colchones-relax?item_id=MCO1657640131&category_id=MCO1574&official_store_id=53573&client=recoview-selleritems&recos_listing=true";

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

  // Issue #192, bug real: un link de tienda oficial trae "item_id=MCOxxx"
  // en el query — antes se interpretaba como si fuera el link de ESA
  // publicación, nunca el de la tienda que la persona quería seguir.
  it("link claramente de tienda (.../tienda/...) -> null, nunca el item_id del query", () => {
    expect(interpretarEnlaceProducto(LINK_TIENDA_OFICIAL_SIN_SELLER)).toBeNull();
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

  // Issue #193 — un link de nickname SÍ puede traer el seller_id real
  // como parámetro de query (ej. al llegar desde la ficha de un
  // producto de esa tienda) — caso real reportado.
  it("link de nickname con ?seller_id= en el query", () => {
    expect(interpretarEnlaceTienda("https://www.mercadolibre.com.co/pagina/tiendamercadomax?seller_id=456866397&item_id=MCO3981213688")).toBe(
      "456866397"
    );
  });

  // Issue #192/#193 — "?CustId=" como parámetro de query, no solo
  // "_CustId_" en el path (misma forma que ya reconoce la extensión,
  // extraerCustIdDeUrl en extension/lectores/mercadolibre.js, #188).
  it("link con ?CustId= como parámetro de query", () => {
    expect(interpretarEnlaceTienda("https://listado.mercadolibre.com.co/vendedor?CustId=123456789")).toBe("123456789");
    expect(interpretarEnlaceTienda("https://listado.mercadolibre.com.co/vendedor?algo=x&CustId=123456789")).toBe("123456789");
  });

  // Issue #192, bug real: official_store_id es el id de la TIENDA
  // OFICIAL, no el seller_id — nunca se adivina que son el mismo
  // número, aunque la URL no traiga ningún otro id reconocible.
  it("link de tienda oficial con official_store_id pero sin seller/CustId -> null, nunca adivina", () => {
    expect(interpretarEnlaceTienda(LINK_TIENDA_OFICIAL_SIN_SELLER)).toBeNull();
  });
});

describe("esLinkDeTienda (issue #192)", () => {
  it("reconoce las mismas formas que interpretarEnlaceTienda, más /tienda/ y tienda.mercadolibre", () => {
    expect(esLinkDeTienda(LINK_TIENDA_OFICIAL_SIN_SELLER)).toBe(true);
    expect(esLinkDeTienda("https://tienda.mercadolibre.com.co/alguna-tienda")).toBe(true);
    expect(esLinkDeTienda("https://www.mercadolibre.com.co/perfil/unatienda")).toBe(false); // /perfil/ no es "/tienda/" — fuera de alcance de esta función a propósito
    expect(esLinkDeTienda("https://listado.mercadolibre.com.co/_CustId_123456789_OrderId_SOLD")).toBe(true);
    expect(esLinkDeTienda("https://listado.mercadolibre.com.co/vendedor?CustId=123456789")).toBe(true);
  });

  it("un link real de producto nunca se reconoce como tienda", () => {
    expect(esLinkDeTienda("https://articulo.mercadolibre.com.co/MCO-1234567890-reloj-_JM")).toBe(false);
    expect(esLinkDeTienda("https://www.mercadolibre.com.co/reloj-digital/p/MCO9876543")).toBe(false);
  });
});

describe("esLinkTiendaOficialSinIdDeVendedor (issue #192)", () => {
  it("el link real del bug: /tienda/ + official_store_id, sin seller ni CustId -> true", () => {
    expect(esLinkTiendaOficialSinIdDeVendedor(LINK_TIENDA_OFICIAL_SIN_SELLER)).toBe(true);
  });

  it("el mismo link, pero CON CustId -> false (ya se puede resolver un id real)", () => {
    expect(esLinkTiendaOficialSinIdDeVendedor(`${LINK_TIENDA_OFICIAL_SIN_SELLER}&CustId=99999999`)).toBe(false);
  });

  it("una tienda sin official_store_id (ej. nickname) -> false, cae en el mensaje genérico", () => {
    expect(esLinkTiendaOficialSinIdDeVendedor("https://www.mercadolibre.com.co/pagina/unatienda")).toBe(false);
  });

  it("un link que no es de tienda -> false", () => {
    expect(esLinkTiendaOficialSinIdDeVendedor("esto no es un link de Mercado Libre")).toBe(false);
  });

  // Issue #193 — seller_id= también cuenta como "es tienda" para
  // PATRON_LINK_TIENDA (ver link.ts), pero ACÁ ya resuelve un id real
  // -> false, nunca el mensaje de "official_store_id sin resolver".
  it("un link con ?seller_id= resuelto -> false (no es el caso de official_store_id sin id)", () => {
    expect(esLinkTiendaOficialSinIdDeVendedor("https://www.mercadolibre.com.co/pagina/tiendamercadomax?seller_id=456866397&item_id=MCO3981213688")).toBe(
      false
    );
  });
});

describe("construirLinkMlDeSeguimiento (issue #195)", () => {
  it("item -> articulo.mercadolibre.com.co/<id>", () => {
    expect(construirLinkMlDeSeguimiento("item", "MCO123456789")).toBe("https://articulo.mercadolibre.com.co/MCO123456789");
  });

  it("product (catálogo) -> www.mercadolibre.com.co/p/<id>", () => {
    expect(construirLinkMlDeSeguimiento("product", "MCO123456789")).toBe("https://www.mercadolibre.com.co/p/MCO123456789");
  });

  it("seller -> listado.mercadolibre.com.co/_CustId_<id> (misma forma confirmada que interpretarEnlaceTienda)", () => {
    expect(construirLinkMlDeSeguimiento("seller", "456866397")).toBe("https://listado.mercadolibre.com.co/_CustId_456866397");
  });
});
