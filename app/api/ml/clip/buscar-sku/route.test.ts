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
vi.mock("@/lib/ml/cuentas", () => ({
  listarCuentasConectadas: vi.fn(async () => [{ id: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1", desconectadaTs: null, creadoTs: new Date() }]),
}));
vi.mock("@/lib/ml/clip", () => ({ buscarSkuEnTodasLasCuentas: vi.fn(async () => [{ cuentaId: "c1", nickname: "Cuenta 1", encontrado: true, itemId: "MCO1", titulo: "t", thumbnail: null, activo: true, motivoNoDisponible: null }]) }));
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { buscarSkuEnTodasLasCuentas } from "@/lib/ml/clip";
import { POST } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(opts: { origin?: string | null; cuerpo?: unknown } = {}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  const origin = opts.origin === undefined ? "https://staging.test" : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  return new Request("https://staging.test/api/ml/clip/buscar-sku", { method: "POST", headers, body: JSON.stringify(opts.cuerpo ?? { sku: "ABC123" }) });
}

describe("POST /api/ml/clip/buscar-sku — rama feat-publicar-clip, punto 3", () => {
  const CLIP_HABILITADO_ORIGINAL = process.env.CLIP_HABILITADO;

  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    process.env.CLIP_HABILITADO = "true";
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });

  afterEach(() => {
    if (CLIP_HABILITADO_ORIGINAL === undefined) delete process.env.CLIP_HABILITADO;
    else process.env.CLIP_HABILITADO = CLIP_HABILITADO_ORIGINAL;
  });

  it("CLIP_HABILITADO apagado -> 404", async () => {
    delete process.env.CLIP_HABILITADO;
    const res = await POST(peticion());
    expect(res.status).toBe(404);
  });

  it("Origin ajeno -> 403", async () => {
    const res = await POST(peticion({ origin: "https://sitio-ajeno.test" }));
    expect(res.status).toBe(403);
  });

  it("sin sesión -> 401", async () => {
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValueOnce(null as never);
    const res = await POST(peticion());
    expect(res.status).toBe(401);
  });

  it('sin permiso "consultar" -> 403', async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("inventario", "consultar"));
    const res = await POST(peticion());
    expect(res.status).toBe(403);
  });

  it("sin SKU -> 400", async () => {
    const res = await POST(peticion({ cuerpo: {} }));
    expect(res.status).toBe(400);
  });

  it("caso feliz: llama a buscarSkuEnTodasLasCuentas con las cuentas conectadas de la empresa activa y devuelve sus filas", async () => {
    const res = await POST(peticion({ cuerpo: { sku: "ABC123" } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.filas).toHaveLength(1);
    expect(buscarSkuEnTodasLasCuentas).toHaveBeenCalledWith("empresa-1", [{ id: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1", desconectadaTs: null, creadoTs: expect.anything() }], "ABC123");
  });
});
