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
vi.mock("@/lib/ml/video-externo", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/video-externo")>();
  return { ...real, descargarVideoExternoSeguro: vi.fn() };
});

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { VideoExternoNoPermitidoError, descargarVideoExternoSeguro } from "@/lib/ml/video-externo";
import { obtenerVideoTemporal } from "@/lib/trabajos/videoTemporalClip";
import { POST } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(opts: { origin?: string | null; cuerpo?: unknown } = {}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  const origin = opts.origin === undefined ? "https://staging.test" : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  return new Request("https://staging.test/api/ml/clip/traer-video", { method: "POST", headers, body: JSON.stringify(opts.cuerpo ?? { url: "https://export-download.canva.com/video.mp4" }) });
}

describe("POST /api/ml/clip/traer-video — rama feat-publicar-clip, punto 1 ('Traer')", () => {
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

  it("sin link -> 400", async () => {
    const res = await POST(peticion({ cuerpo: {} }));
    expect(res.status).toBe(400);
  });

  it("host no permitido (el error real de descargarVideoExternoSeguro) -> 400 host_no_permitido, nunca un 500 genérico", async () => {
    vi.mocked(descargarVideoExternoSeguro).mockRejectedValueOnce(new VideoExternoNoPermitidoError('"evil.test" no está permitido.'));
    const res = await POST(peticion({ cuerpo: { url: "https://evil.test/video.mp4" } }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("host_no_permitido");
  });

  it("caso feliz: registra el video descargado y devuelve un tempVideoId utilizable", async () => {
    vi.mocked(descargarVideoExternoSeguro).mockResolvedValueOnce({ rutaArchivo: "/tmp/zilonix-clip-prueba.mp4", contentType: "video/mp4", byteLength: 123 });
    const res = await POST(peticion());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tempVideoId).toBeTypeOf("string");
    expect(body.streamUrl).toBe(`/api/ml/clip/video-temp/${body.tempVideoId}`);
    expect(obtenerVideoTemporal(body.tempVideoId, "empresa-1")?.rutaArchivo).toBe("/tmp/zilonix-clip-prueba.mp4");
  });
});
