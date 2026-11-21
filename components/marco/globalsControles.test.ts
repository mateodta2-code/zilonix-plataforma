import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

describe("globals.css: botón peligro y altura de controles", () => {
  it("--peligro-boton-fondo está definido en tema oscuro y claro", () => {
    const oscuro = css.slice(0, css.indexOf(':root[data-tema="oscuro"]'));
    const claro = css.slice(css.indexOf(':root[data-tema="claro"] {'));
    expect(oscuro).toContain("--peligro-boton-fondo:");
    expect(claro).toContain("--peligro-boton-fondo:");
  });

  it("input/select .zx-control miden --alto-control exacto", () => {
    const m = css.match(/input\.zx-control,\s*select\.zx-control\s*\{([^}]*)\}/);
    expect(m?.[1]).toContain("height: var(--alto-control)");
    expect(m?.[1]).toContain("padding-block: 0");
  });
});
