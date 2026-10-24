import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buscarProductosCatalogo,
  LimiteMercadoLibreError,
  linkPublicacion,
  MlNoAutorizadoError,
  MlNoDisponibleError,
  MlSinPermisoAppError,
  obtenerItemMl,
  obtenerMejoresProductosCategoria,
  obtenerOfertasProducto,
  obtenerProducto,
  obtenerVendedor,
  resolverCategoria,
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

// Issue #147 — bug real: un 401/403/5xx de Mercado Libre caía en el
// "throw new Error(...)" genérico de cada función, que ninguna página
// atrapaba — salía "Application error" sin mensaje útil. Ahora pedir()
// (la única función que de verdad llama a fetch) lanza 3 tipos
// distintos, para que cada capa decida qué hacer sin adivinar por el
// texto del error.
describe("lib/ml/cliente — errores tipados por estado HTTP (issue #147)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("401 en /products/search: MlNoAutorizadoError, nunca un Error genérico ni un 500 silencioso", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    await expect(buscarProductosCatalogo("reloj digital", "token")).rejects.toThrow(MlNoAutorizadoError);
  });

  it("403 en /products/search: MlSinPermisoAppError, con el endpoint (sin query) adentro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    const error = await buscarProductosCatalogo("reloj digital", "token").catch((e) => e);
    expect(error).toBeInstanceOf(MlSinPermisoAppError);
    expect(error.endpoint).toBe("/products/search");
    expect(error.endpoint).not.toContain("reloj"); // nunca el término en el endpoint logueado
  });

  it("5xx: MlNoDisponibleError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 503)));
    await expect(buscarProductosCatalogo("reloj digital", "token")).rejects.toThrow(MlNoDisponibleError);
  });

  it("tiempo agotado (AbortError): MlNoDisponibleError, no un {ok:false} silencioso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      })
    );
    await expect(buscarProductosCatalogo("reloj digital", "token")).rejects.toThrow(MlNoDisponibleError);
  });

  it("404 sigue siendo 'vacío' (array vacío), no un error — una respuesta legítima", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 404)));
    await expect(buscarProductosCatalogo("reloj digital", "token")).resolves.toEqual([]);
  });

  it("obtenerOfertasProducto propaga 403 tal cual (nunca lo traga como 'sin ofertas') — investigacion.ts necesita distinguirlo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(obtenerOfertasProducto("MCO1", "token")).rejects.toThrow(MlSinPermisoAppError);
  });

  it("obtenerProducto/obtenerVendedor/obtenerItemMl toleran 403 (enriquecimiento opcional): null, nunca lanzan", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(obtenerProducto("MCO1", "token")).resolves.toBeNull();
    await expect(obtenerVendedor("123456", "token")).resolves.toBeNull();
    await expect(obtenerItemMl("MCO1", "token")).resolves.toBeNull();
  });

  it("obtenerProducto/obtenerVendedor/obtenerItemMl SÍ propagan 401 (token inválido de verdad, no hay nada que tolerar)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    await expect(obtenerProducto("MCO1", "token")).rejects.toThrow(MlNoAutorizadoError);
    await expect(obtenerVendedor("123456", "token")).rejects.toThrow(MlNoAutorizadoError);
    await expect(obtenerItemMl("MCO1", "token")).rejects.toThrow(MlNoAutorizadoError);
  });

  // Bug real: una publicación pausada/cerrada (status !== "active")
  // igual aparecía en la tabla de Investigación — su precio/oferta ya
  // no sirve para analizar el mercado (no se puede comprar). Se
  // descarta igual que cualquier otro candidato sin datos reales
  // (null), nunca se distingue del caso "Mercado Libre no pudo
  // traerla".
  it("obtenerItemMl: pide también 'status' y descarta (null) una publicación que no está activa", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      expect(String(url)).toContain("status");
      return respuestaJson({ title: "Reloj", price: 35_000, currency_id: "COP", seller_id: "123456", status: "paused" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerItemMl("MCO111", "token")).resolves.toBeNull();
  });

  it("obtenerItemMl: una publicación activa sí se devuelve, con su oferta armada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ title: "Reloj", thumbnail: "https://x", price: 35_000, currency_id: "COP", seller_id: "123456", status: "active" })));
    const r = await obtenerItemMl("MCO111", "token");
    expect(r?.producto).toEqual({ id: "MCO111", nombre: "Reloj", foto: "https://x" });
    expect(r?.oferta?.precio).toBe(35_000);
  });
});

describe("resolverCategoria — 3 intentos con 800ms*intento ante 403/5xx (issue #147, mismo criterio que zilonix-os-web)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // vi.useFakeTimers() + vi.runAllTimersAsync() en vez de esperar los
  // 800ms/2400ms reales entre reintentos — misma lógica, prueba instantánea.
  it("403 en el primer intento, OK en el segundo: devuelve la categoría, sin agotar los 3 intentos", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson({}, 403))
      .mockResolvedValueOnce(respuestaJson([{ category_id: "MCO1234" }]));
    vi.stubGlobal("fetch", fetchMock);
    const promesa = resolverCategoria("reloj digital", "token");
    await vi.runAllTimersAsync();
    const resultado = await promesa;
    expect(resultado).toEqual({ categoryId: "MCO1234" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("403 los 3 intentos: devuelve null (enriquecimiento opcional), nunca lanza", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    const promesa = resolverCategoria("reloj digital", "token");
    await vi.runAllTimersAsync();
    await expect(promesa).resolves.toBeNull();
  });

  it("401: nunca reintenta — propaga de una (el token no va a cambiar en el segundo intento)", async () => {
    const fetchMock = vi.fn(async () => respuestaJson({}, 401));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolverCategoria("reloj digital", "token")).rejects.toThrow(MlNoAutorizadoError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("obtenerMejoresProductosCategoria — highlights con type ITEM | PRODUCT | USER_PRODUCT (issue #147)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("conserva el type tal cual junto al id, para los 3 tipos reales", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuestaJson({
          content: [
            { id: "MCO1", type: "PRODUCT" },
            { id: "MCO2", type: "ITEM" },
            { id: "MCOU3", type: "USER_PRODUCT" },
          ],
        })
      )
    );
    const resultado = await obtenerMejoresProductosCategoria("MCO1234", "token");
    expect(resultado).toEqual([
      { id: "MCO1", tipo: "PRODUCT" },
      { id: "MCO2", tipo: "ITEM" },
      { id: "MCOU3", tipo: "USER_PRODUCT" },
    ]);
  });

  it("tolera 403/5xx devolviendo [] (enriquecimiento), propaga 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(obtenerMejoresProductosCategoria("MCO1234", "token")).resolves.toEqual([]);
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    await expect(obtenerMejoresProductosCategoria("MCO1234", "token")).rejects.toThrow(MlNoAutorizadoError);
  });
});
