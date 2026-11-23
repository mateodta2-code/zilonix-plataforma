import { describe, expect, it } from "vitest";
import { proveedorGeneraImagenes } from "./imagen";
import type { ProveedorIA } from "./tipos";
import { moduloAdmiteProveedor, MODULOS_IA, esModuloIA, IDS_MODULOS_IA, validarModulosIA } from "./modulos";

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

describe("moduloAdmiteProveedor", () => {
  const todos: ProveedorIA[] = ["anthropic", "openai", "google", "xai", "otro_compatible_openai"];
  it("imágenes solo con los proveedores que las generan (igual que imagen.ts)", () => {
    for (const p of todos) expect(moduloAdmiteProveedor("generacion_imagenes", p)).toBe(proveedorGeneraImagenes(p));
    expect(moduloAdmiteProveedor("generacion_imagenes", "anthropic")).toBe(false);
  });
  it("los demás módulos admiten cualquier proveedor", () => {
    for (const p of todos) expect(moduloAdmiteProveedor("promociones", p)).toBe(true);
  });
  it("publicidad es próximamente", () => {
    expect((MODULOS_IA.find((m) => m.id === "publicidad") as { proximamente?: boolean }).proximamente).toBe(true);
  });
});
