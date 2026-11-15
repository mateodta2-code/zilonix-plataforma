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

type ResultadoMock = { ok: boolean; estado: "ejecutada" | "fallida"; error: string | null; accionId: string | null };
const { participarEnPublicacionDirectoMock } = vi.hoisted(() => ({
  participarEnPublicacionDirectoMock: vi.fn(async (): Promise<ResultadoMock> => ({ ok: true, estado: "ejecutada", error: null, accionId: "accion-1" })),
}));
vi.mock("@/lib/ml/promocionesPublicaciones", () => ({ participarEnPublicacionDirecto: participarEnPublicacionDirectoMock }));

import { cookies } from "next/headers";
import { requierePermiso } from "@/lib/permisos";
import { POST } from "./route";

const CUENTA_ID = "11111111-1111-1111-1111-111111111111";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(cuerpo: Record<string, unknown>, origin = "https://staging.test"): Request {
  return new Request("https://staging.test/api/ml/promociones/publicaciones/participar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(cuerpo),
  });
}

function cuerpoBase(overrides: Record<string, unknown> = {}) {
  return { cuentaId: CUENTA_ID, itemId: "MCO1", promotionIdMl: "PROMO-1", tipoPromocion: "DEAL", ...overrides };
}

describe("POST /api/ml/promociones/publicaciones/participar — Tarea Promociones real (Refs #295)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("caso feliz: delega al módulo real con los datos del body", async () => {
    const res = await POST(peticion(cuerpoBase({ precioElegido: 95000 })));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, estado: "ejecutada" });
    expect(participarEnPublicacionDirectoMock).toHaveBeenCalledWith("empresa-1", "usuario-1", CUENTA_ID, "MCO1", "PROMO-1", "DEAL", 95000);
  });

  it("un rechazo (validación o de Mercado Libre) sigue devolviendo 200, con el motivo real adentro — nunca se pierde detrás de un 4xx/5xx genérico", async () => {
    participarEnPublicacionDirectoMock.mockResolvedValueOnce({ ok: false, estado: "fallida", error: "Falta precio mínimo para este SKU.", accionId: null });
    const res = await POST(peticion(cuerpoBase()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: false, error: "Falta precio mínimo para este SKU." });
  });

  it("cuentaId inválido: 400, nunca llega al módulo", async () => {
    const res = await POST(peticion(cuerpoBase({ cuentaId: "no-es-un-uuid" })));
    expect(res.status).toBe(400);
    expect(participarEnPublicacionDirectoMock).not.toHaveBeenCalled();
  });

  it("falta itemId: 400", async () => {
    const res = await POST(peticion(cuerpoBase({ itemId: undefined })));
    expect(res.status).toBe(400);
  });

  it("precioElegido que no es número: 400", async () => {
    const res = await POST(peticion(cuerpoBase({ precioElegido: "95000" })));
    expect(res.status).toBe(400);
    expect(participarEnPublicacionDirectoMock).not.toHaveBeenCalled();
  });

  it("origen inválido: 403, nunca llega a tocar nada", async () => {
    const res = await POST(peticion(cuerpoBase(), "https://otro-sitio.test"));
    expect(res.status).toBe(403);
    expect(participarEnPublicacionDirectoMock).not.toHaveBeenCalled();
  });

  it("sin permiso de 'ejecutar': 403", async () => {
    const { SinPermisoError } = await import("@/lib/permisos");
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "ejecutar"));
    const res = await POST(peticion(cuerpoBase()));
    expect(res.status).toBe(403);
    expect(participarEnPublicacionDirectoMock).not.toHaveBeenCalled();
  });
});
