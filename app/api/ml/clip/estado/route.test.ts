import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CUENTA_1 = "11111111-1111-1111-1111-111111111111";

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
  obtenerAccessTokenVigente: vi.fn(async () => "token-falso"),
  listarCuentasConectadas: vi.fn(async () => [{ id: CUENTA_1, cuentaIdExterna: "111", nickname: "Cuenta 1", desconectadaTs: null, creadoTs: new Date() }]),
}));
vi.mock("@/lib/ml/cliente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/cliente")>();
  return { ...real, obtenerClipsMl: vi.fn() };
});
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { obtenerClipsMl } from "@/lib/ml/cliente";
import { POST } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(opts: { origin?: string | null; cuerpo?: unknown } = {}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  const origin = opts.origin === undefined ? "https://staging.test" : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  const cuerpo = opts.cuerpo ?? { items: [{ cuentaId: CUENTA_1, itemId: "MCO1" }] };
  return new Request("https://staging.test/api/ml/clip/estado", { method: "POST", headers, body: JSON.stringify(cuerpo) });
}

describe("POST /api/ml/clip/estado — rama feat-publicar-clip, punto 5 ('Actualizar estado')", () => {
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

  it("sin items -> 400", async () => {
    const res = await POST(peticion({ cuerpo: { items: [] } }));
    expect(res.status).toBe(400);
  });

  it("itemId con formato inválido -> 400 (nunca llama a Mercado Libre)", async () => {
    const res = await POST(peticion({ cuerpo: { items: [{ cuentaId: CUENTA_1, itemId: "../etc/passwd" }] } }));
    expect(res.status).toBe(400);
    expect(obtenerClipsMl).not.toHaveBeenCalled();
  });

  it("caso feliz: parsea moderation_status real de Mercado Libre para cada item pedido", async () => {
    vi.mocked(obtenerClipsMl).mockResolvedValueOnce([{ clipUuid: "clip-1", moderationStatus: "PUBLISHED", motivoRechazo: null }]);
    const res = await POST(peticion());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.filas).toEqual([{ cuentaId: CUENTA_1, itemId: "MCO1", clips: [{ clipUuid: "clip-1", moderationStatus: "PUBLISHED", motivoRechazo: null }] }]);
  });

  it("una cuenta pedida que no está conectada: esa fila vuelve con clips:null, nunca rompe el resto", async () => {
    const res = await POST(peticion({ cuerpo: { items: [{ cuentaId: "22222222-2222-2222-2222-222222222222", itemId: "MCO1" }] } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.filas).toEqual([{ cuentaId: "22222222-2222-2222-2222-222222222222", itemId: "MCO1", clips: null }]);
    expect(obtenerClipsMl).not.toHaveBeenCalled();
  });
});
