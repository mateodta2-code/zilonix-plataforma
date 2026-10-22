import { describe, expect, it } from "vitest";
import { esConsumible } from "./consumibles";

describe("esConsumible", () => {
  it("un dominio de Mercado Libre que regula el INVIMA es consumible, sin ninguna configuración", () => {
    expect(esConsumible("MCO-DIETARY_SUPPLEMENTS", "SKU-CUALQUIERA")).toBe(true);
  });

  it("un dominio que no regula el INVIMA y sin prefijo configurado no es consumible", () => {
    expect(esConsumible("MCO-CELLPHONES", "SKU-CUALQUIERA")).toBe(false);
  });

  it("sin configuración (valor por defecto vacío), un prefijo de SKU propio de una empresa NO se reconoce solo", () => {
    expect(esConsumible("MCO-CELLPHONES", "UNM-PROTEINA-001")).toBe(false);
  });

  it("con prefijosSkuConsumibles configurado, un SKU con ese prefijo es consumible aunque el dominio no sea de INVIMA", () => {
    expect(esConsumible("MCO-CELLPHONES", "UNM-PROTEINA-001", { prefijosSkuConsumibles: ["UNM", "VITAL"] })).toBe(true);
  });

  it("la comparación del prefijo configurado no distingue mayúsculas/minúsculas", () => {
    expect(esConsumible(null, "unm-proteina-001", { prefijosSkuConsumibles: ["UNM"] })).toBe(true);
  });

  it("un prefijo configurado que no coincide con el SKU no lo hace consumible", () => {
    expect(esConsumible(null, "OTRA-MARCA-001", { prefijosSkuConsumibles: ["UNM", "VITAL"] })).toBe(false);
  });

  it("nunca revienta con dominio/sku null o undefined", () => {
    expect(esConsumible(null, null)).toBe(false);
    expect(esConsumible(undefined, undefined, {})).toBe(false);
  });
});
