import { describe, expect, it } from "vitest";
import { leerProducto } from "./producto";

describe("leerProducto", () => {
  it("lee url, QC, publicado y precios", () => {
    const p = leerProducto(
      { Products: { Product: { SellerSku: "A1", Url: "https://www.falabella.com.co/x", QCStatus: "approved", BusinessUnits: { BusinessUnit: { OperatorCode: "faco", IsPublished: "1", Status: "active", Stock: "5", Price: "60000.00", SalePrice: "37900" } } } } },
      "A1"
    );
    expect(p).toEqual({ url: "https://www.falabella.com.co/x", qcStatus: "approved", publicado: true, estadoVenta: "active", stock: 5, precio: 60000, precioOferta: 37900 });
  });
  it("sin productos devuelve null", () => {
    expect(leerProducto({ Products: "" }, "A1")).toBeNull();
    expect(leerProducto(null, "A1")).toBeNull();
  });
});
