import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
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

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { registrarVideoTemporal } from "@/lib/trabajos/videoTemporalClip";
import { GET } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function archivoDePrueba(contenido: Uint8Array): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), "zilonix-video-temp-route-test-"));
  const ruta = path.join(carpeta, "video.mp4");
  writeFileSync(ruta, contenido);
  return ruta;
}

async function leerCuerpo(res: Response): Promise<Buffer> {
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

describe("GET /api/ml/clip/video-temp/[id] — rama feat-publicar-clip, punto 1/2 (preview del video traído por link)", () => {
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
    const res = await GET(new Request("https://staging.test"), { params: { id: "x" } });
    expect(res.status).toBe(404);
  });

  it("id inexistente -> 404", async () => {
    const res = await GET(new Request("https://staging.test"), { params: { id: "no-existe" } });
    expect(res.status).toBe(404);
  });

  it("RLS — un video real de OTRA empresa vuelve 404, nunca su contenido", async () => {
    const ruta = archivoDePrueba(new Uint8Array([1, 2, 3]));
    const video = registrarVideoTemporal("empresa-ajena", ruta, "video/mp4", "clip.mp4");
    const res = await GET(new Request("https://staging.test"), { params: { id: video.id } });
    expect(res.status).toBe(404);
  });

  it("sin Range: devuelve el archivo completo, con Content-Type/Content-Length reales", async () => {
    const contenido = new Uint8Array([1, 2, 3, 4, 5]);
    const ruta = archivoDePrueba(contenido);
    const video = registrarVideoTemporal("empresa-1", ruta, "video/mp4", "clip.mp4");

    const res = await GET(new Request("https://staging.test"), { params: { id: video.id } });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe("5");
    expect(Array.from(await leerCuerpo(res))).toEqual([1, 2, 3, 4, 5]);
  });

  it("con Range: devuelve 206 con solo el tramo pedido (Safari necesita esto para leer metadatos del <video>)", async () => {
    const contenido = new Uint8Array([10, 20, 30, 40, 50]);
    const ruta = archivoDePrueba(contenido);
    const video = registrarVideoTemporal("empresa-1", ruta, "video/mp4", "clip.mp4");

    const res = await GET(new Request("https://staging.test", { headers: { range: "bytes=1-3" } }), { params: { id: video.id } });

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(Array.from(await leerCuerpo(res))).toEqual([20, 30, 40]);
  });

  it("Range fuera de rango -> 416, nunca un tramo inventado", async () => {
    const ruta = archivoDePrueba(new Uint8Array([1, 2, 3]));
    const video = registrarVideoTemporal("empresa-1", ruta, "video/mp4", "clip.mp4");

    const res = await GET(new Request("https://staging.test", { headers: { range: "bytes=10-20" } }), { params: { id: video.id } });

    expect(res.status).toBe(416);
  });
});
