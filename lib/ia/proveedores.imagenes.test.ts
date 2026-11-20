import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "dns/promises";
import { ErrorIASinVision, ErrorProveedorIA, llamarIAConImagenes } from "./proveedores";
import type { ConexionIAConClave } from "./tipos";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;
const img = [{ mediaType: "image/jpeg" as const, base64: "QUJD" }];

function res(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, type: "basic", json: async () => data } as Response;
}
function conexion(o: Partial<ConexionIAConClave> = {}): ConexionIAConClave {
  return { id: "c", proveedor: "anthropic", baseUrl: null, modelo: "m", actualizadoTs: new Date(), apiKey: "k", ...o };
}

describe("llamarIAConImagenes", () => {
  beforeEach(() => lookupMock.mockResolvedValue([{ address: "203.0.113.10" }]));
  afterEach(() => vi.unstubAllGlobals());

  it("anthropic — bloque image con source base64", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => res({ content: [{ text: "ok" }] }));
    vi.stubGlobal("fetch", f);
    expect(await llamarIAConImagenes(conexion(), "p", img)).toBe("ok");
    const body = JSON.parse(f.mock.calls[0]![1]!.body as string);
    expect(body.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
  });

  it.each([
    ["openai", "https://api.openai.com/v1/chat/completions"],
    ["xai", "https://api.x.ai/v1/chat/completions"],
  ] as const)("%s — image_url con data URL", async (proveedor, urlEsperada) => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => res({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", f);
    expect(await llamarIAConImagenes(conexion({ proveedor }), "p", img)).toBe("ok");
    expect(f.mock.calls[0]![0]).toBe(urlEsperada);
    const body = JSON.parse(f.mock.calls[0]![1]!.body as string);
    expect(body.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
  });

  it("compatible — redirect manual y un 3xx se rechaza", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => res({}, 302));
    vi.stubGlobal("fetch", f);
    await expect(llamarIAConImagenes(conexion({ proveedor: "otro_compatible_openai", baseUrl: "https://ia.ejemplo.com/v1" }), "p", img)).rejects.toThrow(ErrorProveedorIA);
    expect(f.mock.calls[0]![1]!.redirect).toBe("manual");
  });

  it("google — inline_data", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => res({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
    vi.stubGlobal("fetch", f);
    expect(await llamarIAConImagenes(conexion({ proveedor: "google" }), "p", img)).toBe("ok");
    const body = JSON.parse(f.mock.calls[0]![1]!.body as string);
    expect(body.contents[0].parts[1]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "QUJD" } });
  });

  it.each(["anthropic", "openai", "xai", "google"] as const)("%s — 400 = la IA no lee imágenes", async (proveedor) => {
    vi.stubGlobal("fetch", vi.fn(async () => res({}, 400)));
    await expect(llamarIAConImagenes(conexion({ proveedor }), "p", img)).rejects.toBeInstanceOf(ErrorIASinVision);
  });

  it("401 es un error normal del proveedor, no «sin visión»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({}, 401)));
    const e = await llamarIAConImagenes(conexion(), "p", img).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorProveedorIA);
    expect(e).not.toBeInstanceOf(ErrorIASinVision);
  });
});
