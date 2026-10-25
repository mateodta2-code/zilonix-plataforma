import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tarea 2.11 — bug real: subirClipAction (Server Action) pasaba por el
// límite GLOBAL de next.config.mjs (bodySizeLimit: "6mb") y cualquier
// Clip real (hasta 280MB) se rechazaba antes de llegar a
// validarArchivoClip. Issue de seguridad real encontrado después: el
// Route Handler nuevo acepta un <form> normal, el mismo perfil de
// petición que un CSRF clásico puede mandar desde otro sitio — y
// mandaba el detalle de cualquier error (hasta el texto crudo de
// Mercado Libre) directo a la URL del redirect.
//
// Estas pruebas mockean sesión/empresa/permiso/cuenta/token (evitan
// Postgres real) y lib/ml/clip.ts PARCIALMENTE: las clases de error y
// validarArchivoClip son las REALES (importOriginal), subirClipItem es
// un spy que por defecto llama a la implementación real (así el caso
// feliz y el de "texto crudo" siguen probando la cadena real hasta
// fetch) pero se puede sobreescribir por prueba para forzar un tipo de
// error puntual. lib/ml/cliente.ts NO se mockea: PATRON_ID_PRODUCTO_O_ITEM
// es el real, para que "itemId inválido" siga siendo la validación de
// verdad, no un mock que lo dé por sentado.
// vi.mock() se hoistea ANTES que cualquier const del módulo — un
// cuentaId fijo que la fábrica de @/lib/ml/cuentas necesita abajo
// tiene que declararse con vi.hoisted(), o sería un ReferenceError.
const { CUENTA_ID_VALIDA } = vi.hoisted(() => ({ CUENTA_ID_VALIDA: "11111111-1111-1111-1111-111111111111" }));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "empresa-1", nombre: "Empresa de prueba" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "usuario-1" })) }));
// No se usa vi.importActual para lib/permisos.ts: importa (transitivo)
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
vi.mock("@/lib/ml/cuentas", () => ({
  obtenerAccessTokenVigente: vi.fn(async () => "token-falso"),
  listarCuentasConectadas: vi.fn(async () => [{ id: CUENTA_ID_VALIDA, cuentaIdExterna: "123456", nickname: "VENDEDOR", desconectadaTs: null, creadoTs: new Date() }]),
}));
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));
vi.mock("@/lib/ml/clip", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/clip")>();
  return { ...real, subirClipItem: vi.fn(real.subirClipItem) };
});

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { ClipRechazadoError, ClipReputacionRequeridaError, subirClipItem, TAMANO_MAXIMO_CLIP_BYTES } from "@/lib/ml/clip";
import { POST } from "./route";

const ORIGEN_PROPIO = "https://staging.test";
const ITEM_VALIDO = "MCO111";

function mockearCookies(valores: Record<string, string | undefined> = {}) {
  vi.mocked(cookies).mockReturnValue({
    get: (nombre: string) => (valores[nombre] !== undefined ? { name: nombre, value: valores[nombre]! } : undefined),
  } as unknown as ReturnType<typeof cookies>);
}

function peticionFormulario(opts: {
  origin?: string | null;
  referer?: string | null;
  contentLength?: string | null;
  cuentaId?: string;
  itemId?: string;
  sinArchivo?: boolean;
  archivo?: { nombre: string; tipo: string; tamanoBytes: number };
} = {}): NextRequest {
  const form = new FormData();
  if (opts.cuentaId !== undefined) form.append("cuentaId", opts.cuentaId);
  if (opts.itemId !== undefined) form.append("itemId", opts.itemId);
  if (!opts.sinArchivo) {
    const archivo = opts.archivo ?? { nombre: "clip.mp4", tipo: "video/mp4", tamanoBytes: 10 };
    form.append("archivo", new File([new Uint8Array(archivo.tamanoBytes)], archivo.nombre, { type: archivo.tipo }));
  }
  const headers = new Headers();
  const origin = opts.origin === undefined ? ORIGEN_PROPIO : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  if (opts.referer) headers.set("referer", opts.referer);
  // Content-length explícito (no el que undici calcularía solo a
  // partir del FormData) — así cada prueba controla exactamente qué ve
  // el chequeo de tamaño, sin depender del tamaño real serializado.
  const contentLength = opts.contentLength === undefined ? "1000" : opts.contentLength;
  if (contentLength !== null) headers.set("content-length", contentLength);
  return new NextRequest("https://staging.test/api/ml/clip", { method: "POST", headers, body: form });
}

function codigoDeError(location: string): string | null {
  return new URL(location).searchParams.get("error");
}

describe("POST /api/ml/clip — CSRF, códigos de error cerrados y validación previa (tarea 2.11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
    vi.mocked(listarCuentasConectadas).mockResolvedValue([
      { id: CUENTA_ID_VALIDA, cuentaIdExterna: "123456", nickname: "VENDEDOR", desconectadaTs: null, creadoTs: new Date() } as never,
    ]);
    vi.mocked(obtenerAccessTokenVigente).mockResolvedValue("token-falso");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("Origin ajeno -> 403, nunca llega a mirar sesión ni leer el formulario", async () => {
    const res = await POST(peticionFormulario({ origin: "https://sitio-ajeno.test", cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(403);
    expect(obtenerOCrearUsuarioActual).not.toHaveBeenCalled();
    expect(requierePermiso).not.toHaveBeenCalled();
    expect(subirClipItem).not.toHaveBeenCalled();
  });

  it("sin Origin ni Referer -> 403, nunca llega a mirar sesión", async () => {
    const res = await POST(peticionFormulario({ origin: null, cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(403);
    expect(obtenerOCrearUsuarioActual).not.toHaveBeenCalled();
  });

  it("Referer del origen propio alcanza cuando no hay Origin (mismo resultado que si coincidiera)", async () => {
    // Sin stub de fetch, subirClipItem (passthrough real) llegaría a
    // golpear la red real de Mercado Libre — esta prueba solo le
    // interesa la puerta del CSRF, así que corta antes con un fetch
    // mockeado cualquiera, nunca deja que la red real decida el
    // resultado de una prueba.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "accepted" }) }) as Response));

    const res = await POST(peticionFormulario({ origin: null, referer: `${ORIGEN_PROPIO}/panel/publicar/clip`, cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    // No se rechaza por CSRF — sigue de largo hasta la sesión real.
    expect(res.status).not.toBe(403);
    expect(obtenerOCrearUsuarioActual).toHaveBeenCalled();
  });

  it("sin sesión -> redirige a /sign-in, nunca sube", async () => {
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValueOnce(null as never);

    const res = await POST(peticionFormulario({ cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/sign-in");
    expect(subirClipItem).not.toHaveBeenCalled();
  });

  it('sin permiso "modificar" -> error=sin_permiso, nunca sube', async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("inventario", "modificar"));

    const res = await POST(peticionFormulario({ cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/panel/publicar/clip");
    expect(codigoDeError(location)).toBe("sin_permiso");
    expect(subirClipItem).not.toHaveBeenCalled();
  });

  it("content-length por encima de 280MB + margen -> error=demasiado_grande (redirect, nunca JSON)", async () => {
    const res = await POST(peticionFormulario({ contentLength: String(TAMANO_MAXIMO_CLIP_BYTES + 10 * 1024 * 1024), cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(303);
    expect(codigoDeError(res.headers.get("location") ?? "")).toBe("demasiado_grande");
    expect(subirClipItem).not.toHaveBeenCalled();
  });

  it("content-length ausente -> error=demasiado_grande (nunca se asume 0 ni se sigue de largo)", async () => {
    const res = await POST(peticionFormulario({ contentLength: null, cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(303);
    expect(codigoDeError(res.headers.get("location") ?? "")).toBe("demasiado_grande");
    expect(subirClipItem).not.toHaveBeenCalled();
  });

  it("content-length no numérico -> error=demasiado_grande", async () => {
    const res = await POST(peticionFormulario({ contentLength: "no-es-un-numero", cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(303);
    expect(codigoDeError(res.headers.get("location") ?? "")).toBe("demasiado_grande");
  });

  it("cuentaId que no es UUID -> error=cuenta_invalida, nunca toca la base", async () => {
    const res = await POST(peticionFormulario({ cuentaId: "no-es-un-uuid", itemId: ITEM_VALIDO }));

    expect(res.status).toBe(303);
    expect(codigoDeError(res.headers.get("location") ?? "")).toBe("cuenta_invalida");
    expect(listarCuentasConectadas).not.toHaveBeenCalled();
    expect(obtenerAccessTokenVigente).not.toHaveBeenCalled();
    expect(subirClipItem).not.toHaveBeenCalled();
  });

  it("itemId inválido -> error=item_invalido (validación real de PATRON_ID_PRODUCTO_O_ITEM), nunca toca la base", async () => {
    const res = await POST(peticionFormulario({ cuentaId: CUENTA_ID_VALIDA, itemId: "MCO1/../users/me" }));

    expect(res.status).toBe(303);
    expect(codigoDeError(res.headers.get("location") ?? "")).toBe("item_invalido");
    expect(listarCuentasConectadas).not.toHaveBeenCalled();
    expect(subirClipItem).not.toHaveBeenCalled();
  });

  it("cuentaId con formato válido pero que no es de esta empresa -> error=cuenta_invalida", async () => {
    vi.mocked(listarCuentasConectadas).mockResolvedValueOnce([]);

    const res = await POST(peticionFormulario({ cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(303);
    expect(codigoDeError(res.headers.get("location") ?? "")).toBe("cuenta_invalida");
    expect(obtenerAccessTokenVigente).not.toHaveBeenCalled();
  });

  it("cuenta desconectada -> error=cuenta_desconectada, nunca pide el token", async () => {
    vi.mocked(listarCuentasConectadas).mockResolvedValueOnce([
      { id: CUENTA_ID_VALIDA, cuentaIdExterna: "123456", nickname: "VENDEDOR", desconectadaTs: new Date(), creadoTs: new Date() } as never,
    ]);

    const res = await POST(peticionFormulario({ cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(303);
    expect(codigoDeError(res.headers.get("location") ?? "")).toBe("cuenta_desconectada");
    expect(obtenerAccessTokenVigente).not.toHaveBeenCalled();
  });

  it("falta de permiso puntual (reputación) -> error=reputacion_requerida, nunca el mensaje largo real en la URL", async () => {
    vi.mocked(subirClipItem).mockRejectedValueOnce(
      new ClipReputacionRequeridaError(
        "Mercado Libre no deja subir Clips en esta cuenta todavía — necesita tener un color de reputación asignado (se gana con ventas reales)."
      )
    );

    const res = await POST(peticionFormulario({ cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));
    const location = res.headers.get("location") ?? "";

    expect(res.status).toBe(303);
    expect(codigoDeError(location)).toBe("reputacion_requerida");
    expect(location).not.toContain("color de reputaci");
  });

  it("Mercado Libre rechaza con el detalle crudo -> redirige con el código, la URL NUNCA contiene ese texto crudo", async () => {
    const detalleCrudoSensible = "DETALLE_CRUDO_QUE_NUNCA_TIENE_QUE_APARECER_EN_LA_URL_12345";
    vi.mocked(subirClipItem).mockRejectedValueOnce(new ClipRechazadoError(`Mercado Libre rechazó el video (HTTP 400): ${detalleCrudoSensible}`));

    const res = await POST(peticionFormulario({ cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));
    const location = res.headers.get("location") ?? "";

    expect(res.status).toBe(303);
    expect(codigoDeError(location)).toBe("rechazado_ml");
    expect(location).not.toContain(detalleCrudoSensible);
    expect(location).not.toContain("HTTP 400");
  });

  it("caso feliz: valida el archivo, pide el token y llama de verdad a subirClipMl (fetch) hasta el final", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "accepted", clip_uuid: "clip-1", site_ids: ["MCO"] }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(peticionFormulario({ cuentaId: CUENTA_ID_VALIDA, itemId: ITEM_VALIDO }));

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/panel/publicar/clip");
    expect(location).toContain("clipSubido=1");
    expect(subirClipItem).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/marketplace/items/${ITEM_VALIDO}/clips/upload`);
  });
});
