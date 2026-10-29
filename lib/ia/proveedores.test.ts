import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// HIGH 3 (review de Pablo) — "otro_compatible_openai" revalida https +
// IP pública (lib/seguridad/ssrf.ts) justo antes de cada fetch real.
// Mismo patrón de mock que lib/ml/video-externo.test.ts: dns/promises
// con una IP pública por defecto, para que los casos existentes
// (otro_compatible_openai con una baseUrl normal) sigan pasando sin
// tocar DNS de verdad — los casos negativos pisan ese default.
vi.mock("dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "dns/promises";
import { ErrorProveedorIA, llamarIA } from "./proveedores";
import type { ConexionIAConClave } from "./tipos";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

function respuestaJson(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function conexion(overrides: Partial<ConexionIAConClave> = {}): ConexionIAConClave {
  return { id: "c1", proveedor: "anthropic", baseUrl: null, modelo: "claude-sonnet-5", actualizadoTs: new Date(), apiKey: "clave-real", ...overrides };
}

// Rama feat-promociones, punto 6 — cada proveedor habla el contrato
// PÚBLICO documentado de su propia API (nunca adivinado). Estas
// pruebas confirman el dispatch y la forma real de cada petición,
// nunca llaman a un proveedor real.
describe("llamarIA — dispatch por proveedor (rama feat-promociones)", () => {
  beforeEach(() => lookupMock.mockResolvedValue([{ address: "203.0.113.10" }])); // IP pública por defecto (TEST-NET-3, RFC 5737)
  afterEach(() => vi.unstubAllGlobals());

  it("anthropic — Messages API, x-api-key, thinking deshabilitado", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ content: [{ text: "Resumen real." }] }));
    vi.stubGlobal("fetch", fetchMock);
    const texto = await llamarIA(conexion({ proveedor: "anthropic", modelo: "claude-sonnet-5" }), "hola");
    expect(texto).toBe("Resumen real.");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("clave-real");
    const body = JSON.parse(init?.body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.model).toBe("claude-sonnet-5");
  });

  it("openai — Chat Completions, Authorization Bearer", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ choices: [{ message: { content: "Resumen OpenAI." } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const texto = await llamarIA(conexion({ proveedor: "openai", modelo: "gpt-5" }), "hola");
    expect(texto).toBe("Resumen OpenAI.");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer clave-real");
  });

  it("xai — mismo formato que OpenAI, host distinto", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ choices: [{ message: { content: "Resumen xAI." } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const texto = await llamarIA(conexion({ proveedor: "xai", modelo: "grok" }), "hola");
    expect(texto).toBe("Resumen xAI.");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
  });

  it("otro_compatible_openai — usa la baseUrl configurada (sin barra final duplicada)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ choices: [{ message: { content: "Resumen propio." } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const texto = await llamarIA(conexion({ proveedor: "otro_compatible_openai", baseUrl: "https://mi-servidor.test/v1/", modelo: "mi-modelo" }), "hola");
    expect(texto).toBe("Resumen propio.");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://mi-servidor.test/v1/chat/completions");
  });

  it("otro_compatible_openai sin baseUrl: ErrorProveedorIA, nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(llamarIA(conexion({ proveedor: "otro_compatible_openai", baseUrl: null }), "hola")).rejects.toBeInstanceOf(ErrorProveedorIA);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // HIGH 3 (review de Pablo) — la baseUrl ya se validó al guardar la
  // conexión, pero se revalida OTRA VEZ acá: el DNS puede cambiar entre
  // medio (DNS rebinding), y esto es lo único que corre justo antes de
  // cada fetch real.
  it("otro_compatible_openai con http (no https): ErrorProveedorIA, nunca llama a fetch ni a dns", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(llamarIA(conexion({ proveedor: "otro_compatible_openai", baseUrl: "http://mi-servidor.test/v1" }), "hola")).rejects.toBeInstanceOf(ErrorProveedorIA);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("otro_compatible_openai cuyo hostname resuelve a una IP privada: ErrorProveedorIA, nunca llama a fetch (SSRF)", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254" }]); // IP de metadata de nube — el blanco clásico de un SSRF
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(llamarIA(conexion({ proveedor: "otro_compatible_openai", baseUrl: "https://interno.test/v1" }), "hola")).rejects.toBeInstanceOf(ErrorProveedorIA);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("otro_compatible_openai cuyo hostname no resuelve: ErrorProveedorIA, nunca llama a fetch", async () => {
    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(llamarIA(conexion({ proveedor: "otro_compatible_openai", baseUrl: "https://no-existe.test/v1" }), "hola")).rejects.toBeInstanceOf(ErrorProveedorIA);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Re-review de Pablo — HIGH: SSRF por redirect. exigirUrlBaseIASegura
  // valida el host de la baseUrl guardada, pero un fetch con
  // redirect:"follow" (el default) seguiría a ciegas un 3xx hacia
  // cualquier otro host sin volver a pasar por esa validación — mismo
  // criterio que lib/ml/video-externo.ts.
  it("otro_compatible_openai pide redirect:'manual' en el fetch real, nunca el default 'follow'", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await llamarIA(conexion({ proveedor: "otro_compatible_openai", baseUrl: "https://mi-servidor.test/v1" }), "hola");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).redirect).toBe("manual");
  });

  it("otro_compatible_openai cuyo fetch responde un redirect (302): ErrorProveedorIA, nunca un segundo fetch siguiéndolo", async () => {
    const fetchMock = vi.fn(async () => respuestaJson({}, 302));
    vi.stubGlobal("fetch", fetchMock);
    await expect(llamarIA(conexion({ proveedor: "otro_compatible_openai", baseUrl: "https://mi-servidor.test/v1" }), "hola")).rejects.toBeInstanceOf(ErrorProveedorIA);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("otro_compatible_openai cuyo fetch responde 'opaqueredirect' (undici real con redirect:'manual'): ErrorProveedorIA, nunca un segundo fetch", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 0, type: "opaqueredirect", json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    await expect(llamarIA(conexion({ proveedor: "otro_compatible_openai", baseUrl: "https://mi-servidor.test/v1" }), "hola")).rejects.toBeInstanceOf(ErrorProveedorIA);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("otro_compatible_openai con pathname + barra final: la URL real nunca lleva '//' duplicado antes de /chat/completions", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await llamarIA(conexion({ proveedor: "otro_compatible_openai", baseUrl: "https://mi-servidor.test/v1/" }), "hola");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://mi-servidor.test/v1/chat/completions");
  });

  it("google — generateContent, la key va en la query, nunca en un header", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ candidates: [{ content: { parts: [{ text: "Resumen Google." }] } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const texto = await llamarIA(conexion({ proveedor: "google", modelo: "gemini-2.5" }), "hola");
    expect(texto).toBe("Resumen Google.");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("key=clave-real");
    expect((init?.headers as Record<string, string> | undefined)?.["x-api-key"]).toBeUndefined();
  });

  it("respuesta no-ok de cualquier proveedor: ErrorProveedorIA, nunca el texto crudo expuesto sin filtrar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ error: "clave inválida" }, 401)));
    await expect(llamarIA(conexion(), "hola")).rejects.toBeInstanceOf(ErrorProveedorIA);
  });

  it("falla de red: ErrorProveedorIA, nunca una excepción cruda sin filtrar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("red caída"); }));
    await expect(llamarIA(conexion(), "hola")).rejects.toBeInstanceOf(ErrorProveedorIA);
  });
});
