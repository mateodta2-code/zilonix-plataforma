import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { RUTA_COOKIE_SUPERADMIN } from "../lib/superadmin-sesion";

// Bug real (25-nov): la ruta de capturas de tickets del superadmin vivía en
// /api/superadmin/... y la cookie zx_superadmin tiene Path=/superadmin: el
// navegador no la mandaba, la ruta veía «sin sesión» y mandaba al login. Toda
// ruta que pida requiereSesionSuperadmin() tiene que vivir bajo /superadmin.
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [ruta] : [];
  });
}

describe("la sesión del superadmin solo existe bajo su Path", () => {
  it("la cookie es de /superadmin", () => {
    expect(RUTA_COOKIE_SUPERADMIN).toBe("/superadmin");
  });

  it("ninguna ruta de app/api pide la sesión del superadmin", () => {
    const culpables = archivos(join(process.cwd(), "app", "api")).filter((f) => /requiereSesionSuperadmin\s*\(/.test(readFileSync(f, "utf8")));
    expect(culpables, "muévela bajo app/superadmin/: la cookie zx_superadmin no llega a /api").toEqual([]);
  });
});
