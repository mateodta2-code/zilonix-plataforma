import { describe, expect, it } from "vitest";
import { formaEntregaDeLogistica, montoDeJson, publicacionesDesdeItemsMl, ventaDesdeMl, type OrdenMl } from "./venta-ml";

// Issue #130 (Z-FIN-08) — lectura de la respuesta de ML, sin base ni red.

const ORDEN: OrdenMl = {
  id: 2000001,
  date_created: "2026-10-20T10:00:00.000-05:00",
  status: "paid",
  total_amount: 120000,
  currency_id: "COP",
  pack_id: 3000009,
  shipping: { id: 44001 },
  payments: [
    { status: "approved", date_approved: "2026-10-20T12:00:00.000-05:00", transaction_amount: 120000, transaction_amount_refunded: 30000, marketplace_fee: 15600.5 },
    { status: "rejected", date_approved: null, transaction_amount: 120000, marketplace_fee: 999 },
  ],
  order_items: [
    { item: { id: "MCO111", title: "Aspiradora", seller_sku: " ful-inf-01 " }, quantity: 2, unit_price: 40000 },
    { item: { id: "MCO222", title: "Filtro", seller_sku: "" }, quantity: 1, unit_price: 40000 },
  ],
};

describe("ventaDesdeMl (issue #130)", () => {
  it("valor sin restar reembolsos, reembolsos aparte, comisión de pagos aprobados y SKU de respaldo", () => {
    const venta = ventaDesdeMl(
      ORDEN,
      { logistic_type: "cross_docking", status_history: { date_shipped: "2026-10-21T09:00:00.000-05:00", date_delivered: null } },
      { senders: [{ cost: 8900 }, { cost: 100.25 }] },
      new Map([["MCO222", { imagenUrl: "https://http2.mlstatic.com/D_222.jpg", sellerSku: "FIL-9" }]])
    );
    expect(venta).toMatchObject({
      pedidoIdExterno: "2000001",
      formaEntrega: "agencia",
      valorVenta: "120000.00",
      reembolsos: "30000.00",
      comisionMl: "15600.50",
      fleteMl: "9000.25",
      cancelada: false,
      shipmentIdExterno: "44001",
      packIdExterno: "3000009",
      fechaEntrega: null,
    });
    expect(venta.fechaDespacho?.toISOString()).toBe("2026-10-21T14:00:00.000Z");
    expect(venta.fechaPagoAprobado?.toISOString()).toBe("2026-10-20T17:00:00.000Z");
    expect(venta.lineas).toEqual([
      { itemIdExterno: "MCO111", skuCodigo: "ful-inf-01", cantidad: 2, precioUnitario: "40000.00", titulo: "Aspiradora", imagenUrl: null },
      { itemIdExterno: "MCO222", skuCodigo: "FIL-9", cantidad: 1, precioUnitario: "40000.00", titulo: "Filtro", imagenUrl: "https://http2.mlstatic.com/D_222.jpg" },
    ]);
  });

  it("reembolso total marca la venta cancelada; Flex lleva flete ML $0", () => {
    const reembolsada: OrdenMl = { ...ORDEN, payments: [{ status: "refunded", transaction_amount: 120000, transaction_amount_refunded: 120000, marketplace_fee: 0 }] };
    const venta = ventaDesdeMl(reembolsada, { logistic_type: "self_service" }, { senders: [{ cost: 5000 }] }, new Map());
    expect(venta).toMatchObject({ cancelada: true, valorVenta: "120000.00", reembolsos: "120000.00", formaEntrega: "flex", fleteMl: "0.00" });
  });

  it("la forma de entrega sale de la logística de ML, nunca del SKU", () => {
    expect(formaEntregaDeLogistica("fulfillment")).toBe("full_ml");
    expect(formaEntregaDeLogistica("self_service")).toBe("flex");
    expect(["cross_docking", "xd_drop_off", "drop_off"].map(formaEntregaDeLogistica)).toEqual(["agencia", "agencia", "agencia"]);
    expect(formaEntregaDeLogistica("otra_cosa")).toBe("desconocida");
    expect(formaEntregaDeLogistica(null)).toBe("desconocida");
  });

  it("montos de JSON a texto con 2 decimales, sin float", () => {
    expect(montoDeJson(0.1)).toBe("0.10");
    expect(montoDeJson(1234.565)).toBe("1234.57");
    expect(montoDeJson(50000)).toBe("50000.00");
    expect(montoDeJson(null)).toBeNull();
  });

  it("miniatura: secure_thumbnail, si no thumbnail; sin foto queda vacía", () => {
    const mapa = publicacionesDesdeItemsMl([
      { code: 200, body: { id: "MCO1", secure_thumbnail: "https://a/1.jpg", thumbnail: "http://a/1.jpg", attributes: [{ id: "SELLER_SKU", value_name: "A-1" }] } },
      { code: 200, body: { id: "MCO2", thumbnail: "http://a/2.jpg" } },
      { code: 200, body: { id: "MCO3" } },
      { code: 404, body: { id: "MCO4" } },
    ]);
    expect(mapa.get("MCO1")).toEqual({ imagenUrl: "https://a/1.jpg", sellerSku: "A-1" });
    expect(mapa.get("MCO2")).toEqual({ imagenUrl: "http://a/2.jpg", sellerSku: null });
    expect(mapa.get("MCO3")).toEqual({ imagenUrl: null, sellerSku: null });
    expect(mapa.has("MCO4")).toBe(false);
  });
});
