import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "dns/promises";
import {
  descargarImagenExternaSegura,
  hostPermitidoCanva,
  UrlExternaDemasiadoGrandeError,
  UrlExternaInvalidaError,
  UrlExternaNoDisponibleError,
  UrlExternaNoPermitidaError,
  UrlExternaTipoInvalidoError,
} from "./validar-url-externa";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

function respuestaImagen(bytes: number, contentType = "image/jpeg", status = 200) {
  const buffer = new Uint8Array(bytes).buffer;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : k.toLowerCase() === "content-length" ? String(bytes) : null) },
    arrayBuffer: async () => buffer,
  } as unknown as Response;
}

describe("hostPermitidoCanva — Parte 3, punto C (allowlist de Canva)", () => {
  it("acepta el CDN de medios exacto", () => {
    expect(hostPermitidoCanva("media.canva.com")).toBe(true);
  });

  it("acepta cualquier subdominio de canvausercontent.com", () => {
    expect(hostPermitidoCanva("export-download.canvausercontent.com")).toBe(true);
  });

  it("rechaza el dominio de compartir el diseño (canva.com, sin el subdominio de medios)", () => {
    expect(hostPermitidoCanva("www.canva.com")).toBe(false);
    expect(hostPermitidoCanva("canva.com")).toBe(false);
  });

  it("rechaza un host que solo CONTIENE el nombre permitido (ej. malicioso-media.canva.com.ataque.com)", () => {
    expect(hostPermitidoCanva("media.canva.com.ataque.com")).toBe(false);
  });

  it("no distingue mayúsculas/minúsculas", () => {
    expect(hostPermitidoCanva("MEDIA.CANVA.COM")).toBe(true);
  });
});

describe("descargarImagenExternaSegura — anti-SSRF", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lookupMock.mockReset();
  });

  it("texto que no es una URL: UrlExternaInvalidaError, nunca llama a dns/fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(descargarImagenExternaSegura("no es una url")).rejects.toThrow(UrlExternaInvalidaError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("http (no https): UrlExternaInvalidaError, nunca llega a resolver DNS", async () => {
    await expect(descargarImagenExternaSegura("http://media.canva.com/foto.png")).rejects.toThrow(UrlExternaInvalidaError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("host fuera del allowlist: UrlExternaNoPermitidaError, nunca resuelve DNS ni llama a fetch (ej. el link de compartir el diseño)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(descargarImagenExternaSegura("https://www.canva.com/design/abc123/view")).rejects.toThrow(UrlExternaNoPermitidaError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("el host permitido resuelve a una IP privada (ej. DNS envenenado/interno): UrlExternaNoPermitidaError, nunca llama a fetch", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5" }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(descargarImagenExternaSegura("https://media.canva.com/foto.png")).rejects.toThrow(UrlExternaNoPermitidaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resuelve a la IP de metadata de nube (169.254.169.254): UrlExternaNoPermitidaError", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254" }]);
    await expect(descargarImagenExternaSegura("https://media.canva.com/foto.png")).rejects.toThrow(UrlExternaNoPermitidaError);
  });

  it("DNS no resuelve: UrlExternaNoDisponibleError", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(descargarImagenExternaSegura("https://media.canva.com/foto.png")).rejects.toThrow(UrlExternaNoDisponibleError);
  });

  it("IP pública real + descarga OK: devuelve buffer y content-type", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return respuestaImagen(1024, "image/png");
    }));
    const r = await descargarImagenExternaSegura("https://media.canva.com/foto.png");
    expect(r.contentType).toBe("image/png");
    expect(r.buffer.byteLength).toBe(1024);
  });

  it("content-type no es una imagen permitida (ej. text/html de una página de login): UrlExternaTipoInvalidoError", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaImagen(1024, "text/html")));
    await expect(descargarImagenExternaSegura("https://media.canva.com/pagina")).rejects.toThrow(UrlExternaTipoInvalidoError);
  });

  it("content-length declarado por encima del tope: UrlExternaDemasiadoGrandeError, antes de leer el cuerpo completo", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "image/jpeg" : k.toLowerCase() === "content-length" ? String(50 * 1024 * 1024) : null) },
        arrayBuffer: async () => {
          throw new Error("nunca debería leer el cuerpo si ya rechazó por content-length");
        },
      }) as unknown as Response)
    );
    await expect(descargarImagenExternaSegura("https://media.canva.com/gigante.jpg")).rejects.toThrow(UrlExternaDemasiadoGrandeError);
  });

  it("sin content-length declarado pero el cuerpo real supera el tope: UrlExternaDemasiadoGrandeError (nunca confía solo en el header)", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "image/jpeg" : null) },
        arrayBuffer: async () => new Uint8Array(11 * 1024 * 1024).buffer,
      }) as unknown as Response)
    );
    await expect(descargarImagenExternaSegura("https://media.canva.com/gigante.jpg")).rejects.toThrow(UrlExternaDemasiadoGrandeError);
  });

  it("5xx/tiempo agotado de la descarga real: UrlExternaNoDisponibleError", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaImagen(0, "image/jpeg", 503)));
    await expect(descargarImagenExternaSegura("https://media.canva.com/foto.jpg")).rejects.toThrow(UrlExternaNoDisponibleError);
  });
});
