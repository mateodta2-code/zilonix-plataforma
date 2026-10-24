import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tarea 2.11 — bug real: subirClipAction (Server Action) pasaba por el
// límite GLOBAL de next.config.mjs (bodySizeLimit: "6mb") y cualquier
// Clip real (hasta 280MB) se rechazaba antes de llegar a
// validarArchivoClip. Estas pruebas mockean todo lo que esta ruta toca
// (sesión, empresa activa, permiso, token de la cuenta) para poder
// probar SOLO el comportamiento propio del Route Handler — rechazo
// temprano por content-length, sesión/permiso, y que llegue de verdad
// a subirClipMl (fetch) en el caso feliz — sin una base de datos real.
// lib/ml/clip.ts y lib/ml/cliente.ts NO se mockean: itemId inválido
// tiene que seguir fallando por la validación real de exigirId
// (cliente.ts), no por un mock que lo de por sentado.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "empresa-1", nombre: "Empresa de prueba" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "usuario-1" })) }));
// No se usa vi.importActual: lib/permisos.ts importa (transitivo)
// db/index.ts, que revienta sin DATABASE_URL_APP. Se redefine
// SinPermisoError con la misma forma real (mismo constructor, mismo
// mensaje) — route.ts la importa de este mismo módulo mockeado, así
// que el "instanceof" sigue funcionando igual (mismo criterio que
// app/api/ml/callback/route.test.ts).
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {
    constructor(modulo: string, accion: string) {
      super(`No tienes permiso para "${accion}" en "${modulo}".`);
      this.name = "SinPermisoError";
    }
  }
  return { requierePermiso: vi.fn(async () => ({})), SinPermisoError };
});
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: vi.fn(async () => "token-falso") }));
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { TAMANO_MAXIMO_CLIP_BYTES } from "@/lib/ml/clip";
import { POST } from "./route";

function mockearCookies(valores: Record<string, string | undefined> = {}) {
  vi.mocked(cookies).mockReturnValue({
    get: (nombre: string) => (valores[nombre] !== undefined ? { name: nombre, value: valores[nombre]! } : undefined),
  } as unknown as ReturnType<typeof cookies>);
}

function peticionConContentLength(contentLength: number): NextRequest {
  return new NextRequest("https://staging.test/api/ml/clip", {
    method: "POST",
    headers: { "content-length": String(contentLength) },
  });
}

function peticionFormulario(campos: { cuentaId?: string; itemId?: string }, archivo?: { nombre: string; tipo: string; tamanoBytes: number }): NextRequest {
  const form = new FormData();
  if (campos.cuentaId !== undefined) form.append("cuentaId", campos.cuentaId);
  if (campos.itemId !== undefined) form.append("itemId", campos.itemId);
  if (archivo) {
    form.append("archivo", new File([new Uint8Array(archivo.tamanoBytes)], archivo.nombre, { type: archivo.tipo }));
  }
  return new NextRequest("https://staging.test/api/ml/clip", { method: "POST", body: form });
}

describe("POST /api/ml/clip — sube un Clip por Route Handler, sin el tope de Server Actions (tarea 2.11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sin sesión -> redirige a /sign-in, nunca sube", async () => {
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValueOnce(null as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(peticionFormulario({ cuentaId: "1", itemId: "MCO111" }, { nombre: "clip.mp4", tipo: "video/mp4", tamanoBytes: 10 }));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/sign-in");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin permiso "modificar" -> redirige con el mensaje, nunca sube', async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("inventario", "modificar"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(peticionFormulario({ cuentaId: "1", itemId: "MCO111" }, { nombre: "clip.mp4", tipo: "video/mp4", tamanoBytes: 10 }));

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/panel/publicar/clip");
    expect(new URL(location).searchParams.get("error")).toContain("No tienes permiso");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("content-length por encima de 280MB + margen -> 413 sin leer el body ni llamar a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(peticionConContentLength(TAMANO_MAXIMO_CLIP_BYTES + 10 * 1024 * 1024));

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toMatch(/280MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("itemId inválido -> error legible, nunca llama a fetch (misma validación real de cliente.ts)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(peticionFormulario({ cuentaId: "1", itemId: "MCO1/../users/me" }, { nombre: "clip.mp4", tipo: "video/mp4", tamanoBytes: 10 }));

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/panel/publicar/clip");
    expect(new URL(location).searchParams.get("error") ?? "").toMatch(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caso feliz: valida el archivo, pide el token y llama de verdad a subirClipMl (fetch)", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "accepted", clip_uuid: "clip-1", site_ids: ["MCO"] }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(peticionFormulario({ cuentaId: "cuenta-1", itemId: "MCO111" }, { nombre: "clip.mp4", tipo: "video/mp4", tamanoBytes: 10 }));

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/panel/publicar/clip");
    expect(location).toContain("clipSubido=1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/marketplace/items/MCO111/clips/upload");
    expect(init?.body).toBeInstanceOf(FormData);
  });
});
