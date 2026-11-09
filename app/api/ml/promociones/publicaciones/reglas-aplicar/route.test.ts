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

const { aplicarReglaALoteMock } = vi.hoisted(() => ({
  aplicarReglaALoteMock: vi.fn(async () => ({ revisadas: 0, participadas: 0, fallidas: 0, omitidas: 0, filas: [] })),
}));
vi.mock("@/lib/ml/promocionesPublicaciones", () => ({ aplicarReglaALote: aplicarReglaALoteMock }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { POST } from "./route";

const CUENTA_ID = "11111111-1111-1111-1111-111111111111";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(cuerpo: Record<string, unknown>, origin = "https://staging.test"): Request {
  return new Request("https://staging.test/api/ml/promociones/publicaciones/reglas-aplicar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(cuerpo),
  });
}

describe("POST /api/ml/promociones/publicaciones/reglas-aplicar — Tarea Promociones real (Refs #295)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("regla 'todas': delega al módulo real", async () => {
    const res = await POST(peticion({ cuentaId: "todas", regla: "todas" }));
    expect(res.status).toBe(200);
    expect(aplicarReglaALoteMock).toHaveBeenCalledWith("empresa-1", "usuario-1", "todas", { tipo: "todas" });
  });

  it("regla 'maximo' con maximoPct válido: lo pasa tal cual", async () => {
    await POST(peticion({ cuentaId: CUENTA_ID, regla: "maximo", maximoPct: 15 }));
    expect(aplicarReglaALoteMock).toHaveBeenCalledWith("empresa-1", "usuario-1", CUENTA_ID, { tipo: "maximo", maximoPct: 15 });
  });

  it("regla 'maximo' sin maximoPct (o fuera de rango): 400, nunca llega al módulo", async () => {
    const res1 = await POST(peticion({ cuentaId: "todas", regla: "maximo" }));
    expect(res1.status).toBe(400);
    const res2 = await POST(peticion({ cuentaId: "todas", regla: "maximo", maximoPct: 150 }));
    expect(res2.status).toBe(400);
    expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
  });

  it("regla 'tabla-maestra': delega igual, sin maximoPct", async () => {
    await POST(peticion({ cuentaId: "todas", regla: "tabla-maestra" }));
    expect(aplicarReglaALoteMock).toHaveBeenCalledWith("empresa-1", "usuario-1", "todas", { tipo: "tabla-maestra" });
  });

  it("regla inválida: 400", async () => {
    const res = await POST(peticion({ cuentaId: "todas", regla: "lo-que-sea" }));
    expect(res.status).toBe(400);
  });

  it("cuentaId inválido (ni 'todas' ni UUID): 400", async () => {
    const res = await POST(peticion({ cuentaId: "no-es-un-uuid", regla: "todas" }));
    expect(res.status).toBe(400);
  });

  it("origen inválido: 403, nunca llega a tocar nada", async () => {
    const res = await POST(peticion({ cuentaId: "todas", regla: "todas" }, "https://otro-sitio.test"));
    expect(res.status).toBe(403);
    expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
  });

  it("sin permiso de 'ejecutar': 403", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "ejecutar"));
    const res = await POST(peticion({ cuentaId: "todas", regla: "todas" }));
    expect(res.status).toBe(403);
    expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
  });
});
