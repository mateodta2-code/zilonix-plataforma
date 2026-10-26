import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trabajos/sincronizarPublicidad", () => ({
  sincronizarPublicidadProgramada: vi.fn(),
}));

import { sincronizarPublicidadProgramada } from "@/lib/trabajos/sincronizarPublicidad";
import { POST } from "./route";

const SECRETO_ORIGINAL = {
  PUBLICIDAD_TRABAJADOR_SECRET: process.env.PUBLICIDAD_TRABAJADOR_SECRET,
  DATABASE_URL_PUBLICIDAD: process.env.DATABASE_URL_PUBLICIDAD,
};

function restaurarEnv() {
  for (const [clave, valor] of Object.entries(SECRETO_ORIGINAL)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
}

function peticion(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://staging.test/api/trabajos/publicidad", { method: "POST", headers });
}

describe("POST /api/trabajos/publicidad (issue #254)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PUBLICIDAD_TRABAJADOR_SECRET;
    delete process.env.DATABASE_URL_PUBLICIDAD;
  });

  afterEach(() => restaurarEnv());

  it("sin PUBLICIDAD_TRABAJADOR_SECRET: 503, y no corre el trabajo", async () => {
    const res = await POST(peticion({ "x-publicidad-trabajador-secret": "lo-que-sea" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/PUBLICIDAD_TRABAJADOR_SECRET/);
    expect(sincronizarPublicidadProgramada).not.toHaveBeenCalled();
  });

  it("secreto que no coincide, o header ausente: 401", async () => {
    process.env.PUBLICIDAD_TRABAJADOR_SECRET = "secreto-real";
    expect((await POST(peticion({ "x-publicidad-trabajador-secret": "otro-valor" }))).status).toBe(401);
    expect((await POST(peticion())).status).toBe(401);
    expect(sincronizarPublicidadProgramada).not.toHaveBeenCalled();
  });

  it("secreto correcto pero sin DATABASE_URL_PUBLICIDAD: 503", async () => {
    process.env.PUBLICIDAD_TRABAJADOR_SECRET = "secreto-real";
    const res = await POST(peticion({ "x-publicidad-trabajador-secret": "secreto-real" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/DATABASE_URL_PUBLICIDAD/);
    expect(sincronizarPublicidadProgramada).not.toHaveBeenCalled();
  });

  it("secreto correcto y variables presentes: corre la sincronización", async () => {
    process.env.PUBLICIDAD_TRABAJADOR_SECRET = "secreto-real";
    process.env.DATABASE_URL_PUBLICIDAD = "postgres://lo-que-sea";
    vi.mocked(sincronizarPublicidadProgramada).mockResolvedValue({ revisadas: 2, procesadas: 1, saltadas: 1, fallidas: 0 });

    const res = await POST(peticion({ "x-publicidad-trabajador-secret": "secreto-real" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revisadas: 2, procesadas: 1, saltadas: 1, fallidas: 0 });
  });

  it("un fallo al correr: 503 genérico, sin el detalle crudo", async () => {
    process.env.PUBLICIDAD_TRABAJADOR_SECRET = "secreto-real";
    process.env.DATABASE_URL_PUBLICIDAD = "postgres://lo-que-sea";
    vi.mocked(sincronizarPublicidadProgramada).mockRejectedValue(new Error("postgres://secreto-en-el-error"));

    const res = await POST(peticion({ "x-publicidad-trabajador-secret": "secreto-real" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).not.toMatch(/postgres:\/\//);
    expect(JSON.stringify(body)).not.toMatch(/secreto-en-el-error/);
  });
});
