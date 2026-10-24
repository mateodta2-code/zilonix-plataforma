import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #175 — mockea lib/trabajos/revisionDiariaSeguimiento.ts por
// completo: esta ruta solo valida el secreto y las variables de
// entorno, nunca corre el trabajo real contra Postgres en esta prueba
// (eso ya lo prueba lib/trabajos/revisionDiariaSeguimiento.test.ts).
vi.mock("@/lib/trabajos/revisionDiariaSeguimiento", () => ({
  revisarSeguimientosDelDia: vi.fn(),
}));

import { revisarSeguimientosDelDia } from "@/lib/trabajos/revisionDiariaSeguimiento";
import { POST } from "./route";

const SECRETO_ORIGINAL = {
  SEGUIMIENTO_TRABAJADOR_SECRET: process.env.SEGUIMIENTO_TRABAJADOR_SECRET,
  DATABASE_URL_SEGUIMIENTO: process.env.DATABASE_URL_SEGUIMIENTO,
};

function restaurarEnv() {
  for (const [clave, valor] of Object.entries(SECRETO_ORIGINAL)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
}

function peticion(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://staging.test/api/trabajos/seguimiento", { method: "POST", headers });
}

describe("POST /api/trabajos/seguimiento (issue #175)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SEGUIMIENTO_TRABAJADOR_SECRET;
    delete process.env.DATABASE_URL_SEGUIMIENTO;
  });

  afterEach(() => restaurarEnv());

  it("sin SEGUIMIENTO_TRABAJADOR_SECRET configurado: 503 con mensaje claro, nunca revienta el proceso", async () => {
    const res = await POST(peticion({ "x-seguimiento-trabajador-secret": "lo-que-sea" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/SEGUIMIENTO_TRABAJADOR_SECRET/);
    expect(revisarSeguimientosDelDia).not.toHaveBeenCalled();
  });

  it("secreto configurado pero no coincide (o falta el header): 401, nunca 503", async () => {
    process.env.SEGUIMIENTO_TRABAJADOR_SECRET = "secreto-real";
    const res1 = await POST(peticion({ "x-seguimiento-trabajador-secret": "otro-valor" }));
    expect(res1.status).toBe(401);
    const res2 = await POST(peticion());
    expect(res2.status).toBe(401);
    expect(revisarSeguimientosDelDia).not.toHaveBeenCalled();
  });

  it("secreto correcto pero sin DATABASE_URL_SEGUIMIENTO: 503 con mensaje claro", async () => {
    process.env.SEGUIMIENTO_TRABAJADOR_SECRET = "secreto-real";
    const res = await POST(peticion({ "x-seguimiento-trabajador-secret": "secreto-real" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/DATABASE_URL_SEGUIMIENTO/);
    expect(revisarSeguimientosDelDia).not.toHaveBeenCalled();
  });

  it("secreto correcto y variables presentes: corre la revisión y devuelve el resultado", async () => {
    process.env.SEGUIMIENTO_TRABAJADOR_SECRET = "secreto-real";
    process.env.DATABASE_URL_SEGUIMIENTO = "postgres://lo-que-sea";
    vi.mocked(revisarSeguimientosDelDia).mockResolvedValue({ activos: 3, procesados: 3, saltados: 0, fallidos: 0, alertasCreadas: 2 });

    const res = await POST(peticion({ "x-seguimiento-trabajador-secret": "secreto-real" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, activos: 3, procesados: 3, saltados: 0, fallidos: 0, alertasCreadas: 2 });
  });

  it("un fallo real al correr la revisión: 503 con mensaje genérico, nunca el detalle crudo del error", async () => {
    process.env.SEGUIMIENTO_TRABAJADOR_SECRET = "secreto-real";
    process.env.DATABASE_URL_SEGUIMIENTO = "postgres://lo-que-sea";
    vi.mocked(revisarSeguimientosDelDia).mockRejectedValue(new Error("detalle sensible de la conexión a Postgres"));

    const res = await POST(peticion({ "x-seguimiento-trabajador-secret": "secreto-real" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("detalle sensible");
  });
});
