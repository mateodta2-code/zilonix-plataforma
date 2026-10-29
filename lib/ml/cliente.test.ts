import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actualizarItemMl,
  agregarDescripcionItemMl,
  buscarEnSitioMl,
  buscarItemsPorSkuMl,
  buscarProductosCatalogo,
  confirmarRecursoProductoMl,
  crearItemMl,
  domainDiscoveryMl,
  leerAtributosCategoriaMl,
  leerCategoriaMl,
  leerCategoriasRaizMl,
  leerCuentaMl,
  leerDescripcionItemMl,
  leerItemBasicoMl,
  leerItemCompletoMl,
  leerItemParaPromocionMl,
  leerPromocionesItemMl,
  LimiteMercadoLibreError,
  listarItemsActivosMl,
  modificarPromocionMl,
  participarPromocionMl,
  pedirLecturaMl,
  linkPublicacion,
  MlNoAutorizadoError,
  MlNoDisponibleError,
  MlRespuestaInesperadaError,
  MlSinPermisoAppError,
  obtenerClipsMl,
  obtenerFotoItemMl,
  obtenerItemMl,
  obtenerMejoresProductosCategoria,
  obtenerOfertasProducto,
  obtenerProducto,
  obtenerPublicacionesVendedorAjenoMl,
  obtenerVendedor,
  resolverCategoria,
  salirDePromocionMl,
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

  it("HTTP 429 de lectura guarda Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        headers: { get: (nombre: string) => (nombre.toLowerCase() === "retry-after" ? "12" : null) },
        json: async () => ({}),
        text: async () => "",
      }))
    );
    await expect(pedirLecturaMl("/users/123456", "token")).rejects.toMatchObject({
      name: "LimiteMercadoLibreError",
      retryAfterMs: 12_000,
    });
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
    expect(cat).toEqual({ categoryId: "MCO1234", categoryName: "Categoría", maxPicturesPerItem: 10, childrenCategories: [], pathFromRoot: [] });
  });

  // ADENDO UX de Publicar — children_categories/path_from_root vienen
  // de la MISMA respuesta de /categories/{id} (nunca una llamada
  // nueva); children_categories vacío es la señal real de "es hoja"
  // (nunca se adivina por otro campo).
  it("leerCategoriaMl: children_categories/path_from_root de la misma respuesta — vacío es la señal real de 'es hoja'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuestaJson({
          id: "MCO1234",
          name: "Relojes de Pulsera",
          max_pictures_per_item: 10,
          children_categories: [],
          path_from_root: [{ id: "MCO1000", name: "Relojes" }, { id: "MCO1234", name: "Relojes de Pulsera" }],
        })
      )
    );
    const cat = await leerCategoriaMl("MCO1234");
    expect(cat.childrenCategories).toEqual([]);
    expect(cat.pathFromRoot).toEqual([
      { id: "MCO1000", name: "Relojes" },
      { id: "MCO1234", name: "Relojes de Pulsera" },
    ]);
  });

  it("leerCategoriasRaizMl: SIEMPRE manda el token (a diferencia de leerCategoriaMl) — sin uno, Mercado Libre daría 403", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe("Bearer token-real");
      return respuestaJson([
        { id: "MCO1000", name: "Electrónica" },
        { id: "MCO1001", name: "Hogar" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const raices = await leerCategoriasRaizMl("MCO", "token-real");
    expect(raices).toEqual([
      { id: "MCO1000", name: "Electrónica" },
      { id: "MCO1001", name: "Hogar" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.mercadolibre.com/sites/MCO/categories", expect.anything());
  });

  it("leerCategoriasRaizMl: 403 real de Mercado Libre (sin token) se propaga como el error tipado de siempre", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(leerCategoriasRaizMl("MCO", "token-real")).rejects.toThrow(MlSinPermisoAppError);
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

  // Bug real encontrado al fusionar con main (issue #147 agregó
  // errores tipados a pedir() para 401/403/5xx): domainDiscoveryMl y
  // buscarEnSitioMl necesitan el contrato ORIGINAL de "nunca lanza" —
  // sus llamadores en lib/ml/publicar.ts (resolverCategoria) deciden
  // ellos mismos el reintento mirando resp.status en un bucle, nunca
  // con un catch. Un 403/401/5xx que ahora LANZARA en vez de devolver
  // {ok:false} tumbaría ese reintento entero en el primer intento.
  it("domainDiscoveryMl: 401/403/5xx nunca lanza, siempre {ok:false,status} (publicar.ts decide si reintenta)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    const r403 = await domainDiscoveryMl("MCO", "reloj digital", "token");
    expect(r403).toEqual({ ok: false, status: 403, resultados: [] });

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    const r401 = await domainDiscoveryMl("MCO", "reloj digital", "token");
    expect(r401).toEqual({ ok: false, status: 401, resultados: [] });

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 503)));
    const r5xx = await domainDiscoveryMl("MCO", "reloj digital", "token");
    expect(r5xx).toEqual({ ok: false, status: 503, resultados: [] });
  });

  it("domainDiscoveryMl: 429 SÍ sigue lanzando LimiteMercadoLibreError (nunca se traduce, corta toda la búsqueda)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 429)));
    await expect(domainDiscoveryMl("MCO", "reloj digital", "token")).rejects.toThrow(LimiteMercadoLibreError);
  });

  it("buscarEnSitioMl: 401/403/5xx nunca lanza, devuelve [] (mismo bug real que domainDiscoveryMl)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(buscarEnSitioMl("MCO", "reloj digital", "token")).resolves.toEqual([]);

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    await expect(buscarEnSitioMl("MCO", "reloj digital", "token")).resolves.toEqual([]);
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

  // Issue #174 — bug real: antes esto era un Error genérico que
  // page.tsx no sabía atrapar por nombre y terminaba en la pantalla
  // genérica de error.tsx, sin mostrar el status real de Mercado
  // Libre — justo "qué error real se traga la pantalla" al
  // diagnosticar por qué Investigación no devolvía resultados.
  it("un 4xx que no es 404 (ej. 400): MlRespuestaInesperadaError con el status real adentro, nunca un Error genérico", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 400)));
    const error = await buscarProductosCatalogo("reloj digital", "token").catch((e) => e);
    expect(error).toBeInstanceOf(MlRespuestaInesperadaError);
    expect(error.status).toBe(400);
    expect(error.message).toContain("400");
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

  // Issue #262 (revisión de Pablo, punto 2; corrección de Pablo sobre
  // el punto 2) — obtenerProducto lee `date_created` de la respuesta
  // COMPLETA de la MISMA llamada de siempre (GET /products/{id}, SIN
  // `?attributes=...`): nunca se confirmó que ese endpoint acepte ese
  // parámetro (a diferencia de /items/{id}, que sí lo confirma en
  // producción) — pedirlo ahí arriesgaba un 400 real que también
  // tumbara el nombre, que esta función ya traía bien antes de esta
  // tarea. Nunca una llamada nueva — resolverNombre pasa a guardar el
  // date_created REAL del catálogo (fechaCreacionCatalogo), nunca el
  // de una oferta ganadora (ver lib/seguimiento/lector.ts).
  it("obtenerProducto: lee 'date_created' de la respuesta completa, SIN pedir ?attributes=... (nunca arriesga perder el nombre)", async () => {
    let urlPedida = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urlPedida = url;
        return respuestaJson({ name: "Pulsera deportiva", pictures: [], date_created: "2025-03-15T10:00:00.000Z" });
      })
    );
    const producto = await obtenerProducto("MCO222", "token");
    expect(producto?.fechaCreacion).toBe("2025-03-15T10:00:00.000Z");
    expect(urlPedida).toBe("https://api.mercadolibre.com/products/MCO222"); // sin query string
  });

  // Pregunta explícita de la revisión: si la respuesta real de Mercado
  // Libre no trae `date_created` (puede pasar: no todos los catálogos
  // lo confirman), el tipo nunca queda en `undefined` silencioso —
  // siempre `null` explícito, mismo criterio que el resto del repo
  // ("nunca inventa, pero tampoco esconde que falta").
  it("sin date_created en la respuesta real: fechaCreacion queda en null explícito, nunca undefined", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ name: "Pulsera deportiva", pictures: [] })));
    const producto = await obtenerProducto("MCO222", "token");
    expect(producto?.fechaCreacion).toBeNull();
    expect(producto?.fechaCreacion).not.toBeUndefined();
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

  // Issue #212 — obtenerItemMl ahora pide también "permalink"
  // (confirmado en producción en zilonix-os-web, GET /items/{id}
  // ?attributes=id,status,permalink,pictures) — investigacion.ts lo
  // prefiere sobre el link armado a mano cuando Mercado Libre lo manda.
  it("obtenerItemMl: pide 'permalink' y lo guarda en la oferta cuando Mercado Libre lo manda", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      expect(String(url)).toContain("permalink");
      return respuestaJson({
        title: "Reloj",
        price: 35_000,
        currency_id: "COP",
        seller_id: "123456",
        status: "active",
        permalink: "https://articulo.mercadolibre.com.co/MCO-111-reloj",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await obtenerItemMl("MCO111", "token");
    expect(r?.oferta?.permalink).toBe("https://articulo.mercadolibre.com.co/MCO-111-reloj");
  });

  it("obtenerItemMl: sin permalink en la respuesta, queda null (nunca inventado)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ title: "Reloj", price: 35_000, currency_id: "COP", seller_id: "123456", status: "active" })));
    const r = await obtenerItemMl("MCO111", "token");
    expect(r?.oferta?.permalink).toBeNull();
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

// Issue #175 — lector real del seguimiento diario, confirmado en vivo
// con /panel/investigacion/diagnostico antes de escribirse.
describe("obtenerFotoItemMl — lector de item ajeno (issue #175)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pide los campos exactos pedidos y arma la foto completa", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      expect(String(url)).toBe(
        "https://api.mercadolibre.com/items/MCO111?attributes=id,price,original_price,available_quantity,sold_quantity,status,catalog_listing,catalog_product_id,shipping,date_created"
      );
      return respuestaJson({
        price: 100,
        original_price: 120,
        available_quantity: 5,
        sold_quantity: 230,
        status: "active",
        catalog_listing: true,
        catalog_product_id: "MCO999",
        shipping: { logistic_type: "fulfillment", free_shipping: true },
        date_created: "2024-01-01T00:00:00.000Z",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await obtenerFotoItemMl("MCO111", "token");

    expect(resultado).toEqual({
      precio: 100,
      precioAnterior: 120,
      inventarioDisponible: 5,
      vendidos: 230,
      estado: "active",
      enCatalogo: true,
      catalogProductId: "MCO999",
      esFull: true,
      esEnvioGratis: true,
      fechaCreacion: "2024-01-01T00:00:00.000Z",
    });
  });

  it("campo ausente (ej. sin original_price, sin descuento) queda null, nunca un 0 inventado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ price: 100, status: "active" })));
    const resultado = await obtenerFotoItemMl("MCO111", "token");
    expect(resultado?.precioAnterior).toBeNull();
    expect(resultado?.inventarioDisponible).toBeNull();
    expect(resultado?.vendidos).toBeNull();
    expect(resultado?.catalogProductId).toBeNull();
    expect(resultado?.esFull).toBeNull();
    expect(resultado?.esEnvioGratis).toBeNull();
    expect(resultado?.fechaCreacion).toBeNull();
  });

  it("itemId inválido nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerFotoItemMl("MCO1/../users/me", "token")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tolera 403/5xx (publicación ajena sin ciertos permisos): null, nunca lanza; propaga 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(obtenerFotoItemMl("MCO111", "token")).resolves.toBeNull();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    await expect(obtenerFotoItemMl("MCO111", "token")).rejects.toThrow(MlNoAutorizadoError);
  });
});

describe("obtenerPublicacionesVendedorAjenoMl — dos caminos (items/search -> sites/search) + detalle masivo (issue #175)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("camino propio (items/search) funciona: completa título/precio con /items?ids=", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/items/search")) return respuestaJson({ results: ["MCO1", "MCO2"] });
      if (urlStr.includes("/items?ids=")) {
        return respuestaJson([
          { code: 200, body: { id: "MCO1", title: "Reloj", price: 50_000 } },
          { code: 200, body: { id: "MCO2", title: "Pulsera", price: 20_000 } },
        ]);
      }
      throw new Error(`URL inesperada: ${urlStr}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await obtenerPublicacionesVendedorAjenoMl("123456789", "token");

    expect(resultado).toEqual([
      { itemId: "MCO1", titulo: "Reloj", precio: 50_000 },
      { itemId: "MCO2", titulo: "Pulsera", precio: 20_000 },
    ]);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/sites/MCO/search"))).toBe(false);
  });

  it("items/search da 403 (vendedor ajeno): cae al buscador público del sitio", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/users/") && urlStr.includes("/items/search")) return respuestaJson({}, 403);
      if (urlStr.includes("/sites/MCO/search")) return respuestaJson({ results: [{ id: "MCO1" }] });
      if (urlStr.includes("/items?ids=")) return respuestaJson([{ code: 200, body: { id: "MCO1", title: "Reloj", price: 50_000 } }]);
      throw new Error(`URL inesperada: ${urlStr}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await obtenerPublicacionesVendedorAjenoMl("123456789", "token");

    expect(resultado).toEqual([{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }]);
  });

  it("401 de verdad (token inválido) propaga tal cual, nunca prueba el camino público con el mismo token roto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    await expect(obtenerPublicacionesVendedorAjenoMl("123456789", "token")).rejects.toThrow(MlNoAutorizadoError);
  });

  it("sellerId inválido nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerPublicacionesVendedorAjenoMl("no-es-numerico", "token")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin ninguna publicación: lista vacía, nunca llama al endpoint masivo de detalle", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/items/search")) return respuestaJson({ results: [] });
      throw new Error(`no debería llamar a ${urlStr}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerPublicacionesVendedorAjenoMl("123456789", "token")).resolves.toEqual([]);
  });

  it("un item que falla en el lote (code != 200) se descarta sin tumbar a los demás", async () => {
    vi.stubGlobal("fetch", async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/items/search")) return respuestaJson({ results: ["MCO1", "MCO2"] });
      return respuestaJson([
        { code: 404, body: null },
        { code: 200, body: { id: "MCO2", title: "Pulsera", price: 20_000 } },
      ]);
    });
    const resultado = await obtenerPublicacionesVendedorAjenoMl("123456789", "token");
    expect(resultado).toEqual([{ itemId: "MCO2", titulo: "Pulsera", precio: 20_000 }]);
  });

  // Issue #250, punto B — bug real en staging: el buscador público
  // TAMBIÉN daba 403 para 2 de 5 tiendas en la primera corrida real, y
  // antes esa segunda llamada no tenía try/catch — el 403 subía sin
  // capturar y toda la revisión de esa tienda contaba como "fallida"
  // (ni siquiera guardaba una foto del día). Ahora null ("sin dato de
  // la API hoy"), nunca una excepción.
  it("items/search Y el buscador público dan 403: null (sin dato de la API), nunca lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(obtenerPublicacionesVendedorAjenoMl("123456789", "token")).resolves.toBeNull();
  });

  // Corrección de Pablo (revisión del PR #253), punto 6 — CUALQUIER
  // no-ok del buscador público es "sin dato" (null), no solo un 403:
  // antes de este punto, un 404/400/etc. ahí caía en el "return []"
  // genérico, inventando un "cero publicaciones" que Mercado Libre
  // nunca confirmó.
  it("items/search da 403 y el buscador público da 404 (no 403): también null, nunca []", async () => {
    vi.stubGlobal("fetch", async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/users/") && urlStr.includes("/items/search")) return respuestaJson({}, 403);
      if (urlStr.includes("/sites/MCO/search")) return respuestaJson({}, 404);
      throw new Error(`URL inesperada: ${urlStr}`);
    });
    await expect(obtenerPublicacionesVendedorAjenoMl("123456789", "token")).resolves.toBeNull();
  });
});

describe("confirmarRecursoProductoMl — confirmar item/product contra ML antes de guardar, SIN token (issue #250, punto A + corrección de Pablo)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("/items/{id} responde ok: confirmado como 'item', nunca prueba /products, nunca manda Authorization", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/products/")) throw new Error(`no debería llamar a ${urlStr}`);
      expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
      return respuestaJson({ id: "MCO123" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(confirmarRecursoProductoMl("MCO123")).resolves.toEqual({ estado: "confirmado", recursoMl: "item" });
  });

  it("/items/{id} da 404 y /products/{id} responde ok: confirmado como 'product' — bug real (catálogo pegado sin '/p/')", async () => {
    vi.stubGlobal("fetch", async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/items/")) return respuestaJson({}, 404);
      if (urlStr.includes("/products/")) return respuestaJson({ name: "Producto de catálogo" });
      throw new Error(`URL inesperada: ${urlStr}`);
    });
    await expect(confirmarRecursoProductoMl("MCO123")).resolves.toEqual({ estado: "confirmado", recursoMl: "product" });
  });

  it("/items/{id} da 404 y /products/{id} también 404: 'no_encontrado' real — issue #250, punto 4 de la revisión", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 404)));
    await expect(confirmarRecursoProductoMl("MCO123")).resolves.toEqual({ estado: "no_encontrado" });
  });

  it("/items/{id} da 403 (transitorio): 'transitorio', nunca prueba /products ni adivina", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/products/")) throw new Error(`no debería llamar a ${urlStr}`);
      return respuestaJson({}, 403);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(confirmarRecursoProductoMl("MCO123")).resolves.toEqual({ estado: "transitorio" });
  });

  it("/items/{id} da 404 y /products/{id} da 403: 'transitorio' (no se puede confirmar el negativo), nunca 'no_encontrado'", async () => {
    vi.stubGlobal("fetch", async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/items/")) return respuestaJson({}, 404);
      if (urlStr.includes("/products/")) return respuestaJson({}, 403);
      throw new Error(`URL inesperada: ${urlStr}`);
    });
    await expect(confirmarRecursoProductoMl("MCO123")).resolves.toEqual({ estado: "transitorio" });
  });

  // Corrección de Pablo — nunca se le busca otra forma de usar un
  // token: un 401 inesperado (sin haber mandado ninguno) se trata
  // como "transitorio", con un aviso en el log, nunca una excepción
  // sin capturar ni una vuelta a mandar token.
  it("401 inesperado sin token: 'transitorio', nunca lanza ni busca la forma de mandar un token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(confirmarRecursoProductoMl("MCO123")).resolves.toEqual({ estado: "transitorio" });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("id con formato inválido nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(confirmarRecursoProductoMl("no-es-un-id-ml")).resolves.toEqual({ estado: "transitorio" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Parte 3 ("importadores + permalink + fotos Cloudinary + botón
// extensión"), punto A — leerItemCompletoMl/leerDescripcionItemMl son
// el wrapper más rico que hacía falta para precargar el formulario de
// Publicar desde un SKU/link propio (title/thumbnail de leerItemBasicoMl
// no alcanzaba: faltaba precio, stock, condición, galería completa y el
// SKU propio). Avisado antes de tocar lib/ml/cliente.ts.
describe("leerItemCompletoMl/leerDescripcionItemMl — Parte 3, punto A (importar por SKU/link)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leerItemCompletoMl: itemId inválido nunca llama a fetch, devuelve null", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(leerItemCompletoMl("'; DROP TABLE x; --", "token")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leerItemCompletoMl: trae title/price/available_quantity/condition/pictures/permalink/sku propio/status/thumbnail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuestaJson({
          title: "Producto importado",
          price: 25000,
          available_quantity: 7,
          condition: "new",
          pictures: [{ url: "https://x/foto1.jpg" }, { url: "https://x/foto2.jpg" }, { sin_url: true }],
          permalink: "https://articulo.mercadolibre.com.co/MCO-111",
          seller_custom_field: "SKU-PROPIO",
          status: "active",
          thumbnail: "https://x/thumb.jpg",
        })
      )
    );
    const r = await leerItemCompletoMl("MCO111", "token");
    expect(r).toEqual({
      itemId: "MCO111",
      title: "Producto importado",
      price: 25000,
      availableQuantity: 7,
      condition: "new",
      pictures: ["https://x/foto1.jpg", "https://x/foto2.jpg"],
      permalink: "https://articulo.mercadolibre.com.co/MCO-111",
      sellerCustomField: "SKU-PROPIO",
      status: "active",
      thumbnail: "https://x/thumb.jpg",
    });
  });

  it("leerItemCompletoMl: NO filtra por status (a diferencia de obtenerItemMl) — una publicación propia pausada también se puede importar, y el status real se devuelve tal cual (rama feat-publicar-clip)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ title: "Pausada", price: 1000, status: "paused" })));
    const r = await leerItemCompletoMl("MCO111", "token");
    expect(r?.title).toBe("Pausada");
    expect(r?.status).toBe("paused");
  });

  it("leerItemCompletoMl: sin status/thumbnail en la respuesta: null, nunca inventado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ title: "X" })));
    const r = await leerItemCompletoMl("MCO111", "token");
    expect(r?.status).toBeNull();
    expect(r?.thumbnail).toBeNull();
  });

  it("leerItemCompletoMl: 403/5xx de Mercado Libre se tragan como null (enriquecimiento, nunca tira abajo el importador)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(leerItemCompletoMl("MCO111", "token")).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 503)));
    await expect(leerItemCompletoMl("MCO111", "token")).resolves.toBeNull();
  });

  it("leerDescripcionItemMl: itemId inválido nunca llama a fetch, devuelve null", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(leerDescripcionItemMl("no-es-un-id", "token")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leerDescripcionItemMl: prefiere plain_text sobre text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ plain_text: "Texto plano", text: "<p>Texto con HTML</p>" })));
    await expect(leerDescripcionItemMl("MCO111", "token")).resolves.toBe("Texto plano");
  });

  it("leerDescripcionItemMl: sin plain_text, cae a text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ text: "Solo text" })));
    await expect(leerDescripcionItemMl("MCO111", "token")).resolves.toBe("Solo text");
  });

  it("leerDescripcionItemMl: 404 (publicación sin descripción cargada) es null, nunca lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 404)));
    await expect(leerDescripcionItemMl("MCO111", "token")).resolves.toBeNull();
  });
});

// Rama feat-publicar-clip, punto 5 — avisado antes de tocar
// lib/ml/cliente.ts. Advertencia explícita (ver el comentario completo
// junto a obtenerClipsMl): la forma exacta de GET .../clips nunca se
// confirmó contra una cuenta real con un clip ya moderado — se prueba
// parseando de forma defensiva las 2 formas razonables (array suelto
// o {results:[...]}), nunca asumiendo una sola.
describe("obtenerClipsMl — Parte Clip, punto 5 (estado de moderación)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("itemId inválido: null, nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerClipsMl("no-es-un-id", "token")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("array suelto: parsea clip_uuid/moderation_status/rejection_reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuestaJson([
          { clip_uuid: "uuid-1", moderation_status: "REJECTED", rejection_reason: "Audio con copyright" },
          { clip_uuid: "uuid-2", moderation_status: "PUBLISHED" },
        ])
      )
    );
    await expect(obtenerClipsMl("MCO111", "token")).resolves.toEqual([
      { clipUuid: "uuid-1", moderationStatus: "REJECTED", motivoRechazo: "Audio con copyright" },
      { clipUuid: "uuid-2", moderationStatus: "PUBLISHED", motivoRechazo: null },
    ]);
  });

  it("forma {results:[...]}: misma lectura", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ results: [{ id: "uuid-3", status: "UNDER_REVIEW" }] })));
    await expect(obtenerClipsMl("MCO111", "token")).resolves.toEqual([{ clipUuid: "uuid-3", moderationStatus: "UNDER_REVIEW", motivoRechazo: null }]);
  });

  it("404 (nunca se subió ningún clip todavía): [], nunca null (distingue 'sin dato' de 'de verdad no hay nada')", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 404)));
    await expect(obtenerClipsMl("MCO111", "token")).resolves.toEqual([]);
  });

  it("403/5xx: null (sin dato de la API, nunca [] inventado)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(obtenerClipsMl("MCO111", "token")).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 503)));
    await expect(obtenerClipsMl("MCO111", "token")).resolves.toBeNull();
  });

  it("un campo con forma inesperada (ej. moderation_status numérico): null para ese campo, nunca lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson([{ clip_uuid: "uuid-1", moderation_status: 123 }])));
    await expect(obtenerClipsMl("MCO111", "token")).resolves.toEqual([{ clipUuid: "uuid-1", moderationStatus: null, motivoRechazo: null }]);
  });
});

describe("listarItemsActivosMl — rama feat-promociones, una página", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cuentaIdExterna inválida nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(listarItemsActivosMl("no-es-numerico", "token", 0)).rejects.toThrow(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("devuelve ids y el total real del catálogo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ results: ["MCO1", "MCO2"], paging: { total: 137 } })));
    await expect(listarItemsActivosMl("123", "token", 0)).resolves.toEqual({ ids: ["MCO1", "MCO2"], totalCatalogo: 137 });
  });

  it("status >= 500 lanza (nunca devuelve una página vacía en silencio)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 500)));
    await expect(listarItemsActivosMl("123", "token", 0)).rejects.toThrow();
  });
});

describe("leerItemParaPromocionMl — rama feat-promociones", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("itemId inválido: null, nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(leerItemParaPromocionMl("no-es-un-id", "token")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lee título/thumbnail/sku y detecta variantes reales", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaJson({ title: "Producto", thumbnail: "https://x/thumb.jpg", seller_custom_field: "SKU-1", variations: [{ id: 1 }, { id: 2 }] }))
    );
    await expect(leerItemParaPromocionMl("MCO111", "token")).resolves.toEqual({
      title: "Producto",
      thumbnail: "https://x/thumb.jpg",
      sellerCustomField: "SKU-1",
      tieneVariantes: true,
    });
  });

  it("sin variations (o vacío): tieneVariantes false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ title: "Producto", variations: [] })));
    await expect(leerItemParaPromocionMl("MCO111", "token")).resolves.toMatchObject({ tieneVariantes: false });
  });

  it("403/404/5xx: null, nunca lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(leerItemParaPromocionMl("MCO111", "token")).resolves.toBeNull();
  });
});

describe("leerPromocionesItemMl — rama feat-promociones / fix-promociones-buscar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("itemId inválido: ok con array vacío, nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(leerPromocionesItemMl("no-es-un-id", "token")).resolves.toEqual({ estado: "ok", promociones: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("array real de promociones: estado ok, se devuelve tal cual, crudo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson([{ type: "DEAL", status: "candidate" }])));
    await expect(leerPromocionesItemMl("MCO111", "token")).resolves.toEqual({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate" }] });
  });

  it("404 (publicación sin ninguna promoción aplicable): estado ok con array vacío — nunca se confunde con un fallo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 404)));
    await expect(leerPromocionesItemMl("MCO111", "token")).resolves.toEqual({ estado: "ok", promociones: [] });
  });

  // Bug real (Refs #44) — antes esto se devolvía como `null`, EXACTAMENTE
  // igual que el 404 de arriba. Río abajo (leerPromocionesDeItem,
  // buscarPromocionesCuenta) ya no puede distinguir "esta publicación no
  // tiene promos" de "la app no tiene permiso para consultar esto" — una
  // cuenta entera podía terminar "Listo (0/N)" sin ningún aviso.
  it("403 (la app sin el scope de Promociones): estado sin_permiso, nunca se confunde con 'sin promos'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    await expect(leerPromocionesItemMl("MCO111", "token")).resolves.toEqual({ estado: "sin_permiso" });
  });

  it("401 (token ya no válido): estado no_autorizado, nunca lanza ni se confunde con 'sin promos'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    await expect(leerPromocionesItemMl("MCO111", "token")).resolves.toEqual({ estado: "no_autorizado" });
  });

  it("5xx: estado otro_error con status null (MlNoDisponibleError no guarda el status real)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 500)));
    await expect(leerPromocionesItemMl("MCO111", "token")).resolves.toEqual({ estado: "otro_error", status: null });
  });

  it("otro !ok inesperado (ej. 400): estado otro_error con el status real", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 400)));
    await expect(leerPromocionesItemMl("MCO111", "token")).resolves.toEqual({ estado: "otro_error", status: 400 });
  });
});

describe("participarPromocionMl/modificarPromocionMl — rama feat-promociones", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("participar — POST real, el body nunca incluye top_deal_price (bug real ya corregido en zilonix-os-web)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ status: "accepted" }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { promotion_id: "p1", promotion_type: "DEAL", deal_price: 90000, start_date: "2026-11-01T00:00:00", finish_date: "2026-11-30T23:59:59" };
    const resultado = await participarPromocionMl("MCO111", "token", body);
    expect(resultado.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/seller-promotions/items/MCO111");
    expect(init?.method).toBe("POST");
    const bodyEnviado = JSON.parse(init?.body as string);
    expect(bodyEnviado).not.toHaveProperty("top_deal_price");
    expect(bodyEnviado).toEqual(body);
  });

  it("modificar — PUT real, mismo endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ status: "accepted" }));
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await modificarPromocionMl("MCO111", "token", { promotion_id: "p1", promotion_type: "DEAL", deal_price: 80000 });
    expect(resultado.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("PUT");
  });

  it("itemId inválido: nunca llama a fetch (participar y modificar)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(participarPromocionMl("no-es-un-id", "token", { promotion_id: "p1", promotion_type: "DEAL", deal_price: 1, start_date: "x", finish_date: "y" })).rejects.toThrow(/inválido/);
    await expect(modificarPromocionMl("no-es-un-id", "token", { promotion_id: "p1", promotion_type: "DEAL", deal_price: 1 })).rejects.toThrow(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429: lanza LimiteMercadoLibreError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 429)));
    await expect(
      participarPromocionMl("MCO111", "token", { promotion_id: "p1", promotion_type: "DEAL", deal_price: 1, start_date: "x", finish_date: "y" })
    ).rejects.toBeInstanceOf(LimiteMercadoLibreError);
  });
});

describe("salirDePromocionMl — rama feat-promociones (SIN CONFIRMAR contra Mercado Libre real)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("DELETE real al mismo endpoint, con promotion_id/promotion_type en la query", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({}, 200));
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await salirDePromocionMl("MCO111", "token", "p1", "DEAL");
    expect(resultado.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/seller-promotions/items/MCO111");
    expect(String(url)).toContain("promotion_id=p1");
    expect(String(url)).toContain("promotion_type=DEAL");
    expect(init?.method).toBe("DELETE");
  });

  it("itemId inválido nunca llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(salirDePromocionMl("no-es-un-id", "token", "p1", "DEAL")).rejects.toThrow(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429: lanza LimiteMercadoLibreError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 429)));
    await expect(salirDePromocionMl("MCO111", "token", "p1", "DEAL")).rejects.toBeInstanceOf(LimiteMercadoLibreError);
  });

  it("falla de red: {ok:false, status:0}, nunca lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("red caída"); }));
    await expect(salirDePromocionMl("MCO111", "token", "p1", "DEAL")).resolves.toEqual({ ok: false, status: 0, textoCrudo: "" });
  });
});
