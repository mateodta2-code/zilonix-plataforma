import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

// La API key descifrada solo sale por obtenerConexionIAParaModulo (o
// por probarConexionIA). Ningún archivo fuera de lib/ia/ puede importar
// las funciones «ConClave» de lib/ia/conexion.ts.
const RAIZ = process.cwd();
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (["node_modules", ".next", "dist", "build", ".git"].includes(n)) return [];
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(n) ? [ruta] : [];
  });
}

describe("uso de la key de IA", () => {
  it("nadie fuera de lib/ia/ usa obtenerConexionIAConClave*", () => {
    const infractores = ["app", "lib", "components", "db", "scripts"]
      .flatMap((d) => archivos(join(RAIZ, d)))
      .map((a) => relative(RAIZ, a))
      .filter((r) => !r.startsWith("lib/ia/") && !/\.test\.tsx?$/.test(r))
      .filter((r) => /obtenerConexionIAConClave/.test(readFileSync(join(RAIZ, r), "utf8")));
    expect(infractores).toEqual([]);
  });
  it("obtenerConexionIAConClave (sin sufijo) ya no se exporta", () => {
    expect(readFileSync(join(RAIZ, "lib/ia/conexion.ts"), "utf8")).not.toMatch(/export (async )?function obtenerConexionIAConClave\(/);
  });
});
