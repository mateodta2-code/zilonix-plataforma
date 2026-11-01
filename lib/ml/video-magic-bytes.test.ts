import { describe, expect, it } from "vitest";
import { tipoVideoPorMagicBytes } from "./video-magic-bytes";

function bufferFtyp(marca: string, bytesExtra = 20): Buffer {
  const buffer = Buffer.alloc(12 + bytesExtra);
  buffer.write("ftyp", 4, "ascii");
  buffer.write(marca.padEnd(4, " ").slice(0, 4), 8, "ascii");
  return buffer;
}

function bufferRiff(codigo: string, bytesExtra = 20): Buffer {
  const buffer = Buffer.alloc(12 + bytesExtra);
  buffer.write("RIFF", 0, "ascii");
  buffer.write(codigo.padEnd(4, " ").slice(0, 4), 8, "ascii");
  return buffer;
}

describe("tipoVideoPorMagicBytes — Parte Clip (video)", () => {
  it("reconoce MP4 real (ftyp con marca isom/mp42/MSNV, etc.)", () => {
    expect(tipoVideoPorMagicBytes(bufferFtyp("isom"))).toBe("video/mp4");
    expect(tipoVideoPorMagicBytes(bufferFtyp("mp42"))).toBe("video/mp4");
    expect(tipoVideoPorMagicBytes(bufferFtyp("MSNV"))).toBe("video/mp4");
  });

  it("reconoce MOV real (ftyp con marca qt)", () => {
    expect(tipoVideoPorMagicBytes(bufferFtyp("qt"))).toBe("video/quicktime");
  });

  it("reconoce AVI real (RIFF....AVI )", () => {
    expect(tipoVideoPorMagicBytes(bufferRiff("AVI"))).toBe("video/x-msvideo");
  });

  it("reconoce MPEG real (pack header 00 00 01 BA)", () => {
    const buffer = Buffer.from([0x00, 0x00, 0x01, 0xba, 0x01, 0x02]);
    expect(tipoVideoPorMagicBytes(buffer)).toBe("video/mpeg");
  });

  it("nunca confunde WEBP (RIFF....WEBP) con AVI — códigos de 4 letras distintos", () => {
    expect(tipoVideoPorMagicBytes(bufferRiff("WEBP"))).toBeNull();
  });

  it("un archivo de texto cualquiera (sin ninguna firma real): null", () => {
    const texto = Buffer.from("esto es texto plano, no un video de verdad", "utf8");
    expect(tipoVideoPorMagicBytes(texto)).toBeNull();
  });

  it("buffer vacío o muy corto: null, nunca lanza", () => {
    expect(tipoVideoPorMagicBytes(Buffer.from([]))).toBeNull();
    expect(tipoVideoPorMagicBytes(Buffer.from([0x00, 0x00]))).toBeNull();
  });
});
