import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { esRutaPublica } from "./rutas-publicas";

// Fix real (2026-10-21) — esta lista es la que decide si el middleware
// exige sesión de Clerk o no. Cada caso de acá es una ruta real que de
// verdad importa clasificar bien: las de máquina tenían que volverse
// públicas (eran justo las que colgaban 30s y daban 500 — ver
// rutas-publicas.ts), y las de negocio/sesión tienen que seguir
// cerradas, sin excepción.
function peticion(path: string): NextRequest {
  return new NextRequest(`https://staging.zilonix.test${path}`);
}

describe("esRutaPublica (fix middleware, 2026-10-21)", () => {
  it("las rutas de máquina son públicas — webhook, trabajador, callback de OAuth", () => {
    expect(esRutaPublica(peticion("/api/ml/webhooks"))).toBe(true);
    expect(esRutaPublica(peticion("/api/ml/trabajador"))).toBe(true);
    expect(esRutaPublica(peticion("/api/ml/callback"))).toBe(true);
  });

  it("las rutas públicas de siempre (login, versión, invitación) siguen públicas", () => {
    expect(esRutaPublica(peticion("/"))).toBe(true);
    expect(esRutaPublica(peticion("/api/version"))).toBe(true);
    expect(esRutaPublica(peticion("/sign-in"))).toBe(true);
    expect(esRutaPublica(peticion("/sign-up"))).toBe(true);
    expect(esRutaPublica(peticion("/invitacion/un-token-cualquiera"))).toBe(true);
  });

  it("las rutas de negocio con datos reales de una empresa NUNCA son públicas", () => {
    expect(esRutaPublica(peticion("/panel"))).toBe(false);
    expect(esRutaPublica(peticion("/superadmin"))).toBe(false);
    expect(esRutaPublica(peticion("/cuenta"))).toBe(false);
    expect(esRutaPublica(peticion("/api/ml/conectar"))).toBe(false);
    expect(esRutaPublica(peticion("/api/ml/despachos/etiquetas"))).toBe(false);
  });
});
