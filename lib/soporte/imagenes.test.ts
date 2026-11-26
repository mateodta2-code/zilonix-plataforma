import { describe, expect, it } from "vitest";
import { archivoDe, BYTES_MAXIMOS_CAPTURA, publicIdDe, validarImagenesTicket } from "./imagenes";

const E = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const jpeg = (n = 10) => {
  const b = new Uint8Array(n);
  b.set([0xff, 0xd8, 0xff]);
  return b;
};

describe("capturas de tickets", () => {
  it("el id se arma y se lee solo con la carpeta de esa empresa y ese ticket", () => {
    const id = publicIdDe(E, T, A);
    expect(id).toBe(`zilonix-soporte/${E}/${T}-${A}`);
    expect(archivoDe(id, E, T)).toBe(A);
    expect(archivoDe(id, T, T)).toBeNull();
    expect(archivoDe(id, E, A)).toBeNull();
    expect(archivoDe(`zilonix-entregas/${E}/${A}`, E, T)).toBeNull();
    expect(archivoDe(`zilonix-soporte/${E}/${T}-../../otro`, E, T)).toBeNull();
  });

  it("hasta 3 JPEG de máximo 3 MB", () => {
    expect(validarImagenesTicket([])).toBeNull();
    expect(validarImagenesTicket([jpeg(), jpeg(), jpeg()])).toBeNull();
    expect(validarImagenesTicket([jpeg(), jpeg(), jpeg(), jpeg()])).toMatch(/hasta 3/);
    expect(validarImagenesTicket([new Uint8Array([0x89, 0x50, 0x4e, 0x47])])).toMatch(/no es una imagen/);
    expect(validarImagenesTicket([jpeg(BYTES_MAXIMOS_CAPTURA + 1)])).toMatch(/pesa demasiado/);
    expect(validarImagenesTicket([new Uint8Array()])).toMatch(/vacía/);
  });
});
