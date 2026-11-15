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
const { CUENTA_1, CUENTA_2 } = vi.hoisted(() => ({
  CUENTA_1: "11111111-1111-1111-1111-111111111111",
  CUENTA_2: "22222222-2222-2222-2222-222222222222",
}));
vi.mock("@/lib/ml/cuentas", () => ({
  listarCuentasConectadas: vi.fn(async () => [
    { id: CUENTA_1, cuentaIdExterna: "111", nickname: "Cuenta 1", desconectadaTs: null, creadoTs: new Date() },
    { id: CUENTA_2, cuentaIdExterna: "222", nickname: "Cuenta 2", desconectadaTs: null, creadoTs: new Date() },
  ]),
}));
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));
const iniciarBusquedaPromocionesMock = vi.hoisted(() =>
  vi.fn((_empresaId: string, _cuentas: { cuentaMlId: string; cuentaId: string; cuentaIdExterna: string; nickname: string }[]) => "job-123")
);
vi.mock("@/lib/trabajos/buscarPromocionesMultiCuenta", () => ({ iniciarBusquedaPromociones: iniciarBusquedaPromocionesMock }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { POST } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(opts: { origin?: string | null; cuerpo?: unknown } = {}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  const origin = opts.origin === undefined ? "https://staging.test" : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  return new Request("https://staging.test/api/ml/promociones/buscar", { method: "POST", headers, body: JSON.stringify(opts.cuerpo ?? {}) });
}

describe("POST /api/ml/promociones/buscar — rama feat-promociones, punto 3/4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
    iniciarBusquedaPromocionesMock.mockReturnValue("job-123");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("Origin ajeno -> 403, nunca mira sesión", async () => {
    const res = await POST(peticion({ origin: "https://sitio-ajeno.test" }));
    expect(res.status).toBe(403);
    expect(obtenerOCrearUsuarioActual).not.toHaveBeenCalled();
  });

  it("sin sesión -> 401", async () => {
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValueOnce(null as never);
    const res = await POST(peticion());
    expect(res.status).toBe(401);
  });

  it('sin permiso "consultar" -> 403, nunca arranca el trabajo', async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "consultar"));
    const res = await POST(peticion());
    expect(res.status).toBe(403);
    expect(iniciarBusquedaPromocionesMock).not.toHaveBeenCalled();
  });

  it("sin body (todas las cuentas): arranca el trabajo con las 2 cuentas conectadas", async () => {
    const res = await POST(peticion());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.jobId).toBe("job-123");
    const [, cuentas] = iniciarBusquedaPromocionesMock.mock.calls[0]!;
    expect(cuentas).toHaveLength(2);
  });

  it("con cuentaId: arranca el trabajo solo con esa cuenta", async () => {
    const res = await POST(peticion({ cuerpo: { cuentaId: CUENTA_1 } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.jobId).toBe("job-123");
    const [, cuentas] = iniciarBusquedaPromocionesMock.mock.calls[0]!;
    expect(cuentas).toHaveLength(1);
    expect(cuentas[0].cuentaMlId).toBe(CUENTA_1);
  });

  it("cuentaId con formato inválido -> 400, nunca arranca el trabajo", async () => {
    const res = await POST(peticion({ cuerpo: { cuentaId: "no-es-un-uuid" } }));
    expect(res.status).toBe(400);
    expect(iniciarBusquedaPromocionesMock).not.toHaveBeenCalled();
  });

  it("ninguna cuenta conectada -> 400", async () => {
    vi.mocked(listarCuentasConectadas).mockResolvedValueOnce([]);
    const res = await POST(peticion());
    expect(res.status).toBe(400);
    expect(iniciarBusquedaPromocionesMock).not.toHaveBeenCalled();
  });
});
