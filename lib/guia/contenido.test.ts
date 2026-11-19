import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECCIONES_GUIA as secciones, seccionDeRuta } from "@/lib/guia/contenido";

describe("guía de uso", () => {
  it("cada sección tiene un id único (es el ancla del índice)", () => {
    const ids = secciones.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("cada ruta de una guía es una pantalla que existe", () => {
    for (const s of secciones) {
      for (const ruta of [s.ruta, ...(s.otrasRutas ?? [])]) {
        const carpeta = join(process.cwd(), "app", ...ruta.split("/").filter(Boolean));
        expect(existsSync(join(carpeta, "page.tsx")), `${s.id}: ${ruta} no existe`).toBe(true);
      }
    }
  });

  it("cada pantalla encuentra la guía de su módulo", () => {
    expect(seccionDeRuta("/panel")?.id).toBe("inicio");
    expect(seccionDeRuta("/panel/optimizacion/MCO123")?.id).toBe("optimizacion");
    expect(seccionDeRuta("/panel/investigacion/seguimiento")?.id).toBe("investigacion");
    expect(seccionDeRuta("/panel/sku/importar")?.id).toBe("productos");
    expect(seccionDeRuta("/panel/roles")?.id).toBe("personas");
    expect(seccionDeRuta("/panel/despachos/")?.id).toBe("despachos");
    expect(seccionDeRuta("/panel/publicaciones")).toBeNull(); // no confunde prefijos sin "/"
    expect(seccionDeRuta("/panel/promociones")?.id).toBe("promociones");
    expect(seccionDeRuta("/panel/meta")).toBeNull();
  });

  it("Optimización y Configuración explican cómo conectar la IA", () => {
    for (const id of ["optimizacion", "configuracion"]) {
      const s = secciones.find((x) => x.id === id);
      expect(s?.apartados?.[0].titulo, id).toMatch(/conectar la IA/);
    }
  });

  it("ninguna sección queda vacía", () => {
    for (const s of secciones) {
      expect(s.paraQue.length, s.id).toBeGreaterThan(10);
      expect(s.pasos.length, s.id).toBeGreaterThan(0);
      for (const a of s.apartados ?? []) expect(a.pasos.length, `${s.id}: ${a.titulo}`).toBeGreaterThan(0);
    }
  });
});
