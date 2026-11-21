import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(path.join(process.cwd(), ruta), "utf8");

describe("filas de filtros responsive (#544)", () => {
  it("inicio.module.css: .filtro pasa a columna bajo 640px", () => {
    const css = leer("components/finanzas/inicio.module.css");
    const bloques = css.split("@media (max-width: 640px)").slice(1);
    const hay = bloques.some((b) =>
      /\.filtro\s*\{[^}]*flex-direction:\s*column/.test(b),
    );
    expect(hay).toBe(true);
  });

  it("globals.css: input.zx-control lleva min-width: 0", () => {
    const css = leer("app/globals.css");
    const m = css.match(/input\.zx-control,\s*select\.zx-control\s*\{[^}]*\}/g) ?? [];
    expect(m.some((b) => /min-width:\s*0/.test(b))).toBe(true);
  });
});
