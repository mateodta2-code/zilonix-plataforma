import { afterEach, describe, expect, it, vi } from "vitest";
import { costosDeItem } from "./costos-item";

function respuesta(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

const itemBase = {
  category_id: "MCO123",
  listing_type_id: "gold_special",
  seller_custom_field: null,
  shipping: { logistic_type: "fulfillment", mode: "me2", free_shipping: true },
  tags: [],
  attributes: [{ id: "SELLER_SKU", value_name: "SKU-1" }],
};

describe("costos por ítem (issue #254)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("manda logistic_type y shipping_mode a listing_prices y marca el envío como dato de la cotización", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/sale_price")) return respuesta({ amount: 3992.0, regular_amount: 4500 });
      if (String(url).includes("/listing_prices")) {
        return respuesta([
          {
            listing_type_id: "gold_special",
            sale_fee_amount: 519.0,
            sale_fee_details: { percentage_fee: 13, fixed_fee: 0, gross_amount: 3992, financing_add_on_fee: 0 },
          },
        ]);
      }
      if (String(url).includes("/shipping_options/free")) return respuesta({ coverage: { all_country: { list_cost: 8900 } } });
      return respuesta(itemBase);
    });
    vi.stubGlobal("fetch", fetchMock);

    const costo = await costosDeItem({ token: "token-prueba", userId: "998877", itemId: "MCO12345" });

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    const comision = urls.find((url) => url.includes("/listing_prices"));
    expect(comision).toContain("logistic_type=fulfillment");
    expect(comision).toContain("shipping_mode=me2");
    expect(comision).toContain("currency_id=COP");
    expect(comision).toContain("/sites/MCO/listing_prices");
    expect(urls.find((url) => url.includes("/sale_price"))).toContain("context=channel_marketplace");
    expect(urls.every((url) => !url.includes("/shipments/"))).toBe(true);

    expect(costo.skuCodigo).toBe("SKU-1");
    expect(costo.precioVentaVigente).toBe("3992.00");
    expect(costo.comisionMl).toBe("519.00");
    expect(costo.comisionDetalle).toMatchObject({ percentage_fee: 13, fixed_fee: 0 });
    expect(costo.compradorPagaEnvio).toBe(false);
    expect(costo.envioVendedorEstimado).toBe("8900.00");
    expect(costo.envioEsEstimado).toBe(true);
  });

  it("si el comprador paga el envío, el costo del vendedor queda en 0 y no se cotiza", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/sale_price")) return respuesta({ amount: 10000, regular_amount: null });
      if (String(url).includes("/listing_prices")) return respuesta([{ listing_type_id: "gold_special", sale_fee_amount: 100, sale_fee_details: {} }]);
      return respuesta({ ...itemBase, shipping: { logistic_type: "drop_off", mode: "me1", free_shipping: false } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const costo = await costosDeItem({ token: "token-prueba", userId: "998877", itemId: "MCO12345" });
    expect(costo.compradorPagaEnvio).toBe(true);
    expect(costo.envioVendedorEstimado).toBe("0.00");
    expect(costo.envioEsEstimado).toBe(false);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("shipping_options"))).toBe(false);
  });

  it("un decimal largo se redondea y un texto inválido deja null solo ese campo", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/sale_price")) return respuesta({ amount: 0.5714285714285714, regular_amount: "no-es-numero" });
      if (String(url).includes("/listing_prices")) {
        return respuesta([{ listing_type_id: "gold_special", sale_fee_amount: 10.129, sale_fee_details: {} }]);
      }
      return respuesta({ ...itemBase, shipping: { logistic_type: "drop_off", mode: "me1", free_shipping: false } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const costo = await costosDeItem({ token: "token-prueba", userId: "998877", itemId: "MCO12345" });
    expect(costo.precioVentaVigente).toBe("0.57");
    expect(costo.precioRegular).toBeNull();
    expect(costo.comisionMl).toBe("10.13");
    expect(costo.envioVendedorEstimado).toBe("0.00");
  });

  it("sin logistic_type no llama a listing_prices", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/sale_price")) return respuesta({ amount: 1000, regular_amount: 1000 });
      return respuesta({ ...itemBase, shipping: { mode: "me2", free_shipping: false } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const costo = await costosDeItem({ token: "token-prueba", userId: "998877", itemId: "MCO12345" });
    expect(costo.comisionMl).toBeNull();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("listing_prices"))).toBe(false);
  });
});
