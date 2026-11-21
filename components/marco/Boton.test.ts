import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clasesBoton } from "./Boton";

const css = readFileSync(join(__dirname, "Boton.module.css"), "utf8");
const bloque = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";

describe("Boton", () => {
  it("clasesBoton('peligro') incluye la variante peligro", () => {
    expect(clasesBoton("peligro")).toContain("peligro");
  });

  it(".boton usa la altura común de los campos", () => {
    expect(bloque(".boton")).toContain("min-height: var(--alto-control)");
    expect(bloque(".boton")).toContain("box-sizing: border-box");
    expect(bloque(".boton")).toContain("font-size: 13.5px");
  });

  it(".chico ya no achica ni la letra ni el padding vertical", () => {
    const chico = bloque(".chico");
    expect(chico).not.toMatch(/font-size/);
    expect(chico).not.toMatch(/padding/);
  });

  it("ningún box-shadow usa none", () => {
    expect(css).not.toMatch(/box-shadow:\s*[^;]*\bnone\b/);
  });
});
