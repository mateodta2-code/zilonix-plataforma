import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { generarMatrizMarkdown } from "./matriz-permisos";

// Tarea 1.8 — "la tabla de roles × módulos generada automáticamente
// en docs/ coincide con la que aprobaste". No necesita Postgres: es
// comparar texto, corre en el paso `npm test` normal del CI.
describe("docs/matriz-permisos.md coincide con lib/roles.ts", () => {
  it("el archivo committeado es exactamente lo que generaría npm run docs:permisos ahora mismo", () => {
    const committeado = readFileSync(join(process.cwd(), "docs", "matriz-permisos.md"), "utf8");
    expect(committeado).toBe(generarMatrizMarkdown());
  });
});
