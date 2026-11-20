import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "empresa-1", nombre: "Empresa de prueba" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "usuario-1" })) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {
    constructor(modulo: string, accion: string) {
      super(`No tienes permiso para "${accion}" en "${modulo}".`);
      this.name = "SinPermisoError";
    }
  }
  return { requierePermiso: vi.fn(async () => ({})), SinPermisoError };
});
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));

const { interpretarMock } = vi.hoisted(() => ({ interpretarMock: vi.fn() }));
vi.mock("@/lib/ml/promocionesReglasTextoIA", () => ({ interpretarReglasTexto: interpretarMock }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { POST } from "./route";

function peticion(cuerpo: unknown, origin = "https://staging.test"): Request {
  return new Request("https://staging.test/api/ml/promociones/reglas-adicionales/interpretar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

describe("POST /api/ml/promociones/reglas-adicionales/interpretar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("devuelve entendido / noEntendido / json y NO escribe nada", async () => {
    interpretarMock.mockResolvedValueOnce({ estado: "ok", reglas: { version: 1 }, entendido: ["a"], noEntendido: ["b"] });
    const res = await POST(peticion({ texto: "no entrar en Black Friday" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entendido: ["a"], noEntendido: ["b"], json: { version: 1 } });
    expect(interpretarMock).toHaveBeenCalledWith("empresa-1", "no entrar en Black Friday");
  });

  it("sin permiso: 403, nunca llama a la IA", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "aprobar"));
    expect((await POST(peticion({ texto: "x" }))).status).toBe(403);
    expect(interpretarMock).not.toHaveBeenCalled();
  });

  it("origen inválido: 403", async () => {
    expect((await POST(peticion({ texto: "x" }, "https://otro.test"))).status).toBe(403);
    expect(interpretarMock).not.toHaveBeenCalled();
  });

  it("texto faltante, vacío, largo o JSON roto: 400", async () => {
    expect((await POST(peticion({}))).status).toBe(400);
    expect((await POST(peticion({ texto: "  " }))).status).toBe(400);
    expect((await POST(peticion({ texto: "x".repeat(1001) }))).status).toBe(400);
    expect((await POST(peticion("{roto"))).status).toBe(400);
    expect(interpretarMock).not.toHaveBeenCalled();
  });

  it("empresa sin IA conectada: 409 con el mensaje claro", async () => {
    interpretarMock.mockResolvedValueOnce({ estado: "sin_ia", mensaje: "Conecta tu IA en Administración → Conectar IA" });
    const res = await POST(peticion({ texto: "x" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Conecta tu IA en Administración → Conectar IA");
  });

  it("IA que falla: 502 amable", async () => {
    interpretarMock.mockResolvedValueOnce({ estado: "error_ia", mensaje: "No pude interpretar" });
    expect((await POST(peticion({ texto: "x" }))).status).toBe(502);
  });

  it("límite de frecuencia por empresa: tras 6 en un minuto, 429", async () => {
    interpretarMock.mockResolvedValue({ estado: "ok", reglas: { version: 1 }, entendido: [], noEntendido: [] });
    const estados: number[] = [];
    for (let i = 0; i < 8; i++) estados.push((await POST(peticion({ texto: "x" }))).status);
    expect(estados.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    expect(estados[0]).toBe(200);
  });
});
