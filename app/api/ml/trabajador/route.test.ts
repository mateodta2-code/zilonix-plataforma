import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { procesarAvisosPendientes } from "@/lib/ml/trabajador";
import { POST } from "./route";

// Fix real (2026-10-21) — esta ruta es pública en el middleware (ver
// lib/rutas-publicas.ts); el secreto compartido es la ÚNICA puerta que
// le queda, así que estas pruebas son las que de verdad prueban que
// sigue cerrada. crypto.timingSafeEqual exige comparar longitudes
// primero (lanza si difieren) — por eso hay un caso de cada longitud.
vi.mock("@/lib/ml/trabajador", () => ({ procesarAvisosPendientes: vi.fn(async () => ({ procesados: 3 })) }));

const SECRETO_REAL = "trabajador-secret-fake-ci-0123456789";

function peticion(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://x.test/api/ml/trabajador", { method: "POST", headers });
}

describe("POST /api/ml/trabajador (fix middleware, 2026-10-21)", () => {
  const envOriginal = process.env.TRABAJADOR_SECRET;
  afterEach(() => {
    process.env.TRABAJADOR_SECRET = envOriginal;
    vi.clearAllMocks();
  });

  it("sin cabecera x-trabajador-secret → 401", async () => {
    process.env.TRABAJADOR_SECRET = SECRETO_REAL;
    const res = await POST(peticion());
    expect(res.status).toBe(401);
  });

  it("secreto de otra longitud → 401 (nunca llega a timingSafeEqual, que lanzaría)", async () => {
    process.env.TRABAJADOR_SECRET = SECRETO_REAL;
    const res = await POST(peticion({ "x-trabajador-secret": "corto" }));
    expect(res.status).toBe(401);
  });

  it("secreto de la misma longitud pero incorrecto → 401", async () => {
    process.env.TRABAJADOR_SECRET = SECRETO_REAL;
    const otroDeIgualLongitud = "x".repeat(SECRETO_REAL.length);
    const res = await POST(peticion({ "x-trabajador-secret": otroDeIgualLongitud }));
    expect(res.status).toBe(401);
  });

  it("secreto correcto → 200 y llama a procesarAvisosPendientes", async () => {
    process.env.TRABAJADOR_SECRET = SECRETO_REAL;
    const res = await POST(peticion({ "x-trabajador-secret": SECRETO_REAL }));
    expect(res.status).toBe(200);
    expect(procesarAvisosPendientes).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body).toEqual({ ok: true, procesados: 3 });
  });

  it("sin TRABAJADOR_SECRET configurado, nunca autentica (cerrado por defecto)", async () => {
    process.env.TRABAJADOR_SECRET = "";
    const res = await POST(peticion({ "x-trabajador-secret": "" }));
    expect(res.status).toBe(401);
  });
});
