import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(path.join(process.cwd(), ruta), "utf8");

describe("filas de filtros responsive (#544, #549)", () => {
  it("globals.css: .zx-fila-controles con gap 12px y align-items flex-end", () => {
    const css = leer("app/globals.css");
    const m = css.match(/\.zx-fila-controles\s*\{[^}]*\}/) ?? [];
    expect(m[0]).toMatch(/gap:\s*12px/);
    expect(m[0]).toMatch(/align-items:\s*flex-end/);
  });

  it("globals.css: bajo 640px .zx-fila-controles pasa a columna", () => {
    const css = leer("app/globals.css");
    const bloques = css.split("@media (max-width: 640px)").slice(1);
    expect(
      bloques.some((b) => /\.zx-fila-controles\s*\{[^}]*flex-direction:\s*column/.test(b)),
    ).toBe(true);
  });

  it("globals.css: input[type=date].zx-control con min-width 0 y max-width 100%", () => {
    const css = leer("app/globals.css");
    const m = css.match(/input\[type="date"\]\.zx-control,[^{]*\{[^}]*\}/) ?? [];
    expect(m[0]).toMatch(/min-width:\s*0/);
    expect(m[0]).toMatch(/max-width:\s*100%/);
  });

  it("globals.css: input.zx-control lleva min-width: 0", () => {
    const css = leer("app/globals.css");
    const m = css.match(/input\.zx-control,\s*select\.zx-control\s*\{[^}]*\}/g) ?? [];
    expect(m.some((b) => /min-width:\s*0/.test(b))).toBe(true);
  });

  it("InicioFinanzas.tsx: el form del período usa zx-fila-controles", () => {
    const tsx = leer("components/finanzas/InicioFinanzas.tsx");
    expect(tsx).toMatch(/styles\.filtro\}\s+zx-fila-controles/);
  });

  it("inicio.module.css: .ayuda en 12px", () => {
    const css = leer("components/finanzas/inicio.module.css");
    const m = css.match(/\.ayuda\s*\{[^}]*\}/) ?? [];
    expect(m[0]).toMatch(/font-size:\s*12px/);
  });
});
