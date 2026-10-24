import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actualizarItemMl,
  agregarDescripcionItemMl,
  buscarEnSitioMl,
  buscarItemsPorSkuMl,
  crearItemMl,
  domainDiscoveryMl,
  leerAtributosCategoriaMl,
  leerCategoriaMl,
  leerCuentaMl,
  leerItemBasicoMl,
  LimiteMercadoLibreError,
  linkPublicacion,
  obtenerMejoresProductosCategoria,
  obtenerOfertasProducto,
  obtenerProducto,
  obtenerVendedor,
  subirClipMl,
} from "./cliente";

function respuestaJson(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as Response;
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

// Tarea 2.11 ("Publicar producto y clip"), punto 2 — lib/ml/publicar.ts,
// lib/ml/clip.ts y lib/ml/estado-item.ts tenían su propio fetch suelto;
// se centralizan acá. Punto 3 — cada función valida su id (itemId/
// categoryId/cuentaIdExterna) ANTES de armar la URL, con los mismos
// patrones de siempre.
describe("lib/ml/cliente — escritura (POST/PUT) y funciones nuevas de la tarea 2.11", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("crearItemMl: POST JSON con content-type, devuelve data ya parseado", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({ category_id: "MCO1234" });
      return respuestaJson({ id: "MCOITEM1", permalink: "https://x" }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await crearItemMl("token", { category_id: "MCO1234" });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ id: "MCOITEM1", permalink: "https://x" });
  });

  it("crearItemMl: HTTP 429 corta con LimiteMercadoLibreError, igual que en lectura", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 429)));
    await expect(crearItemMl("token", {})).rejects.toThrow(LimiteMercadoLibreError);
  });

  it("crearItemMl: tiempo agotado / falla de red nunca queda sin resolver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      })
    );
    const r = await crearItemMl("token", {});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });

  it("actualizarItemMl/agregarDescripcionItemMl: itemId inválido nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(actualizarItemMl("MCO1/../users/me", "token", { status: "paused" })).rejects.toThrow(/inválido/);
    await expect(agregarDescripcionItemMl("javascript:alert(1)", "token", "texto")).rejects.toThrow(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("actualizarItemMl: PUT con el body tal cual", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.mercadolibre.com/items/MCO111");
      expect(init?.method).toBe("PUT");
      return respuestaJson({ status: "paused" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await actualizarItemMl("MCO111", "token", { status: "paused" });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ status: "paused" });
  });

  it("buscarItemsPorSkuMl/leerCuentaMl: cuentaIdExterna que no cumple /^\\d+$/ nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(buscarItemsPorSkuMl("ml-user-123", "SKU", "token")).rejects.toThrow(/inválido/);
    await expect(leerCuentaMl("ml-user-123", "token")).rejects.toThrow(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leerCuentaMl: cuentaIdExterna válida trae el site_id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ site_id: "MCO" })));
    const r = await leerCuentaMl("123456", "token");
    expect(r.siteId).toBe("MCO");
  });

  it("leerItemBasicoMl: itemId inválido nunca llama a fetch; válido trae title/thumbnail", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(leerItemBasicoMl("'; DROP TABLE x; --", "token")).rejects.toThrow(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ title: "Producto", thumbnail: "https://x/thumb.jpg" })));
    const r = await leerItemBasicoMl("MCO111", "token");
    expect(r).toEqual({ title: "Producto", thumbnail: "https://x/thumb.jpg" });
  });

  it("subirClipMl: itemId inválido nunca llama a fetch; válido manda multipart sin content-type a mano", async () => {
    const fetchMockInvalido = vi.fn();
    vi.stubGlobal("fetch", fetchMockInvalido);
    const form = new FormData();
    await expect(subirClipMl("MCO1/../users/me", "token", form)).rejects.toThrow(/inválido/);
    expect(fetchMockInvalido).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      // FormData pone su propio content-type (con boundary) — nunca se
      // fija "application/json" a mano para una subida multipart.
      expect((init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
      expect(init?.body).toBeInstanceOf(FormData);
      return respuestaJson({ status: "accepted" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await subirClipMl("MCO111", "token", form);
    expect(r.ok).toBe(true);
  });

  it("leerCategoriaMl/leerAtributosCategoriaMl: categoryId inválido nunca llama a fetch; endpoints públicos (sin Authorization)", async () => {
    const fetchMockInvalido = vi.fn();
    vi.stubGlobal("fetch", fetchMockInvalido);
    await expect(leerCategoriaMl("MCO 1234")).rejects.toThrow(/inválido/);
    await expect(leerAtributosCategoriaMl("MCO 1234")).rejects.toThrow(/inválido/);
    expect(fetchMockInvalido).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
      return respuestaJson({ id: "MCO1234", name: "Categoría", max_pictures_per_item: 10 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const cat = await leerCategoriaMl("MCO1234");
    expect(cat).toEqual({ categoryId: "MCO1234", categoryName: "Categoría", maxPicturesPerItem: 10 });
  });

  it("buscarEnSitioMl/domainDiscoveryMl: traen categoryId/categoryName tal cual manda Mercado Libre", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ results: [{ category_id: "MCO1" }, { category_id: "MCO2" }] })));
    const r1 = await buscarEnSitioMl("MCO", "reloj digital", "token");
    expect(r1).toEqual([{ categoryId: "MCO1" }, { categoryId: "MCO2" }]);

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson([{ category_id: "MCO1", category_name: "Relojes", domain_name: "MCO-RELOJES" }])));
    const r2 = await domainDiscoveryMl("MCO", "reloj digital", "token");
    expect(r2).toEqual({ ok: true, status: 200, resultados: [{ categoryId: "MCO1", categoryName: "Relojes", domainName: "MCO-RELOJES" }] });
  });

  it("domainDiscoveryMl: no-ok devuelve {ok:false}, nunca lanza (publicar.ts decide si reintenta)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    const r = await domainDiscoveryMl("MCO", "reloj digital", "token");
    expect(r).toEqual({ ok: false, status: 403, resultados: [] });
  });

  // Bug real: escribir() usaba el TIMEOUT_MS de 8s de LECTURA para toda
  // escritura — corta un POST /items (o una subida de clip) antes de
  // que Mercado Libre termine, con riesgo real de ítem duplicado al
  // reintentar. crearItemMl usa TIMEOUT_ESCRITURA_MS (30s); subirClipMl
  // (video de hasta 280MB) usa TIMEOUT_SUBIDA_CLIP_MS (300s) — ninguno
  // de los dos usa el de 8s de pedir().
  it("crearItemMl: usa el timeout de escritura (30s), no el de lectura (8s)", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "MCOITEM1" }, 201)));
    await crearItemMl("token", { category_id: "MCO1234" });
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    timeoutSpy.mockRestore();
  });

  it("subirClipMl: usa el timeout de subida de clip (300s), bien más largo que el de escritura normal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "accepted" })));
    await subirClipMl("MCO111", "token", new FormData());
    expect(timeoutSpy).toHaveBeenCalledWith(300_000);
    timeoutSpy.mockRestore();
  });

  it("subirClipMl: tiempo agotado / falla de red devuelve status:0 (nunca una excepción sin capturar), igual que crearItemMl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      })
    );
    const r = await subirClipMl("MCO111", "token", new FormData());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });
});
