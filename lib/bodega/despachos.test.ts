import { describe, expect, it } from "vitest";
import { agruparLineas, DespachoBodegaError } from "./despachos";

describe("agruparLineas", () => {
  it("suma los SKU repetidos", () => {
    expect(agruparLineas([{ sku: "A", cantidad: 1 }, { sku: "B", cantidad: 2 }, { sku: " A ", cantidad: 3 }])).toEqual([{ sku: "A", cantidad: 4 }, { sku: "B", cantidad: 2 }]);
  });
  it("rechaza SKU vacío, cantidad inválida y pedido sin líneas", () => {
    expect(() => agruparLineas([{ sku: "", cantidad: 1 }])).toThrow(DespachoBodegaError);
    expect(() => agruparLineas([{ sku: "A", cantidad: 0 }])).toThrow(DespachoBodegaError);
    expect(() => agruparLineas([{ sku: "A", cantidad: 1.5 }])).toThrow(DespachoBodegaError);
    expect(() => agruparLineas([])).toThrow(DespachoBodegaError);
  });
});
