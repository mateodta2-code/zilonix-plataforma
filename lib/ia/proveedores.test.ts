import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorProveedorIA, llamarIA } from "./proveedores";
import type { ConexionIAConClave } from "./tipos";

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
