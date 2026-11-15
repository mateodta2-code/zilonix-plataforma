import { afterEach, describe, expect, it, vi } from "vitest";
import { FalabellaApiError, FalabellaNoDisponibleError, firmarSolicitud, verificarCredenciales } from "./cliente";

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

describe("llamarFalabella / verificarCredenciales", () => {
  const credenciales = { userId: "a@b.com", apiKey: "clave-de-prueba", sellerId: "TIENDA_1" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respuestaJson(cuerpo: unknown) {
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  it("si Falabella rechaza la key (ErrorResponse), lanza FalabellaApiError — no se guarda nada", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuestaJson({ ErrorResponse: { Head: {}, ErrorCode: "7", ErrorMessage: "E007: Login failed. Signature mismatching" } })));
    await expect(verificarCredenciales(credenciales)).rejects.toBeInstanceOf(FalabellaApiError);
  });

  it("si Falabella acepta (SuccessResponse), no lanza", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuestaJson({ SuccessResponse: { Head: {}, Body: { Orders: [] } } })));
    await expect(verificarCredenciales(credenciales)).resolves.toBeUndefined();
  });

  it("una respuesta sin SuccessResponse ni ErrorResponse no se toma como éxito", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuestaJson({})));
    await expect(verificarCredenciales(credenciales)).rejects.toBeInstanceOf(FalabellaNoDisponibleError);
  });

  it("un 5xx o algo que no es JSON es 'Falabella no disponible', nunca 'credenciales inválidas'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 })));
    await expect(verificarCredenciales(credenciales)).rejects.toBeInstanceOf(FalabellaNoDisponibleError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>mantenimiento</html>", { status: 200 })));
    await expect(verificarCredenciales(credenciales)).rejects.toBeInstanceOf(FalabellaNoDisponibleError);
  });

  it("un timeout o error de red también es 'Falabella no disponible'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("tiempo agotado", "TimeoutError")));
    await expect(verificarCredenciales(credenciales)).rejects.toBeInstanceOf(FalabellaNoDisponibleError);
  });

  it("cada llamada lleva timeout y no sigue redirecciones", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaJson({ SuccessResponse: { Body: {} } }));
    vi.stubGlobal("fetch", fetchFalso);
    await verificarCredenciales(credenciales);
    const opciones = fetchFalso.mock.calls[0][1];
    expect(opciones.signal).toBeInstanceOf(AbortSignal);
    expect(opciones.redirect).toBe("error");
  });

  it("el User-Agent sigue el formato SELLER_ID/TECNOLOGÍA/VERSIÓN/TIPO_INTEGRACIÓN/CÓDIGO_PAÍS", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaJson({ SuccessResponse: { Body: {} } }));
    vi.stubGlobal("fetch", fetchFalso);
    await verificarCredenciales({ ...credenciales, sellerId: "SC0170C" });
    const mayor = process.versions.node.split(".")[0];
    expect(fetchFalso.mock.calls[0][1].headers["User-Agent"]).toBe(`SC0170C/Node/${mayor}/ZILONIX/FACO`);
  });

  it("un Seller ID con caracteres raros nunca llega al header (ni a la red)", async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);
    await expect(verificarCredenciales({ ...credenciales, sellerId: "TIENDA\r\nX-Inyectada: 1" })).rejects.toBeInstanceOf(FalabellaApiError);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
