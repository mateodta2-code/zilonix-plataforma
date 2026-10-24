import { randomBytes } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { cifrarTransferenciaPendiente, descifrarTransferenciaPendiente, type TransferenciaPendiente } from "./transferencia-cookie";

function claveDePrueba(): string {
  return randomBytes(32).toString("base64");
}

function pendienteDePrueba(): TransferenciaPendiente {
  return {
    cuentaIdExterna: "123456789",
    nickname: "VENDEDOR_TEST",
    tokens: { accessToken: "APP_USR-token-real", refreshToken: "TG-refresh-real", expiraEnSegundos: 21_600, cuentaIdExterna: "123456789" },
  };
}

// Issue #181 — regla explícita: nunca tokens en la URL ni en un log.
// Estas pruebas confirman que el valor que de verdad viaja en la
// cookie nunca trae el texto plano de ningún token, y que cifrar +
// descifrar vuelve exactamente a los mismos datos.
describe("cookie cifrada de transferencia pendiente (issue #181)", () => {
  beforeEach(() => {
    process.env.ML_TOKEN_KEY_V1 = claveDePrueba();
  });

  it("cifra y descifra el mismo pendiente", () => {
    const pendiente = pendienteDePrueba();
    const valorCookie = cifrarTransferenciaPendiente(pendiente);
    expect(descifrarTransferenciaPendiente(valorCookie)).toEqual(pendiente);
  });

  it("el valor cifrado nunca contiene el texto plano de los tokens ni del nickname", () => {
    const pendiente = pendienteDePrueba();
    const valorCookie = cifrarTransferenciaPendiente(pendiente);
    expect(valorCookie).not.toContain(pendiente.tokens.accessToken);
    expect(valorCookie).not.toContain(pendiente.tokens.refreshToken);
    expect(valorCookie).not.toContain(pendiente.nickname);
  });

  it("el valor cifrado es seguro para una cookie (solo base64: A-Za-z0-9+/=)", () => {
    const valorCookie = cifrarTransferenciaPendiente(pendienteDePrueba());
    expect(valorCookie).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("cookie corrupta o manipulada: null, nunca revienta la pantalla", () => {
    expect(descifrarTransferenciaPendiente("esto-no-es-una-cookie-valida")).toBeNull();
  });

  it("cookie vacía: null", () => {
    expect(descifrarTransferenciaPendiente("")).toBeNull();
  });
});
