import { afterEach, describe, expect, it, vi } from "vitest";
import { elegirRecomendado, ERRORES_MODELOS_IA, listarModelosProveedor } from "./modelos";

const KEY = "clave-secreta-123";
const respuesta = (cuerpo: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
const fetchMock = vi.fn();
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});
const usar = (...r: unknown[]) => {
  r.forEach((x) => fetchMock.mockResolvedValueOnce(x));
  vi.stubGlobal("fetch", fetchMock);
};

describe("listarModelosProveedor", () => {
  it("OpenAI: Bearer, filtra no-texto y pone el recomendado primero", async () => {
    usar(respuesta({ data: ["text-embedding-3", "whisper-1", "tts-1", "omni-moderation", "gpt-4o-audio", "zeta", "gpt-5-mini", "gpt-6.2-sol", "gpt-6.2-sol"].map((id) => ({ id })) }));
    const r = await listarModelosProveedor("openai", KEY);
    expect(r).toEqual({ ok: true, modelos: ["gpt-6.2-sol", "gpt-5-mini", "zeta"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });
  it("Anthropic: cabeceras y paginación", async () => {
    usar(respuesta({ data: [{ id: "claude-b" }], has_more: true, last_id: "claude-b" }), respuesta({ data: [{ id: "claude-a" }], has_more: false }));
    const r = await listarModelosProveedor("anthropic", KEY);
    expect(r).toEqual({ ok: true, modelos: ["claude-a", "claude-b"] });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "x-api-key": KEY, "anthropic-version": "2023-06-01" });
    expect(fetchMock.mock.calls[1][0]).toContain("after_id=claude-b");
  });
  it("Google: clave en cabecera, nunca en la URL; solo generateContent", async () => {
    usar(
      respuesta({
        models: [
          { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          { name: "models/gemini-live-x", supportedGenerationMethods: ["generateContent"] },
        ],
      })
    );
    const r = await listarModelosProveedor("google", KEY);
    expect(r).toEqual({ ok: true, modelos: ["gemini-3.8-flash"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain(KEY);
    expect(url).not.toContain("key=");
    expect(init.headers["x-goog-api-key"]).toBe(KEY);
  });
  it("xAI: Bearer al endpoint de xAI", async () => {
    usar(respuesta({ data: [{ id: "grok-4.7" }] }));
    expect(await listarModelosProveedor("xai", KEY)).toEqual({ ok: true, modelos: ["grok-4.7"] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.x.ai/v1/models");
  });
  it("otro compatible no consulta nada", async () => {
    vi.stubGlobal("fetch", fetchMock);
    expect(await listarModelosProveedor("otro_compatible_openai", KEY)).toEqual({ ok: false, error: "manual" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [401, "clave"],
    [402, "saldo"],
    [429, "saldo"],
    [500, "red"],
  ])("estado %i → %s, mensaje fijo sin la clave", async (status, error) => {
    usar(respuesta({ error: KEY }, status));
    const r = await listarModelosProveedor("openai", KEY);
    expect(r).toEqual({ ok: false, error });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(ERRORES_MODELOS_IA[error as keyof typeof ERRORES_MODELOS_IA]).not.toContain(KEY);
  });
  it("timeout → red; lista vacía tras el filtro → vacia", async () => {
    vi.stubGlobal("fetch", fetchMock.mockRejectedValueOnce(new Error(`timeout ${KEY}`)));
    expect(await listarModelosProveedor("openai", KEY)).toEqual({ ok: false, error: "red" });
    usar(respuesta({ data: [{ id: "whisper-1" }] }));
    expect(await listarModelosProveedor("openai", KEY)).toEqual({ ok: false, error: "vacia" });
  });
});

describe("elegirRecomendado", () => {
  it("usa el primero que exista y si no, el primero de la lista", () => {
    expect(elegirRecomendado("openai", ["a", "gpt-5-mini", "gpt-6-luna"])).toBe("gpt-6-luna");
    expect(elegirRecomendado("openai", ["a", "b"])).toBe("a");
  });
});
