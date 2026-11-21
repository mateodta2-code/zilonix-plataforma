import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./conexion", () => ({
  obtenerConexionIAConClavePorId: vi.fn(async () => ({ id: "c1", proveedor: "openai", modelo: "gpt-5-mini", baseUrl: null, apiKey: "clave-secreta" })),
}));

import { ERRORES_PROBAR_IA, probarConexionIA } from "./probarConexion";

const respuesta = (status: number, data: unknown = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("probarConexionIA", () => {
  it("un 400 del proveedor dice que revise el modelo (antes caía en «No se pudo probar la conexión»)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(400, { error: { message: "Unsupported parameter: clave-secreta" } })));
    const r = await probarConexionIA("empresa", "c1");
    expect(r).toEqual({ ok: false, error: ERRORES_PROBAR_IA.solicitud });
    expect(JSON.stringify(r)).not.toContain("clave-secreta");
  });

  it("gpt-5-mini responde bien: «Conexión correcta» y la llamada usa max_completion_tokens", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => respuesta(200, { choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", f);
    expect(await probarConexionIA("empresa", "c1")).toEqual({ ok: true });
    const cuerpo = JSON.parse(f.mock.calls[0]![1]!.body as string);
    expect(cuerpo).not.toHaveProperty("max_tokens");
    expect(cuerpo.max_completion_tokens).toBeGreaterThan(16);
  });

  it("401 → llave, 404 → modelo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(401)));
    expect(await probarConexionIA("empresa", "c1")).toEqual({ ok: false, error: ERRORES_PROBAR_IA.llave });
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(404)));
    expect(await probarConexionIA("empresa", "c1")).toEqual({ ok: false, error: ERRORES_PROBAR_IA.modelo });
  });
});
