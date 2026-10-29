import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "dns/promises";
import {
  descargarImagenExternaSegura,
  hostPermitidoCanva,
  tipoImagenPorMagicBytes,
  UrlExternaDemasiadoGrandeError,
  UrlExternaInvalidaError,
  UrlExternaNoDisponibleError,
  UrlExternaNoPermitidaError,
  UrlExternaTipoInvalidoError,
} from "./validar-url-externa";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

// Firmas binarias REALES — para que los fixtures de "descarga OK" sean
// archivos que de verdad pasan tipoImagenPorMagicBytes, no un buffer
// vacío con un Content-Type declarado sin ninguna relación con el
// contenido (eso es justo lo que el hallazgo de seguridad pedía dejar
// de aceptar).
const FIRMAS_REALES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], // "RIFF"+tamaño+"WEBP"
};

function bufferConFirmaReal(bytes: number, tipo: string): ArrayBuffer {
  const arr = new Uint8Array(bytes);
  const firma = FIRMAS_REALES[tipo];
  if (firma) arr.set(firma.slice(0, Math.min(firma.length, bytes)));
  return arr.buffer;
}

function respuestaImagen(bytes: number, contentType = "image/jpeg", status = 200) {
  const buffer = bufferConFirmaReal(bytes, contentType);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : k.toLowerCase() === "content-length" ? String(bytes) : null) },
    arrayBuffer: async () => buffer,
  } as unknown as Response;
}

// Simula el stream real de fetch (res.body.getReader()) entregando los
// chunks pasados uno por uno — para probar que leerCuerpoConTope corta
// de verdad a mitad de la descarga, nunca espera a tenerlo todo en
// memoria para recién ahí medirlo.
function respuestaConStream(chunks: Uint8Array[], contentType = "image/jpeg") {
  let indice = 0;
  const reader = {
    read: async () => {
      if (indice >= chunks.length) return { done: true, value: undefined };
      const value = chunks[indice];
      indice += 1;
      return { done: false, value };
    },
    cancel: async () => {
      indice = chunks.length; // nunca entrega más chunks después de cancelar
    },
  };
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) }, // sin content-length a propósito
    body: { getReader: () => reader },
    arrayBuffer: async () => {
      throw new Error("nunca debería usar arrayBuffer() cuando hay un stream real (body.getReader)");
    },
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

  // Revisión de seguridad (hallazgo MED) — Content-Type declarado
  // "image/jpeg" pero el contenido real es texto plano (sin ninguna
  // firma binaria real): tiene que rechazarse por magic bytes, nunca
  // confiar en lo que el servidor DIJO que era.
  it("Content-Type dice image/jpeg pero el cuerpo real es texto plano (sin firma real): UrlExternaTipoInvalidoError", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    const textoPlano = Buffer.from("esto es texto plano, no una imagen de verdad", "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "image/jpeg" : k.toLowerCase() === "content-length" ? String(textoPlano.byteLength) : null) },
        arrayBuffer: async () => textoPlano.buffer.slice(textoPlano.byteOffset, textoPlano.byteOffset + textoPlano.byteLength),
      }) as unknown as Response)
    );
    await expect(descargarImagenExternaSegura("https://media.canva.com/disfrazado.jpg")).rejects.toThrow(UrlExternaTipoInvalidoError);
  });

  it("devuelve el content-type REAL confirmado por magic bytes, no necesariamente el declarado", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaImagen(1024, "image/webp")));
    const r = await descargarImagenExternaSegura("https://media.canva.com/foto.webp");
    expect(r.contentType).toBe("image/webp");
  });

  // Revisión de seguridad (hallazgo MED) — tope de bytes REAL: corta a
  // mitad del stream (nunca espera a leerlo todo en memoria primero),
  // y funciona aunque el servidor no mande content-length.
  it("sin content-length Y el stream real supera el tope a mitad de la descarga: UrlExternaDemasiadoGrandeError, corta el reader (nunca sigue leyendo)", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    const CHUNK_6MB = new Uint8Array(6 * 1024 * 1024);
    CHUNK_6MB.set([0xff, 0xd8, 0xff]); // firma JPEG real en el primer chunk
    const chunks = [CHUNK_6MB, new Uint8Array(6 * 1024 * 1024)]; // 6+6=12MB > tope de 10MB, a mitad del segundo chunk
    vi.stubGlobal("fetch", vi.fn(async () => respuestaConStream(chunks, "image/jpeg")));
    await expect(descargarImagenExternaSegura("https://media.canva.com/gigante-stream.jpg")).rejects.toThrow(UrlExternaDemasiadoGrandeError);
  });

  it("stream real dentro del tope: lo arma completo y confirma la firma real por magic bytes", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    const chunk1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // firma PNG completa
    const chunk2 = new Uint8Array(100); // resto del archivo, en un chunk separado
    vi.stubGlobal("fetch", vi.fn(async () => respuestaConStream([chunk1, chunk2], "image/png")));
    const r = await descargarImagenExternaSegura("https://media.canva.com/foto-por-stream.png");
    expect(r.contentType).toBe("image/png");
    expect(r.buffer.byteLength).toBe(chunk1.byteLength + chunk2.byteLength);
  });
});

describe("tipoImagenPorMagicBytes — revisión de seguridad (hallazgo MED): nunca confiar en el Content-Type declarado", () => {
  it("reconoce la firma real de JPEG (FF D8 FF)", () => {
    expect(tipoImagenPorMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10]))).toBe("image/jpeg");
  });

  it("reconoce la firma real de PNG (89 50 4E 47 0D 0A 1A 0A)", () => {
    expect(tipoImagenPorMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe("image/png");
  });

  it("reconoce la firma real de WEBP (RIFF....WEBP)", () => {
    const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    expect(tipoImagenPorMagicBytes(buffer)).toBe("image/webp");
  });

  it("un archivo de texto que DICE ser image/jpeg (sin ninguna firma real): null", () => {
    const textoPlano = Buffer.from("esto dice ser image/jpeg pero es solo texto", "utf8");
    expect(tipoImagenPorMagicBytes(textoPlano)).toBeNull();
  });

  it("buffer vacío o muy corto: null, nunca lanza", () => {
    expect(tipoImagenPorMagicBytes(Buffer.from([]))).toBeNull();
    expect(tipoImagenPorMagicBytes(Buffer.from([0xff, 0xd8]))).toBeNull(); // JPEG incompleto (faltan los 3 bytes completos)
  });

  it("firma de PNG incompleta (solo los primeros 4 bytes, sin el resto de la firma de 8): null — se exige la firma completa", () => {
    expect(tipoImagenPorMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});
