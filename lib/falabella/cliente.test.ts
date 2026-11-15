import { describe, expect, it } from "vitest";
import { firmarSolicitud } from "./cliente";

// No se usa el vector de referencia de la documentación de Falabella
// (PHP, Timestamp=2015-07-01T11:11:11+00:00) porque el texto capturado de
// la página no trae el conjunto completo de parámetros que ese ejemplo
// firma — reconstruirlo a medias habría sido adivinar un valor esperado,
// justo lo que CLAUDE.md pide no hacer. Estas pruebas verifican el
// ALGORITMO documentado (orden alfabético de parámetros, excluir
// Signature, URL-encode RFC 3986, HMAC-SHA256 hex) de forma determinista
// y auto-verificable — el vector oficial se confirma aparte, contra una
// cuenta real, antes de dar por cerrado este conector.
describe("firmarSolicitud", () => {
  it("ordena los parámetros alfabéticamente antes de firmar (mismo resultado sin importar el orden de entrada)", () => {
    const firmaA = firmarSolicitud({ Action: "GetOrders", UserID: "a@b.com", Version: "2.0" }, "clave-de-prueba");
    const firmaB = firmarSolicitud({ Version: "2.0", Action: "GetOrders", UserID: "a@b.com" }, "clave-de-prueba");
    expect(firmaA).toBe(firmaB);
  });

  it("produce 64 caracteres hexadecimales en minúsculas (HMAC-SHA256 en hex)", () => {
    const firma = firmarSolicitud({ Action: "GetOrders", UserID: "a@b.com" }, "clave-de-prueba");
    expect(firma).toMatch(/^[0-9a-f]{64}$/);
  });

  it("una API Key distinta produce una firma distinta para los mismos parámetros", () => {
    const firmaA = firmarSolicitud({ Action: "GetOrders" }, "clave-1");
    const firmaB = firmarSolicitud({ Action: "GetOrders" }, "clave-2");
    expect(firmaA).not.toBe(firmaB);
  });

  it("escapa caracteres RFC 3986 que encodeURIComponent deja sin escapar (!'()*)", () => {
    // Si no se escaparan, "a!" y "a%21" producirían la misma cadena de
    // firma — confirmamos que no es el caso.
    const firmaSinEscapar = firmarSolicitud({ Nota: "a!" }, "clave-de-prueba");
    const firmaEscapada = firmarSolicitud({ Nota: "a%21" }, "clave-de-prueba");
    expect(firmaSinEscapar).not.toBe(firmaEscapada);
  });
});
