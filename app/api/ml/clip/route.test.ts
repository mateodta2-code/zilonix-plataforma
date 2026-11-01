import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Rama feat-publicar-clip, punto 4 — esta ruta reemplaza por completo
// la versión de la tarea 2.11 (una sola cuenta, request.formData() en
// memoria, redirect con `?error=`). Mismo criterio de mocks que el
// resto del repo: @/lib/ml/cuentas se mockea ANTES de cualquier import
// real (vi.mock se hoistea arriba de todo) para que importar
// @/lib/ml/clip de verdad (sus clases de error, validarArchivoClip)
// NUNCA llegue a tocar db/empresa-context.ts (exige DATABASE_URL_APP
// con solo importarse). @/lib/trabajos/subirClipMultiCuenta se mockea
// ENTERO — ya tiene su propia prueba (subirClipMultiCuenta.test.ts);
// acá solo interesa que esta ruta lo LLAME con los datos correctos.
const { CUENTA_1, CUENTA_2 } = vi.hoisted(() => ({
  CUENTA_1: "11111111-1111-1111-1111-111111111111",
  CUENTA_2: "22222222-2222-2222-2222-222222222222",
}));

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
  listarCuentasConectadas: vi.fn(async () => [
    { id: CUENTA_1, cuentaIdExterna: "111", nickname: "Cuenta 1", desconectadaTs: null, creadoTs: new Date() },
    { id: CUENTA_2, cuentaIdExterna: "222", nickname: "Cuenta 2", desconectadaTs: null, creadoTs: new Date() },
  ]),
}));
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));
const iniciarTrabajoClipMock = vi.hoisted(() =>
  vi.fn((_empresaId: string, _cuentas: { cuentaId: string; nickname: string; itemId: string; rutaArchivo?: string; contentType?: string }[], _rutaPorDefecto: string, _contentTypePorDefecto: string) => "job-123")
);
vi.mock("@/lib/trabajos/subirClipMultiCuenta", () => ({ iniciarTrabajoClip: iniciarTrabajoClipMock }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { registrarVideoTemporal, obtenerVideoTemporal } from "@/lib/trabajos/videoTemporalClip";
import { POST } from "./route";

const ORIGEN_PROPIO = "https://staging.test";
const ITEM_1 = "MCO111";
const ITEM_2 = "MCO222";

function mockearCookies(valores: Record<string, string | undefined> = {}) {
  vi.mocked(cookies).mockReturnValue({
    get: (nombre: string) => (valores[nombre] !== undefined ? { name: nombre, value: valores[nombre]! } : undefined),
  } as unknown as ReturnType<typeof cookies>);
}

function archivoVideoValido(nombre = "clip.mp4", bytes = 100): File {
  return new File([new Uint8Array(bytes)], nombre, { type: "video/mp4" });
}

function peticionSubida(opts: {
  origin?: string | null;
  contentLength?: string | null;
  cuentas?: { cuentaId: string; itemId: string }[] | string;
  archivo?: File | null;
  tempVideoId?: string;
  overrides?: Record<string, File | string>;
} = {}): Request {
  const form = new FormData();
  if (opts.cuentas !== undefined) {
    form.append("cuentas", typeof opts.cuentas === "string" ? opts.cuentas : JSON.stringify(opts.cuentas));
  } else {
    form.append("cuentas", JSON.stringify([{ cuentaId: CUENTA_1, itemId: ITEM_1 }]));
  }
  if (opts.archivo !== null) form.append("archivo", opts.archivo ?? archivoVideoValido());
  if (opts.tempVideoId) form.append("tempVideoId", opts.tempVideoId);
  for (const [nombre, valor] of Object.entries(opts.overrides ?? {})) {
    form.append(nombre, valor);
  }

  const headers = new Headers();
  const origin = opts.origin === undefined ? ORIGEN_PROPIO : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentLength = opts.contentLength === undefined ? "1000" : opts.contentLength;
  if (contentLength !== null) headers.set("content-length", contentLength);

  return new Request("https://staging.test/api/ml/clip", { method: "POST", headers, body: form });
}

function archivoTemporalDePrueba(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), "zilonix-clip-route-test-"));
  const ruta = path.join(carpeta, "video.mp4");
  writeFileSync(ruta, new Uint8Array(100));
  return ruta;
}

describe("POST /api/ml/clip — rama feat-publicar-clip, punto 4 (subir, multi-cuenta, streaming a disco)", () => {
  const CLIP_HABILITADO_ORIGINAL = process.env.CLIP_HABILITADO;

  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    process.env.CLIP_HABILITADO = "true";
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
    vi.mocked(listarCuentasConectadas).mockResolvedValue([
      { id: CUENTA_1, cuentaIdExterna: "111", nickname: "Cuenta 1", desconectadaTs: null, creadoTs: new Date() } as never,
      { id: CUENTA_2, cuentaIdExterna: "222", nickname: "Cuenta 2", desconectadaTs: null, creadoTs: new Date() } as never,
    ]);
    iniciarTrabajoClipMock.mockReturnValue("job-123");
  });

  afterEach(() => {
    if (CLIP_HABILITADO_ORIGINAL === undefined) delete process.env.CLIP_HABILITADO;
    else process.env.CLIP_HABILITADO = CLIP_HABILITADO_ORIGINAL;
  });

  it("CLIP_HABILITADO apagado -> 404, nunca mira sesión", async () => {
    delete process.env.CLIP_HABILITADO;
    const res = await POST(peticionSubida());
    expect(res.status).toBe(404);
    expect(obtenerOCrearUsuarioActual).not.toHaveBeenCalled();
  });

  it("Origin ajeno -> 403, nunca llega a mirar sesión", async () => {
    const res = await POST(peticionSubida({ origin: "https://sitio-ajeno.test" }));
    expect(res.status).toBe(403);
    expect(obtenerOCrearUsuarioActual).not.toHaveBeenCalled();
  });

  it("sin sesión -> 401 JSON, nunca sube", async () => {
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValueOnce(null as never);
    const res = await POST(peticionSubida());
    expect(res.status).toBe(401);
    expect(iniciarTrabajoClipMock).not.toHaveBeenCalled();
  });

  it('sin permiso "modificar" -> 403, nunca sube', async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("inventario", "modificar"));
    const res = await POST(peticionSubida());
    expect(res.status).toBe(403);
    expect(iniciarTrabajoClipMock).not.toHaveBeenCalled();
  });

  it("content-length por encima del tope -> 400 demasiado_grande, nunca parsea el multipart", async () => {
    const res = await POST(peticionSubida({ contentLength: String(300 * 1024 * 1024 * 6) }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("demasiado_grande");
    expect(iniciarTrabajoClipMock).not.toHaveBeenCalled();
  });

  it("sin cuentas (campo vacío) -> 400 faltan_datos", async () => {
    const res = await POST(peticionSubida({ cuentas: "" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("faltan_datos");
  });

  it("cuentas con JSON inválido -> 400 faltan_datos", async () => {
    const res = await POST(peticionSubida({ cuentas: "no-es-json" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("faltan_datos");
  });

  it("cuentaId que no es UUID en la lista -> 400 faltan_datos (nunca asume un formato)", async () => {
    const res = await POST(peticionSubida({ cuentas: [{ cuentaId: "no-es-uuid", itemId: ITEM_1 }] }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("faltan_datos");
  });

  it("ni archivo ni tempVideoId -> 400 faltan_datos", async () => {
    const res = await POST(peticionSubida({ archivo: null }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("faltan_datos");
  });

  it("archivo Y tempVideoId a la vez -> 400 faltan_datos (exactamente uno de los dos)", async () => {
    const res = await POST(peticionSubida({ tempVideoId: "algun-id" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("faltan_datos");
  });

  it("tempVideoId que no existe -> 400 video_no_encontrado", async () => {
    const res = await POST(peticionSubida({ archivo: null, tempVideoId: "no-existe" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("video_no_encontrado");
  });

  it("archivo con tipo inválido -> 400 archivo_invalido", async () => {
    const archivo = new File([new Uint8Array(10)], "clip.txt", { type: "text/plain" });
    const res = await POST(peticionSubida({ archivo }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("archivo_invalido");
    expect(iniciarTrabajoClipMock).not.toHaveBeenCalled();
  });

  it("ninguna cuenta pedida está conectada -> 400 cuenta_invalida, y el temporal se borra igual (nunca queda huérfano)", async () => {
    vi.mocked(listarCuentasConectadas).mockResolvedValueOnce([]);
    const res = await POST(peticionSubida());
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("cuenta_invalida");
    expect(iniciarTrabajoClipMock).not.toHaveBeenCalled();
  });

  it("caso feliz: 2 cuentas, mismo video para ambas -> 200 {jobId}, iniciarTrabajoClip recibe las 2 filas", async () => {
    const res = await POST(
      peticionSubida({
        cuentas: [
          { cuentaId: CUENTA_1, itemId: ITEM_1 },
          { cuentaId: CUENTA_2, itemId: ITEM_2 },
        ],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.jobId).toBe("job-123");
    expect(iniciarTrabajoClipMock).toHaveBeenCalledTimes(1);
    const [empresaId, cuentas, rutaPorDefecto, contentTypePorDefecto] = iniciarTrabajoClipMock.mock.calls[0]!;
    expect(empresaId).toBe("empresa-1");
    expect(cuentas).toEqual([
      { cuentaId: CUENTA_1, nickname: "Cuenta 1", itemId: ITEM_1, rutaArchivo: undefined, contentType: undefined },
      { cuentaId: CUENTA_2, nickname: "Cuenta 2", itemId: ITEM_2, rutaArchivo: undefined, contentType: undefined },
    ]);
    expect(contentTypePorDefecto).toBe("video/mp4");
    expect(existsSync(rutaPorDefecto)).toBe(true);
  });

  it("una cuenta pedida no está conectada: se excluye sola, el resto sigue (nunca rompe todo el pedido)", async () => {
    vi.mocked(listarCuentasConectadas).mockResolvedValueOnce([
      { id: CUENTA_1, cuentaIdExterna: "111", nickname: "Cuenta 1", desconectadaTs: null, creadoTs: new Date() } as never,
    ]);
    const res = await POST(
      peticionSubida({
        cuentas: [
          { cuentaId: CUENTA_1, itemId: ITEM_1 },
          { cuentaId: CUENTA_2, itemId: ITEM_2 },
        ],
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.jobId).toBe("job-123");
    const [, cuentas] = iniciarTrabajoClipMock.mock.calls[0]!;
    expect(cuentas).toHaveLength(1);
    expect(cuentas[0].cuentaId).toBe(CUENTA_1);
  });

  it("override por cuenta ('usar otro video para esta cuenta'): esa fila lleva SU PROPIA ruta/tipo, distinta a la del resto", async () => {
    const archivoPropio = new File([new Uint8Array(50)], "propio.mp4", { type: "video/mp4" });
    const res = await POST(
      peticionSubida({
        cuentas: [
          { cuentaId: CUENTA_1, itemId: ITEM_1 },
          { cuentaId: CUENTA_2, itemId: ITEM_2 },
        ],
        overrides: { [`archivo_${CUENTA_2}`]: archivoPropio },
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.jobId).toBe("job-123");
    const [, cuentas, rutaPorDefecto] = iniciarTrabajoClipMock.mock.calls[0]!;
    const filaC1 = cuentas.find((c) => c.cuentaId === CUENTA_1)!;
    const filaC2 = cuentas.find((c) => c.cuentaId === CUENTA_2)!;
    expect(filaC1.rutaArchivo).toBeUndefined();
    expect(filaC2.rutaArchivo).not.toBeUndefined();
    expect(filaC2.rutaArchivo).not.toBe(rutaPorDefecto);
  });

  it("origen por tempVideoId: usa el video ya bajado antes (traer-video) y lo saca del mapa temporal al reclamarlo", async () => {
    const rutaArchivo = archivoTemporalDePrueba();
    const video = registrarVideoTemporal("empresa-1", rutaArchivo, "video/mp4", "traido.mp4");

    const res = await POST(peticionSubida({ archivo: null, tempVideoId: video.id }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.jobId).toBe("job-123");
    const [, , rutaPorDefecto, contentTypePorDefecto] = iniciarTrabajoClipMock.mock.calls[0]!;
    expect(rutaPorDefecto).toBe(rutaArchivo);
    expect(contentTypePorDefecto).toBe("video/mp4");
    // Ya es responsabilidad exclusiva del trabajo — no se puede volver
    // a pedir por el mismo id.
    expect(obtenerVideoTemporal(video.id, "empresa-1")).toBeNull();
  });
});

// Mismo criterio que el describe de arriba (bandera apagada probada
// aparte, sin pisar el beforeEach que la fija en "true").
describe("POST /api/ml/clip — CLIP_HABILITADO apagado por default", () => {
  const CLIP_HABILITADO_ORIGINAL = process.env.CLIP_HABILITADO;

  afterEach(() => {
    if (CLIP_HABILITADO_ORIGINAL === undefined) delete process.env.CLIP_HABILITADO;
    else process.env.CLIP_HABILITADO = CLIP_HABILITADO_ORIGINAL;
  });

  it('variable en "false" -> 404, mismo default seguro que ausente', async () => {
    process.env.CLIP_HABILITADO = "false";
    vi.clearAllMocks();
    mockearCookies();
    const res = await POST(peticionSubida());
    expect(res.status).toBe(404);
    expect(obtenerOCrearUsuarioActual).not.toHaveBeenCalled();
  });
});
