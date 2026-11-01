import { describe, expect, it } from "vitest";
import { enmascararCorreo, enmascararDocumento, enmascararWhatsapp } from "./enmascarar";

describe("enmascarar para bitácora (issue #125)", () => {
  it("el documento deja solo los últimos 4 dígitos", () => {
    const documento = "900.123.456-7";
    const enmascarado = enmascararDocumento(documento);
    expect(enmascarado).toBe("***4567");
    expect(enmascarado).not.toContain("9001234567");
    expect(enmascarado).not.toContain(documento);
  });

  it("un documento de 4 dígitos o menos no se copia entero", () => {
    expect(enmascararDocumento("1234")).toBe("****");
    expect(enmascararDocumento("12")).toBe("****");
  });

  it("el WhatsApp deja solo los últimos 4 dígitos", () => {
    const numero = "+57 300 111 2233";
    const enmascarado = enmascararWhatsapp(numero);
    expect(enmascarado).toBe("***2233");
    expect(enmascarado).not.toContain("573001112233");
    expect(enmascarado).not.toContain(numero);
  });

  it("el correo no queda en claro", () => {
    const correo = "contabilidad@zilonix.test";
    const enmascarado = enmascararCorreo(correo);
    expect(enmascarado).toBe("***test");
    expect(enmascarado).not.toContain(correo);
    expect(enmascarado).not.toContain("contabilidad");
  });
});
