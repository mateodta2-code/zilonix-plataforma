import { describe, expect, it } from "vitest";
import { esModuloIA, IDS_MODULOS_IA, validarModulosIA } from "./modulos";

describe("MODULOS_IA", () => {
  it("incluye los 6 módulos, con generacion_imagenes", () => {
    expect([...IDS_MODULOS_IA]).toEqual(["promociones", "optimizacion", "investigacion", "publicidad", "publicaciones", "generacion_imagenes"]);
  });
  it("valida un módulo", () => {
    expect(esModuloIA("promociones")).toBe(true);
    expect(esModuloIA("inventado")).toBe(false);
    expect(esModuloIA(3)).toBe(false);
  });
  it("valida la lista y quita repetidos", () => {
    expect(validarModulosIA(["promociones", "promociones", "investigacion"])).toEqual(["promociones", "investigacion"]);
    expect(validarModulosIA([])).toEqual([]);
    expect(validarModulosIA(["x"])).toBeNull();
    expect(validarModulosIA("promociones")).toBeNull();
  });
});
