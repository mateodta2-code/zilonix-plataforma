import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trabajos/sincronizarFalabella", () => ({
  sincronizarFalabellaProgramada: vi.fn(),
  errorSeguro: (e: unknown) => String(e),
}));

import { sincronizarFalabellaProgramada } from "@/lib/trabajos/sincronizarFalabella";
import { POST } from "./route";

const ENV_ORIGINAL = {
  FALABELLA_TRABAJADOR_SECRET: process.env.FALABELLA_TRABAJADOR_SECRET,
  DATABASE_URL_FALABELLA: process.env.DATABASE_URL_FALABELLA,
};

function restaurarEnv() {
  for (const [clave, valor] of Object.entries(ENV_ORIGINAL)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
}

function peticion(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://staging.test/api/trabajos/falabella", { method: "POST", headers });
}

describe("POST /api/trabajos/falabella (issue #422)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FALABELLA_TRABAJADOR_SECRET;
    delete process.env.DATABASE_URL_FALABELLA;
  });

  afterEach(() => restaurarEnv());

  it("sin FALABELLA_TRABAJADOR_SECRET en el ambiente: 503, y no corre el trabajo", async () => {
    const res = await POST(peticion({ "x-falabella-trabajador-secret": "lo-que-sea" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/FALABELLA_TRABAJADOR_SECRET/);
    expect(sincronizarFalabellaProgramada).not.toHaveBeenCalled();
  });

  it("sin secreto en la cabecera: 401", async () => {
    process.env.FALABELLA_TRABAJADOR_SECRET = "secreto-de-prueba";
    const res = await POST(peticion());
    expect(res.status).toBe(401);
    expect(sincronizarFalabellaProgramada).not.toHaveBeenCalled();
  });

  it("secreto inválido (mismo largo o distinto): 401", async () => {
    process.env.FALABELLA_TRABAJADOR_SECRET = "secreto-de-prueba";
    expect((await POST(peticion({ "x-falabella-trabajador-secret": "secreto-de-prueBA" }))).status).toBe(401);
    expect((await POST(peticion({ "x-falabella-trabajador-secret": "otro" }))).status).toBe(401);
    expect(sincronizarFalabellaProgramada).not.toHaveBeenCalled();
  });

  it("secreto correcto pero sin DATABASE_URL_FALABELLA: 503", async () => {
    process.env.FALABELLA_TRABAJADOR_SECRET = "secreto-de-prueba";
    const res = await POST(peticion({ "x-falabella-trabajador-secret": "secreto-de-prueba" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/DATABASE_URL_FALABELLA/);
    expect(sincronizarFalabellaProgramada).not.toHaveBeenCalled();
  });

  it("secreto correcto: corre y devuelve el resumen por cuenta", async () => {
    process.env.FALABELLA_TRABAJADOR_SECRET = "secreto-de-prueba";
    process.env.DATABASE_URL_FALABELLA = "postgres://lo-que-sea";
    const resumen = {
      desde: "2026-11-21T12:00:00.000Z",
      revisadas: 2,
      correctas: 1,
      fallidas: 1,
      cuentas: [
        { cuentaId: "c1", ok: true as const, importados: 4, truncado: false },
        { cuentaId: "c2", ok: false as const, error: "Error" },
      ],
    };
    vi.mocked(sincronizarFalabellaProgramada).mockResolvedValue(resumen);

    const res = await POST(peticion({ "x-falabella-trabajador-secret": "secreto-de-prueba" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...resumen });
  });

  it("si el trabajo revienta entero: 503 sin el error crudo", async () => {
    process.env.FALABELLA_TRABAJADOR_SECRET = "secreto-de-prueba";
    process.env.DATABASE_URL_FALABELLA = "postgres://lo-que-sea";
    vi.mocked(sincronizarFalabellaProgramada).mockRejectedValue(new Error("detalle interno"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(peticion({ "x-falabella-trabajador-secret": "secreto-de-prueba" }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/detalle interno/);
  });
});
