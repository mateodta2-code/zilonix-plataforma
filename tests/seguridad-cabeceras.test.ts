import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config.mjs";

// Issue #556 — auditoría de seguridad: blinda las cabeceras de
// next.config.mjs y las banderas de las cookies de contexto, para que
// una edición futura no las afloje en silencio.
describe("cabeceras de seguridad (next.config.mjs)", () => {
  it("devuelve las 6 cabeceras en /(.*)", async () => {
    const reglas = await nextConfig.headers!();
    const regla = reglas.find((r: { source: string }) => r.source === "/(.*)");
    expect(regla).toBeDefined();
    const mapa = new Map(regla!.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    for (const clave of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(mapa.has(clave), clave).toBe(true);
    }
    expect(mapa.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mapa.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(mapa.get("Strict-Transport-Security")).toContain("max-age=");
    expect(String(mapa.get("Content-Security-Policy"))).toContain("default-src 'self'");
    expect(String(mapa.get("Content-Security-Policy"))).toContain("frame-ancestors 'self'");
  });
});

describe("cookies de contexto (empresa_actual y bodega)", () => {
  const archivos = [
    "app/crear-empresa/actions.ts",
    "app/invitacion/[token]/actions.ts",
    "app/invitacion-bodega/[token]/actions.ts",
    "app/panel/actions.ts",
  ];
  for (const archivo of archivos) {
    it(`${archivo} lleva httpOnly y secure en producción`, () => {
      const fuente = readFileSync(archivo, "utf8");
      const llamadas = fuente.match(/cookies\(\)\.set\([^;]*\);/g) ?? [];
      expect(llamadas.length).toBeGreaterThan(0);
      for (const llamada of llamadas) {
        expect(llamada).toContain("httpOnly: true");
        expect(llamada).toContain('secure: process.env.NODE_ENV === "production"');
        expect(llamada).toContain('sameSite: "lax"');
      }
    });
  }
});
