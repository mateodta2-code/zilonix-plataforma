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
// iniciarTrabajoClip (lib/trabajos/subirClipMultiCuenta.ts) importa
// lib/ml/clip.ts, que importa @/lib/ml/cuentas -> db/empresa-context.ts
// (exige DATABASE_URL_APP con solo importarse) — se mockea para poder
// usar la función REAL de orquestación del trabajo (ya probada en
// subirClipMultiCuenta.test.ts) sin Postgres real. Las pruebas de acá
// abajo usan listas de cuentas VACÍAS a propósito, así nunca se llega
// a llamar obtenerAccessTokenVigente de verdad.
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: vi.fn(async () => "token-falso") }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { iniciarTrabajoClip } from "@/lib/trabajos/subirClipMultiCuenta";
import { GET } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

describe("GET /api/ml/clip/trabajo/[jobId] — rama feat-publicar-clip, punto 4 (polling)", () => {
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
    const res = await GET(new Request("https://staging.test"), { params: { jobId: "x" } });
    expect(res.status).toBe(404);
  });

  it("sin sesión -> 401", async () => {
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValueOnce(null as never);
    const res = await GET(new Request("https://staging.test"), { params: { jobId: "x" } });
    expect(res.status).toBe(401);
  });

  it('sin permiso "consultar" -> 403', async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("inventario", "consultar"));
    const res = await GET(new Request("https://staging.test"), { params: { jobId: "x" } });
    expect(res.status).toBe(403);
  });

  it("jobId inexistente -> 404 (nunca distingue de 'es de otra empresa')", async () => {
    const res = await GET(new Request("https://staging.test"), { params: { jobId: "no-existe" } });
    expect(res.status).toBe(404);
  });

  it("jobId real, de la empresa activa -> 200 con el progreso real del trabajo", async () => {
    const jobId = iniciarTrabajoClip("empresa-1", [], "/tmp/no-se-usa", "video/mp4");
    const res = await GET(new Request("https://staging.test"), { params: { jobId } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.trabajo.id).toBe(jobId);
    expect(body.trabajo.empresaId).toBe("empresa-1");
  });

  it("RLS — un jobId real de OTRA empresa vuelve 404, nunca el progreso ajeno", async () => {
    const jobId = iniciarTrabajoClip("empresa-ajena", [], "/tmp/no-se-usa", "video/mp4");
    const res = await GET(new Request("https://staging.test"), { params: { jobId } });
    expect(res.status).toBe(404);
  });
});
