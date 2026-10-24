import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buscarProductosCatalogo,
  diagnosticoCatalogoMl,
  diagnosticoItemMl,
  diagnosticoVendedorMl,
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

// Las 3 funciones de diagnóstico (issue #175) leen con res.text() +
// JSON.parse a mano (pedirCrudo no reusa pedir(), ver el comentario
// real en cliente.ts) — nunca con res.json() como el resto de este
// archivo, para no perder el status real de un 401/403/429/5xx.
function respuestaConTexto(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) } as Response;
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

// Issue #175 — diagnóstico real (/panel/investigacion/diagnostico,
// solo Dueño): a diferencia del resto de este archivo, estas 3
// funciones NUNCA lanzan un error tipado por el status — devuelven el
// status HTTP real tal cual (incluido 401/403/429/5xx), porque todo el
// propósito es VER la respuesta real de Mercado Libre para publicaciones
// y tiendas ajenas, no interpretarla.
describe("diagnosticoItemMl / diagnosticoVendedorMl / diagnosticoCatalogoMl (issue #175, diagnóstico)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("diagnosticoItemMl: pide los campos exactos pedidos y devuelve el status + los datos crudos tal cual", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://api.mercadolibre.com/items/MCO111?attributes=id,available_quantity,sold_quantity,price,original_price,status,catalog_listing,catalog_product_id,shipping"
      );
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-secreto");
      return respuestaConTexto({ id: "MCO111", available_quantity: 5, sold_quantity: 2, price: 100, original_price: 120, status: "active" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await diagnosticoItemMl("MCO111", "token-secreto");

    expect(resultado.status).toBe(200);
    expect(resultado.data).toEqual({ id: "MCO111", available_quantity: 5, sold_quantity: 2, price: 100, original_price: 120, status: "active" });
    // El diagnóstico nunca repite el token en lo que devuelve — solo en
    // el header Authorization que de verdad hay que mandar.
    expect(JSON.stringify(resultado)).not.toContain("token-secreto");
  });

  it("diagnosticoItemMl: un 401/403/429/5xx real NUNCA se convierte en un error tipado — el status real queda visible", async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => respuestaConTexto({ message: "lo que sea" }, status)));
      const resultado = await diagnosticoItemMl("MCO111", "token");
      expect(resultado.status).toBe(status);
      vi.unstubAllGlobals();
    }
  });

  it("diagnosticoItemMl: tiempo agotado / falla de red -> status 0, nunca una excepción sin capturar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      })
    );
    const resultado = await diagnosticoItemMl("MCO111", "token");
    expect(resultado.status).toBe(0);
    expect(resultado.data).toBeNull();
  });

  it("diagnosticoItemMl: respuesta no-JSON -> data null, el status real sigue visible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "<html>no soy json</html>" }) as Response));
    const resultado = await diagnosticoItemMl("MCO111", "token");
    expect(resultado.status).toBe(200);
    expect(resultado.data).toBeNull();
  });

  it("diagnosticoVendedorMl: pide los dos caminos (items/search y sites/MCO/search) y cuenta los resultados de cada uno por separado", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url) === "https://api.mercadolibre.com/users/987654321/items/search") {
        return respuestaConTexto({ results: ["MCO1", "MCO2"] });
      }
      if (String(url) === "https://api.mercadolibre.com/sites/MCO/search?seller_id=987654321") {
        return respuestaConTexto({ results: ["MCO1", "MCO2", "MCO3"] }, 200);
      }
      throw new Error(`URL inesperada en la prueba: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await diagnosticoVendedorMl("987654321", "token");

    expect(resultado).toEqual({
      itemsSearch: { status: 200, cantidadResultados: 2 },
      sitesSearch: { status: 200, cantidadResultados: 3 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("diagnosticoVendedorMl: un 401 en uno de los dos caminos no afecta al otro (son independientes)", async () => {
    vi.stubGlobal("fetch", async (url: unknown) =>
      String(url).includes("/items/search") ? respuestaConTexto({}, 401) : respuestaConTexto({ results: [] }, 200)
    );
    const resultado = await diagnosticoVendedorMl("987654321", "token");
    expect(resultado.itemsSearch.status).toBe(401);
    expect(resultado.sitesSearch.status).toBe(200);
  });

  it("diagnosticoVendedorMl: sin campo results (forma inesperada) -> cantidadResultados null, nunca 0 inventado", async () => {
    vi.stubGlobal("fetch", async () => respuestaConTexto({ algo: "distinto" }, 200));
    const resultado = await diagnosticoVendedorMl("987654321", "token");
    expect(resultado.itemsSearch.cantidadResultados).toBeNull();
    expect(resultado.sitesSearch.cantidadResultados).toBeNull();
  });

  it("diagnosticoCatalogoMl: cuenta las ofertas y busca un campo de botón de compra en la primera (array plano)", async () => {
    vi.stubGlobal("fetch", async () =>
      respuestaConTexto([
        { item_id: "MCO1", price: 100, buy_box_winner: true },
        { item_id: "MCO2", price: 90 },
      ])
    );
    const resultado = await diagnosticoCatalogoMl("MCO999", "token");

    expect(resultado.status).toBe(200);
    expect(resultado.totalOfertas).toBe(2);
    expect(resultado.primeraOferta).toEqual({ item_id: "MCO1", price: 100, buy_box_winner: true });
    expect(resultado.camposGanadorEncontrados).toEqual([{ clave: "buy_box_winner", valor: true }]);
  });

  it("diagnosticoCatalogoMl: también funciona si ML envuelve la lista en { results: [...] }", async () => {
    vi.stubGlobal("fetch", async () => respuestaConTexto({ results: [{ item_id: "MCO1", price: 100 }] }));
    const resultado = await diagnosticoCatalogoMl("MCO999", "token");
    expect(resultado.totalOfertas).toBe(1);
    expect(resultado.primeraOferta).toEqual({ item_id: "MCO1", price: 100 });
  });

  it("diagnosticoCatalogoMl: ningún campo que suene a botón de compra -> lista vacía, nunca inventa uno", async () => {
    vi.stubGlobal("fetch", async () => respuestaConTexto([{ item_id: "MCO1", price: 100, seller_id: "123" }]));
    const resultado = await diagnosticoCatalogoMl("MCO999", "token");
    expect(resultado.camposGanadorEncontrados).toEqual([]);
  });

  it("diagnosticoCatalogoMl: 404 (sin ofertas reales) -> status real, totalOfertas null (no hay lista que contar)", async () => {
    vi.stubGlobal("fetch", async () => respuestaConTexto({ message: "not found" }, 404));
    const resultado = await diagnosticoCatalogoMl("MCO999", "token");
    expect(resultado.status).toBe(404);
    expect(resultado.totalOfertas).toBeNull();
  });
});
