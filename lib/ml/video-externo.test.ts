import { existsSync, readFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "dns/promises";
import {
  descargarVideoExternoSeguro,
  escribirCuerpoEnArchivoConTope,
  hostPermitidoVideo,
  TAMANO_MAXIMO_VIDEO_EXTERNO_BYTES,
  VideoExternoDemasiadoGrandeError,
  VideoExternoInvalidoError,
  VideoExternoNoDisponibleError,
  VideoExternoNoPermitidoError,
  VideoExternoTipoInvalidoError,
} from "./video-externo";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

// Mismo patrón que validar-url-externa.test.ts (fotos) — un stream real
// de fetch simulado, entregando los chunks pasados uno por uno.
function respuestaConStream(chunks: Uint8Array[], opciones: { contentType?: string; contentLength?: string; status?: number } = {}) {
  let indice = 0;
  const reader = {
    read: async () => {
      if (indice >= chunks.length) return { done: true, value: undefined };
      const value = chunks[indice];
      indice += 1;
      return { done: false, value };
    },
    cancel: async () => {
      indice = chunks.length;
    },
  };
  return {
    ok: (opciones.status ?? 200) < 300,
    status: opciones.status ?? 200,
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase();
        if (key === "content-type") return opciones.contentType ?? "video/mp4";
        if (key === "content-length") return opciones.contentLength ?? null;
        return null;
      },
    },
    body: { getReader: () => reader },
  } as unknown as Response;
}

function respuestaRedirect(location: string) {
  return {
    ok: false,
    status: 302,
    headers: { get: (k: string) => (k.toLowerCase() === "location" ? location : null) },
    body: null,
  } as unknown as Response;
}

function bufferFtypMp4(bytesExtra = 1024): Uint8Array {
  const buffer = new Uint8Array(12 + bytesExtra);
  buffer.set([0, 0, 0, 0x18], 0);
  buffer.set(Buffer.from("ftyp", "ascii"), 4);
  buffer.set(Buffer.from("isom", "ascii"), 8);
  return buffer;
}

describe("hostPermitidoVideo — allowlist", () => {
  it("acepta el host exacto de Canva export y cualquier subdominio de canva.com", () => {
    expect(hostPermitidoVideo("export-download.canva.com")).toBe(true);
    expect(hostPermitidoVideo("media.canva.com")).toBe(true);
  });

  it("acepta los CDN de los 6 marketplaces", () => {
    expect(hostPermitidoVideo("http2.mlstatic.com")).toBe(true);
    expect(hostPermitidoVideo("m.media-amazon.com")).toBe(true);
    expect(hostPermitidoVideo("img.kwcdn.com")).toBe(true);
    expect(hostPermitidoVideo("ae-pic-a1.aliexpress-media.com")).toBe(true);
    expect(hostPermitidoVideo("img.alicdn.com")).toBe(true);
    expect(hostPermitidoVideo("img.ltwebstatic.com")).toBe(true);
  });

  it("rechaza un host que solo CONTIENE el nombre real (spoofing real: evilmlstatic.com, mlstatic.com.evil.com)", () => {
    expect(hostPermitidoVideo("evilmlstatic.com")).toBe(false);
    expect(hostPermitidoVideo("mlstatic.com.evil.com")).toBe(false);
    expect(hostPermitidoVideo("notcanva.com")).toBe(false);
  });

  it("rechaza un dominio ajeno cualquiera", () => {
    expect(hostPermitidoVideo("evil.com")).toBe(false);
  });
});

describe("descargarVideoExternoSeguro — anti-SSRF + streaming a disco", () => {
  const archivosCreados: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    lookupMock.mockReset();
    for (const ruta of archivosCreados.splice(0)) {
      try {
        require("fs").rmSync(ruta, { force: true });
      } catch {
        // ya borrado — ok
      }
    }
  });

  it("texto que no es una URL: VideoExternoInvalidoError, nunca llama a dns/fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(descargarVideoExternoSeguro("no es un link")).rejects.toThrow(VideoExternoInvalidoError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("http (no https): VideoExternoInvalidoError, nunca resuelve DNS", async () => {
    await expect(descargarVideoExternoSeguro("http://img.kwcdn.com/video.mp4")).rejects.toThrow(VideoExternoInvalidoError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("host fuera de la allowlist: VideoExternoNoPermitidoError, nunca resuelve DNS ni llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(descargarVideoExternoSeguro("https://evil.com/video.mp4")).rejects.toThrow(VideoExternoNoPermitidoError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("DNS no resuelve: VideoExternoNoDisponibleError", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(descargarVideoExternoSeguro("https://img.kwcdn.com/video.mp4")).rejects.toThrow(VideoExternoNoDisponibleError);
  });

  it("host permitido que resuelve a una IP privada: VideoExternoNoPermitidoError", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5" }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(descargarVideoExternoSeguro("https://img.kwcdn.com/video.mp4")).rejects.toThrow(VideoExternoNoPermitidoError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirect hacia un host FUERA de la allowlist: nunca se sigue, VideoExternoNoPermitidoError", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaRedirect("https://evil.com/robado.mp4")));
    await expect(descargarVideoExternoSeguro("https://img.kwcdn.com/video.mp4")).rejects.toThrow(VideoExternoNoPermitidoError);
  });

  it("más de 5 redirects: VideoExternoNoPermitidoError, nunca sigue indefinidamente", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    let llamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        llamadas += 1;
        return respuestaRedirect(`https://img.kwcdn.com/salto-${llamadas}.mp4`);
      })
    );
    await expect(descargarVideoExternoSeguro("https://img.kwcdn.com/video.mp4")).rejects.toThrow(VideoExternoNoPermitidoError);
    expect(llamadas).toBeLessThanOrEqual(6);
  });

  it("redirect real hacia un host SÍ permitido: se sigue y descarga bien", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    let llamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        llamadas += 1;
        if (llamadas === 1) return respuestaRedirect("https://export-download.canva.com/video-final.mp4");
        return respuestaConStream([bufferFtypMp4()]);
      })
    );
    const resultado = await descargarVideoExternoSeguro("https://img.kwcdn.com/video.mp4");
    archivosCreados.push(resultado.rutaArchivo);
    expect(resultado.contentType).toBe("video/mp4");
    expect(existsSync(resultado.rutaArchivo)).toBe(true);
  });

  it("Content-Type declarado no es video (ej. text/html de una página de error): VideoExternoTipoInvalidoError", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaConStream([bufferFtypMp4()], { contentType: "text/html" })));
    await expect(descargarVideoExternoSeguro("https://img.kwcdn.com/pagina")).rejects.toThrow(VideoExternoTipoInvalidoError);
  });

  it("content-length declarado por encima del tope: VideoExternoDemasiadoGrandeError, antes de leer el cuerpo", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaConStream([bufferFtypMp4()], { contentLength: String(TAMANO_MAXIMO_VIDEO_EXTERNO_BYTES + 1024) }))
    );
    await expect(descargarVideoExternoSeguro("https://img.kwcdn.com/gigante.mp4")).rejects.toThrow(VideoExternoDemasiadoGrandeError);
  });

  // escribirCuerpoEnArchivoConTope está parametrizada con `topeBytes`
  // justo para esto — probar el corte real por streaming con un tope
  // CHICO, nunca con el real de 280MB (sería lento sin necesidad: la
  // lógica de corte es la misma, no depende del tamaño del tope).
  it("escribirCuerpoEnArchivoConTope: sin content-length, el stream real supera el tope — corta, borra el archivo parcial, VideoExternoDemasiadoGrandeError", async () => {
    const path = require("path") as typeof import("path");
    const os = require("os") as typeof import("os");
    const crypto = require("crypto") as typeof import("crypto");
    const ruta = path.join(os.tmpdir(), `zilonix-clip-test-${crypto.randomUUID()}.tmp`);
    const chunk = new Uint8Array(600);
    const res = respuestaConStream([chunk, chunk], { contentLength: undefined });
    await expect(escribirCuerpoEnArchivoConTope(res, ruta, 1000)).rejects.toThrow(VideoExternoDemasiadoGrandeError);
    expect(existsSync(ruta)).toBe(false);
  });

  it("escribirCuerpoEnArchivoConTope: dentro del tope, escribe el archivo completo", async () => {
    const path = require("path") as typeof import("path");
    const os = require("os") as typeof import("os");
    const crypto = require("crypto") as typeof import("crypto");
    const ruta = path.join(os.tmpdir(), `zilonix-clip-test-${crypto.randomUUID()}.tmp`);
    archivosCreados.push(ruta);
    const chunk = new Uint8Array(500);
    const res = respuestaConStream([chunk, chunk], { contentLength: undefined });
    await escribirCuerpoEnArchivoConTope(res, ruta, 10_000);
    expect(existsSync(ruta)).toBe(true);
    expect(readFileSync(ruta).byteLength).toBe(1000);
  });

  it("firma binaria falsa (Content-Type dice video/mp4 pero el contenido real no tiene firma real): VideoExternoTipoInvalidoError, borra el archivo", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    const textoPlano = new Uint8Array(Buffer.from("esto es texto plano, no un video de verdad", "utf8"));
    vi.stubGlobal("fetch", vi.fn(async () => respuestaConStream([textoPlano])));
    await expect(descargarVideoExternoSeguro("https://img.kwcdn.com/disfrazado.mp4")).rejects.toThrow(VideoExternoTipoInvalidoError);
  });

  it("descarga real OK: devuelve la ruta del archivo con el contenido real y el tamaño real", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    const contenido = bufferFtypMp4(500);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaConStream([contenido])));
    const resultado = await descargarVideoExternoSeguro("https://img.kwcdn.com/video.mp4");
    archivosCreados.push(resultado.rutaArchivo);
    expect(resultado.contentType).toBe("video/mp4");
    expect(resultado.byteLength).toBe(contenido.byteLength);
    expect(existsSync(resultado.rutaArchivo)).toBe(true);
    expect(readFileSync(resultado.rutaArchivo).byteLength).toBe(contenido.byteLength);
  });
});
