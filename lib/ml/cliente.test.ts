import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LimiteMercadoLibreError,
  leerParaDiagnostico,
  linkPublicacion,
  obtenerMejoresProductosCategoria,
  obtenerOfertasProducto,
  obtenerProducto,
  obtenerVendedor,
} from "./cliente";

function respuestaJson(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

// Corrección de Pablo (PR #112) — este archivo prueba exactamente lo
// que pidió: id inválido que nunca llega a llamar a la API, tiempo
// agotado (AbortError/falla de red) tratado como respuesta no-ok, y
// 429 cortando con un error específico.
describe("lib/ml/cliente — validación de ids, tiempo máximo y 429 (PR #112)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("productId que no cumple ^MCO\\d+$ nunca llama a fetch (obtenerProducto)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await obtenerProducto("'; DROP TABLE x; --", "token");
    expect(resultado).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("productId inválido nunca llama a fetch (obtenerOfertasProducto)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await obtenerOfertasProducto("MCO123/../../oauth/token", "token");
    expect(resultado).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("categoryId inválido nunca llama a fetch (obtenerMejoresProductosCategoria)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await obtenerMejoresProductosCategoria("MCO 1234", "token");
    expect(resultado).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sellerId inválido (no numérico) nunca llama a fetch (obtenerVendedor)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await obtenerVendedor("abc123", "token");
    expect(resultado).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("linkPublicacion con un itemId inválido devuelve null, nunca arma una URL", () => {
    expect(linkPublicacion("javascript:alert(1)")).toBeNull();
    expect(linkPublicacion("MCO111")).toBe("https://articulo.mercadolibre.com.co/MCO-111");
  });

  it("ids válidos sí llaman a fetch, con el id pasado por encodeURIComponent", async () => {
    const fetchMock = vi.fn(async () => respuestaJson({ nickname: "vendedor-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await obtenerVendedor("123456", "token-real");
    expect(fetchMock).toHaveBeenCalledWith("https://api.mercadolibre.com/users/123456", expect.any(Object));
  });

  it("tiempo agotado / falla de red se trata como respuesta no-ok, nunca una excepción sin capturar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      })
    );
    const resultado = await obtenerVendedor("123456", "token");
    expect(resultado).toBeNull();
  });

  it("HTTP 429: corta con LimiteMercadoLibreError en vez de devolver {ok:false} en silencio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 429)));
    await expect(obtenerVendedor("123456", "token")).rejects.toThrow(LimiteMercadoLibreError);
  });
});

// Z-FIN-00 (issue #122) — la puerta de lectura del diagnóstico de
// scripts/finanzas/verificar-acceso-ml.ts.
describe("lib/ml/cliente — leerParaDiagnostico (Z-FIN-00)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("solo hace GET, con Api-Version cuando se pide", async () => {
    const fetchMock = vi.fn(async () => respuestaJson({ advertisers: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await leerParaDiagnostico("/advertising/advertisers?product_id=PADS", "token", "1");
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mercadolibre.com/advertising/advertisers?product_id=PADS",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ "Api-Version": "1" }) })
    );
  });

  it("un 429 se devuelve como status (para contarlo), no se lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 429)));
    const r = await leerParaDiagnostico("/users/me", "token");
    expect(r.status).toBe(429);
    expect(r.data).toBeNull();
  });

  it("una URL completa o una ruta con .. nunca llega a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(leerParaDiagnostico("https://otro.host/x", "token")).rejects.toThrow();
    await expect(leerParaDiagnostico("/orders/../oauth/token", "token")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tiempo agotado devuelve status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      })
    );
    expect((await leerParaDiagnostico("/users/me", "token")).status).toBe(0);
  });
});
