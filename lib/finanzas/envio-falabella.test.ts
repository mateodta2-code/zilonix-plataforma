import { describe, expect, it } from "vitest";
import { clasificarEnvioFalabella, esProveedorDirecto } from "./envio-falabella";

describe("clasificarEnvioFalabella", () => {
  it("agencia: todos los ítems son Dropshipping o Cross docking", () => {
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: "Dropshipping", proveedor: "Servientrega" }] })).toBe("agencia");
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: "Cross docking" }, { tipoEnvio: "cross_docking" }] })).toBe("agencia");
  });

  it("envío propio: proveedor directo en el ítem o «Pago por envío directo» en el reporte", () => {
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: "Dropshipping", proveedor: "ibisdirecto" }] })).toBe("propio");
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: "Dropshipping", tipoProveedor: "Directo" }] })).toBe("propio");
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: "Dropshipping" }], envioDirectoReporte: true })).toBe("propio");
    expect(esProveedorDirecto({ proveedor: "Servientrega" })).toBe(false);
  });

  it("fulfillment: Own Warehouse o un tipo con «fulfillment»", () => {
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: "Own Warehouse" }] })).toBe("fulfillment");
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: "Dropshipping" }, { tipoEnvio: "Fulfillment" }] })).toBe("fulfillment");
  });

  it("desconocido: sin ítems, sin ShippingType o con un valor que no se reconoce", () => {
    expect(clasificarEnvioFalabella({ items: [] })).toBe("desconocido");
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: null, proveedor: "Servientrega" }] })).toBe("desconocido");
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: "Pickup" }] })).toBe("desconocido");
    // Uno reconocido y otro no: no se asume agencia.
    expect(clasificarEnvioFalabella({ items: [{ tipoEnvio: "Dropshipping" }, { tipoEnvio: "" }] })).toBe("desconocido");
  });
});
