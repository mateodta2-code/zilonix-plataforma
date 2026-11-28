import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECCIONES_PRODUCTOS } from "@/components/productos/secciones";

// Issue #280 — el menú de Productos: solo estas 8 secciones, en este orden.
describe("menú de Productos", () => {
  it("trae las 8 secciones en el orden pedido", () => {
    expect(SECCIONES_PRODUCTOS.map((s) => s.etiqueta)).toEqual([
      "Registro de compras",
      "Inventario",
      "Trazabilidad de inventario",
      "Devoluciones",
      "Inventario Full",
      "Proyección de inventarios",
      "SKU",
      "Crear producto (SKU)",
    ]);
  });

  it("cada sección abre una pantalla que existe", () => {
    for (const s of SECCIONES_PRODUCTOS) {
      const carpeta = join(process.cwd(), "app", ...s.href.split("/").filter(Boolean));
      expect(existsSync(join(carpeta, "page.tsx")), `${s.etiqueta}: ${s.href} no existe`).toBe(true);
    }
  });

  it("Bodegas, Ingresos y Configuración ya no están en el menú (sus pantallas siguen existiendo)", () => {
    const etiquetas = SECCIONES_PRODUCTOS.map((s) => s.etiqueta);
    const hrefs = SECCIONES_PRODUCTOS.map((s) => s.href);
    for (const etiqueta of ["Bodegas", "Ingresos", "Configuración"]) expect(etiquetas).not.toContain(etiqueta);
    for (const href of ["/panel/bodegas", "/panel/inventario/ingresos", "/panel/inventario/configuracion"]) {
      expect(hrefs).not.toContain(href);
      expect(existsSync(join(process.cwd(), "app", ...href.split("/").filter(Boolean), "page.tsx")), href).toBe(true);
    }
  });
});
