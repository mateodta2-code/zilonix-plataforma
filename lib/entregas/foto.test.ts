import { describe, expect, it } from "vitest";
import { BYTES_MAXIMOS, esJpeg, validarFotoEntrega } from "./foto";

const jpeg = (largo = 10) => {
  const b = new Uint8Array(largo);
  b.set([0xff, 0xd8, 0xff]);
  return b;
};

describe("validarFotoEntrega (Domi-3)", () => {
  it("acepta un JPEG real", () => {
    expect(validarFotoEntrega(jpeg())).toBeNull();
  });

  it("sin foto, vacía, demasiado grande o que no es JPEG: mensaje para el domiciliario", () => {
    expect(validarFotoEntrega(null)).toMatch(/Toma la foto/);
    expect(validarFotoEntrega(new Uint8Array())).toMatch(/Toma la foto/);
    expect(validarFotoEntrega(jpeg(BYTES_MAXIMOS + 1))).toMatch(/pesa demasiado/);
    // Un PNG (o cualquier cosa) con nombre .jpg no pasa: se miran los bytes.
    expect(validarFotoEntrega(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toMatch(/no es una foto válida/);
  });

  it("esJpeg mira la firma FF D8 FF", () => {
    expect(esJpeg(jpeg())).toBe(true);
    expect(esJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });
});
