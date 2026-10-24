import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _reiniciarLimiteBusquedasParaPruebas,
  buscarInvestigacionProducto,
  calcularResultadoInvestigacion,
  LIMITE_BUSQUEDAS_POR_MINUTO,
  LimiteBusquedasError,
  SinCuentaMlError,
  TerminoInvalidoError,
  validarTermino,
  type PublicacionInvestigacion,
} from "./investigacion";

const { LimiteMercadoLibreErrorFalso, MlSinPermisoAppErrorFalso } = vi.hoisted(() => {
  class LimiteMercadoLibreErrorFalso extends Error {
    constructor() {
      super("Mercado Libre está limitando las consultas, intenta en un minuto.");
      this.name = "LimiteMercadoLibreError";
    }
  }
  // Issue #147 — falso idéntico al real (lib/ml/cliente.ts) para poder
  // simular, sin tocar fetch, que una función auxiliar devolvió un
  // 403 de la APP (no de la cuenta) — investigacion.ts lo cuenta
  // distinto de "sin ofertas reales".
  class MlSinPermisoAppErrorFalso extends Error {
    readonly endpoint: string;
    constructor(endpoint: string) {
      super("Mercado Libre no le da permiso a esta aplicación para esta consulta.");
      this.name = "MlSinPermisoAppError";
      this.endpoint = endpoint;
    }
  }
  return { LimiteMercadoLibreErrorFalso, MlSinPermisoAppErrorFalso };
});

vi.mock("@/lib/ml/cliente", () => ({
  buscarProductosCatalogo: vi.fn(),
  resolverCategoria: vi.fn(),
  obtenerMejoresProductosCategoria: vi.fn(),
  obtenerProducto: vi.fn(),
  obtenerItemMl: vi.fn(),
  obtenerOfertasProducto: vi.fn(),
  obtenerVendedor: vi.fn(),
  linkPublicacion: (itemId: string) => `https://articulo.mercadolibre.com.co/${itemId}`,
  LimiteMercadoLibreError: LimiteMercadoLibreErrorFalso,
  MlSinPermisoAppError: MlSinPermisoAppErrorFalso,
}));
vi.mock("@/lib/ml/cuentas", () => ({
  obtenerCuentaMlActiva: vi.fn(),
  obtenerAccessTokenVigente: vi.fn(),
}));

import { buscarProductosCatalogo, obtenerItemMl, obtenerMejoresProductosCategoria, obtenerOfertasProducto, obtenerProducto, obtenerVendedor, resolverCategoria } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";

function publicacion(parcial: Partial<PublicacionInvestigacion> = {}): PublicacionInvestigacion {
  return {
    productId: "MCO1", itemId: "MCO111", titulo: "Reloj digital casio", foto: null,
    precio: 50_000, moneda: "COP", esFull: false, esEnvioGratis: null,
    vendedor: "vendedor-1", esPlatinum: false, link: "https://articulo.mercadolibre.com.co/MCO-111",
    ...parcial,
  };
}

describe("validarTermino — 2 a 3 palabras (tarea Investigación ML, Parte 1)", () => {
  it("acepta 2 y 3 palabras, recortadas", () => {
    expect(validarTermino("  reloj digital  ")).toBe("reloj digital");
    expect(validarTermino("reloj digital casio")).toBe("reloj digital casio");
  });

  it("rechaza una sola palabra, 4+, vacío y solo espacios", () => {
    expect(() => validarTermino("reloj")).toThrow(TerminoInvalidoError);
    expect(() => validarTermino("reloj digital casio nuevo")).toThrow(TerminoInvalidoError);
    expect(() => validarTermino("")).toThrow(TerminoInvalidoError);
    expect(() => validarTermino("   ")).toThrow(TerminoInvalidoError);
  });
});

describe("calcularResultadoInvestigacion — cálculos puros (sin fetch ni base)", () => {
  it("precio mínimo/promedio/máximo y % Full con datos completos", () => {
    const resultado = calcularResultadoInvestigacion("reloj digital", [
      publicacion({ precio: 30_000, esFull: true, vendedor: "a" }),
      publicacion({ precio: 50_000, esFull: true, vendedor: "b" }),
      publicacion({ precio: 100_000, esFull: false, vendedor: "c" }),
    ]);
    expect(resultado.precioMinimo).toBe(30_000);
    expect(resultado.precioMaximo).toBe(100_000);
    expect(resultado.precioPromedio).toBe(60_000);
    expect(resultado.porcentajeFull).toBe(67); // 2/3 redondeado
    expect(resultado.vendedoresDistintos).toBe(3);
    expect(resultado.publicacionesEncontradas).toBe(3);
    expect(resultado.aviso).toBeNull();
  });

  it("% envío gratis solo se calcula sobre las ofertas que SÍ trajeron ese dato — nunca se inventa un 0%", () => {
    const resultado = calcularResultadoInvestigacion("reloj digital", [
      publicacion({ esEnvioGratis: null }),
      publicacion({ esEnvioGratis: null }),
    ]);
    expect(resultado.porcentajeEnvioGratis).toBeNull();

    const conDato = calcularResultadoInvestigacion("reloj digital", [
      publicacion({ esEnvioGratis: true }),
      publicacion({ esEnvioGratis: false }),
      publicacion({ esEnvioGratis: null }), // no cuenta ni en el numerador ni en el denominador
    ]);
    expect(conDato.porcentajeEnvioGratis).toBe(50);
  });

  it("búsqueda sin resultados: aviso claro, nunca una cifra inventada", () => {
    const resultado = calcularResultadoInvestigacion("producto raro", []);
    expect(resultado.aviso).toMatch(/no se encontraron publicaciones/i);
    expect(resultado.publicacionesEncontradas).toBe(0);
    expect(resultado.precioPromedio).toBeNull();
    expect(resultado.porcentajeFull).toBeNull();
    expect(resultado.estrategiaSugerida).toHaveLength(0);
  });

  it("vendedores repetidos cuentan una sola vez", () => {
    const resultado = calcularResultadoInvestigacion("reloj digital", [
      publicacion({ vendedor: "mismo" }),
      publicacion({ vendedor: "mismo" }),
      publicacion({ vendedor: "otro" }),
    ]);
    expect(resultado.vendedoresDistintos).toBe(2);
  });

  it("Top 10: con más de 10 publicaciones relevantes, solo se quedan 10", () => {
    const quince = Array.from({ length: 15 }, (_, i) => publicacion({ itemId: `MCO${i}`, vendedor: `v${i}`, precio: 1000 * (i + 1) }));
    const resultado = calcularResultadoInvestigacion("reloj digital", quince);
    expect(resultado.publicaciones).toHaveLength(10);
    expect(resultado.publicacionesEncontradas).toBe(15); // el conteo real no se recorta, solo la tabla
  });

  it("estrategia sugerida: mucha competencia + ticket bajo -> nicho difícil (ejemplo literal del pedido)", () => {
    const seis = Array.from({ length: 6 }, (_, i) => publicacion({ vendedor: `v${i}`, precio: 20_000, itemId: `MCO${i}` }));
    const resultado = calcularResultadoInvestigacion("producto barato", seis);
    expect(resultado.estrategiaSugerida.some((r) => /nicho difícil/i.test(r.texto))).toBe(true);
  });

  it("estrategia sugerida: Full dominante (>=80%) avisa desventaja de entrar sin Full", () => {
    const resultado = calcularResultadoInvestigacion("reloj digital", [
      publicacion({ esFull: true, vendedor: "a" }),
      publicacion({ esFull: true, vendedor: "b" }),
      publicacion({ esFull: true, vendedor: "c" }),
      publicacion({ esFull: true, vendedor: "d" }),
      publicacion({ esFull: false, vendedor: "e" }),
    ]);
    expect(resultado.porcentajeFull).toBe(80);
    expect(resultado.estrategiaSugerida.some((r) => /desventaja/i.test(r.texto))).toBe(true);
  });
});

describe("buscarInvestigacionProducto — orquestación con respuestas de Mercado Libre simuladas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _reiniciarLimiteBusquedasParaPruebas();
    vi.mocked(obtenerCuentaMlActiva).mockResolvedValue({ id: "cuenta-1" });
    vi.mocked(obtenerAccessTokenVigente).mockResolvedValue("token-falso");
    vi.mocked(resolverCategoria).mockResolvedValue(null);
    vi.mocked(obtenerMejoresProductosCategoria).mockResolvedValue([]);
    vi.mocked(obtenerProducto).mockResolvedValue(null);
    vi.mocked(obtenerItemMl).mockResolvedValue(null);
  });

  it("exige una cuenta de Mercado Libre conectada antes de llamar a la API", async () => {
    vi.mocked(obtenerCuentaMlActiva).mockResolvedValue(null);
    await expect(buscarInvestigacionProducto("empresa-1", "reloj digital")).rejects.toThrow(SinCuentaMlError);
    expect(buscarProductosCatalogo).not.toHaveBeenCalled();
  });

  it("búsqueda sin resultados reales: aviso claro cuando el catálogo no trae nada", async () => {
    vi.mocked(buscarProductosCatalogo).mockResolvedValue([]);
    const resultado = await buscarInvestigacionProducto("empresa-1", "producto inexistente");
    expect(resultado.aviso).toMatch(/no se encontró ningún producto de catálogo/i);
  });

  it("candidatos de catálogo sin ninguna oferta activa (404 en /products/{id}/items): aviso específico, no un 500", async () => {
    vi.mocked(buscarProductosCatalogo).mockResolvedValueOnce([{ id: "MCO1", nombre: "Reloj digital casio", foto: null }]).mockResolvedValue([]);
    vi.mocked(obtenerOfertasProducto).mockResolvedValue([]); // 404 real -> cliente.ts devuelve []
    const resultado = await buscarInvestigacionProducto("empresa-1", "reloj digital");
    expect(resultado.aviso).toMatch(/ninguno de sus productos tiene publicaciones activas/i);
  });

  it("respuesta incompleta o rara de Mercado Libre (sin itemId / precio inválido): se descarta esa oferta sin tumbar la búsqueda", async () => {
    vi.mocked(buscarProductosCatalogo)
      .mockResolvedValueOnce([
        { id: "MCO1", nombre: "Reloj digital casio", foto: null },
        { id: "MCO2", nombre: "Reloj digital negro", foto: null },
      ])
      .mockResolvedValue([]);
    // MCO1: oferta válida real. MCO2: sin ofertas (simula el 404/respuesta rara que cliente.ts ya filtró a []).
    vi.mocked(obtenerOfertasProducto).mockImplementation(async (productId: string) => {
      if (productId === "MCO1") {
        return [{ itemId: "MCO111", precio: 45_000, monedaId: "COP", sellerId: "vendedor-1", esFull: true, esEnvioGratis: null }];
      }
      return [];
    });
    vi.mocked(obtenerVendedor).mockResolvedValue({ nickname: "Vendedor Uno", esPlatinum: false });

    const resultado = await buscarInvestigacionProducto("empresa-1", "reloj digital");
    expect(resultado.publicacionesEncontradas).toBe(1);
    expect(resultado.publicaciones[0].itemId).toBe("MCO111");
    expect(resultado.aviso).toBeNull();
  });

  it("filtra candidatos que no comparten ninguna palabra con la búsqueda (categoría vecina)", async () => {
    vi.mocked(buscarProductosCatalogo).mockResolvedValueOnce([{ id: "MCO9", nombre: "Perchero giratorio exhibidor", foto: null }]).mockResolvedValue([]);
    const resultado = await buscarInvestigacionProducto("empresa-1", "reloj digital");
    expect(obtenerOfertasProducto).not.toHaveBeenCalled();
    expect(resultado.aviso).toMatch(/no coincide con ningún producto real/i);
  });

  it("corrección PR #112 — tope de 40 candidatos relevantes, priorizando texto y completando con categoría", async () => {
    // 20 candidatos de TEXTO + 30 de CATEGORÍA (más de los 40 permitidos
    // entre los dos) — el tope tiene que incluir los 20 de texto COMPLETOS
    // y llenar los 20 cupos restantes con los primeros de categoría,
    // nunca al revés ni mezclado al azar.
    const textoC = Array.from({ length: 20 }, (_, i) => ({ id: `T${i}`, nombre: `Reloj digital texto ${i}`, foto: null }));
    const categoriaIds = Array.from({ length: 30 }, (_, i) => ({ id: `C${i}`, tipo: "PRODUCT" }));
    vi.mocked(buscarProductosCatalogo).mockResolvedValueOnce(textoC).mockResolvedValue([]);
    vi.mocked(resolverCategoria).mockResolvedValue({ categoryId: "CAT1" });
    vi.mocked(obtenerMejoresProductosCategoria).mockResolvedValue(categoriaIds);
    vi.mocked(obtenerProducto).mockImplementation(async (id: string) => ({ id, nombre: `Reloj digital categoria ${id}`, foto: null }));
    vi.mocked(obtenerOfertasProducto).mockImplementation(async (productId: string) => [
      { itemId: `item-${productId}`, precio: 10_000, monedaId: "COP", sellerId: "1", esFull: false, esEnvioGratis: null },
    ]);
    vi.mocked(obtenerVendedor).mockResolvedValue({ nickname: "Vendedor", esPlatinum: false });

    const resultado = await buscarInvestigacionProducto("empresa-1", "reloj digital");

    expect(obtenerOfertasProducto).toHaveBeenCalledTimes(40);
    expect(resultado.publicacionesEncontradas).toBe(40);
    const idsLlamados = new Set(vi.mocked(obtenerOfertasProducto).mock.calls.map((c) => c[0]));
    const esperados = new Set([...textoC.map((c) => c.id), ...categoriaIds.slice(0, 20).map((c) => c.id)]);
    expect(idsLlamados).toEqual(esperados);
    // Ninguno de los últimos 10 de categoría (los que no entraron en el tope).
    for (const sobrante of categoriaIds.slice(20)) {
      expect(idsLlamados.has(sobrante.id)).toBe(false);
    }
  });

  it("corrección Pablo — tope de 20 ids de categoría antes de pedirles nombre/foto (obtenerProducto)", async () => {
    // Pocos candidatos de TEXTO (5) + muchos ids de CATEGORÍA (30, todos
    // nuevos) — sin este tope, obtenerProducto se llamaría 30 veces
    // (ninguno de los 35 resultantes chocaría con el tope de 40 total);
    // con el tope, se llama como máximo 20 veces, así que el resultado
    // final queda en 5+20=25 publicaciones, nunca 30 ni 35.
    const texto = Array.from({ length: 5 }, (_, i) => ({ id: `T${i}`, nombre: "Reloj digital texto", foto: null }));
    const categoriaIds = Array.from({ length: 30 }, (_, i) => ({ id: `C${i}`, tipo: "PRODUCT" }));
    vi.mocked(buscarProductosCatalogo).mockResolvedValueOnce(texto).mockResolvedValue([]);
    vi.mocked(resolverCategoria).mockResolvedValue({ categoryId: "CAT1" });
    vi.mocked(obtenerMejoresProductosCategoria).mockResolvedValue(categoriaIds);
    vi.mocked(obtenerProducto).mockImplementation(async (id: string) => ({ id, nombre: "Reloj digital categoria", foto: null }));
    vi.mocked(obtenerOfertasProducto).mockImplementation(async (productId: string) => [
      { itemId: `item-${productId}`, precio: 10_000, monedaId: "COP", sellerId: "1", esFull: false, esEnvioGratis: null },
    ]);
    vi.mocked(obtenerVendedor).mockResolvedValue({ nickname: "Vendedor", esPlatinum: false });

    const resultado = await buscarInvestigacionProducto("empresa-1", "reloj digital");

    expect(obtenerProducto).toHaveBeenCalledTimes(20);
    expect(obtenerOfertasProducto).toHaveBeenCalledTimes(25);
    expect(resultado.publicacionesEncontradas).toBe(25);
  });

  it("HTTP 429 de Mercado Libre corta toda la búsqueda con el aviso específico (no un 500 genérico)", async () => {
    vi.mocked(buscarProductosCatalogo).mockRejectedValue(new LimiteMercadoLibreErrorFalso());
    await expect(buscarInvestigacionProducto("empresa-1", "reloj digital")).rejects.toThrow(/limitando las consultas/i);
  });

  // Issue #147, punto 5 — registrarBusqueda() descuenta cupo del límite
  // de 10/minuto; antes corría ANTES de validarTermino(), así que un
  // término inválido ya gastaba cupo real sin haber buscado nada.
  it('término inválido ("reloj", 1 palabra) nunca descuenta cupo del límite de búsquedas', async () => {
    await expect(buscarInvestigacionProducto("empresa-cupo", "reloj")).rejects.toThrow(TerminoInvalidoError);
    expect(buscarProductosCatalogo).not.toHaveBeenCalled();
    // Si hubiera descontado cupo, agotar las 10 búsquedas válidas de
    // abajo bloquearía la búsqueda 10 (no la 11) — confirma que el
    // intento inválido de arriba no contó para nada.
    vi.mocked(buscarProductosCatalogo).mockResolvedValue([]);
    for (let i = 0; i < LIMITE_BUSQUEDAS_POR_MINUTO; i++) {
      await expect(buscarInvestigacionProducto("empresa-cupo", "reloj digital")).resolves.toBeDefined();
    }
    await expect(buscarInvestigacionProducto("empresa-cupo", "reloj digital")).rejects.toThrow(LimiteBusquedasError);
  });

  // Issue #147, punto 3 — "si todas las ofertas fallaron por 403, el
  // aviso lo dice" (nunca se confunde con "sin ofertas reales", que es
  // un caso legítimo y distinto — ver la otra prueba de 404 arriba).
  it("si TODAS las ofertas fallan por falta de permiso de la app (403), el aviso lo dice explícitamente", async () => {
    vi.mocked(buscarProductosCatalogo)
      .mockResolvedValueOnce([
        { id: "MCO1", nombre: "Reloj digital casio", foto: null },
        { id: "MCO2", nombre: "Reloj digital negro", foto: null },
      ])
      .mockResolvedValue([]);
    vi.mocked(obtenerOfertasProducto).mockRejectedValue(new MlSinPermisoAppErrorFalso("/products/MCO1/items"));

    const resultado = await buscarInvestigacionProducto("empresa-1", "reloj digital");
    expect(resultado.aviso).toMatch(/no le da permiso a la app para ver ofertas/i);
  });

  // Mezcla real: algunas ofertas fallan por 403 y otras simplemente no
  // tienen ninguna oferta real — el aviso de "falta permiso" es
  // específico SOLO cuando el 403 explica el 100% de los fallos.
  it("ofertas con 403 mezcladas con candidatos sin ofertas reales: no se confunde con el aviso de falta de permiso", async () => {
    vi.mocked(buscarProductosCatalogo)
      .mockResolvedValueOnce([
        { id: "MCO1", nombre: "Reloj digital casio", foto: null },
        { id: "MCO2", nombre: "Reloj digital negro", foto: null },
      ])
      .mockResolvedValue([]);
    vi.mocked(obtenerOfertasProducto).mockImplementation(async (productId: string) => {
      if (productId === "MCO1") throw new MlSinPermisoAppErrorFalso("/products/MCO1/items");
      return []; // MCO2: sin ofertas reales, no es un 403
    });

    const resultado = await buscarInvestigacionProducto("empresa-1", "reloj digital");
    expect(resultado.aviso).toMatch(/ninguno de sus productos tiene publicaciones activas/i);
    expect(resultado.aviso).not.toMatch(/permiso/i);
  });

  // Issue #147, punto 4 — highlights trae PRODUCT (catálogo, vía
  // obtenerProducto), ITEM (publicación real, vía obtenerItemMl —
  // endpoint DISTINTO) y USER_PRODUCT (se ignora, nunca se manda a
  // ningún endpoint). Antes TODOS se trataban como PRODUCT, y un ITEM
  // se mandaba a obtenerOfertasProducto (GET /products/{id}/items),
  // que le da 404 siempre — un ITEM nunca producía ninguna
  // publicación. Ahora obtenerItemMl ya trae la oferta armada desde el
  // mismo /items/{id}: obtenerOfertasProducto se llama SOLO para el
  // PRODUCT, y el ITEM igual aparece en el resultado.
  it("highlights con los 3 tipos: PRODUCT va a obtenerProducto+obtenerOfertasProducto, ITEM a obtenerItemMl (con su propia oferta), USER_PRODUCT se ignora", async () => {
    vi.mocked(buscarProductosCatalogo).mockResolvedValue([]); // sin candidatos de texto, solo los de categoría
    vi.mocked(resolverCategoria).mockResolvedValue({ categoryId: "CAT1" });
    vi.mocked(obtenerMejoresProductosCategoria).mockResolvedValue([
      { id: "MCO1", tipo: "PRODUCT" },
      { id: "MCO2", tipo: "ITEM" },
      { id: "MCOU3", tipo: "USER_PRODUCT" },
    ]);
    vi.mocked(obtenerProducto).mockResolvedValue({ id: "MCO1", nombre: "Reloj digital de catálogo", foto: null });
    vi.mocked(obtenerItemMl).mockResolvedValue({
      producto: { id: "MCO2", nombre: "Reloj digital publicación", foto: null },
      oferta: { itemId: "MCO222", precio: 35_000, monedaId: "COP", sellerId: null, esFull: false, esEnvioGratis: null },
    });
    vi.mocked(obtenerOfertasProducto).mockResolvedValue([
      { itemId: "MCO111", precio: 20_000, monedaId: "COP", sellerId: null, esFull: false, esEnvioGratis: null },
    ]);

    const resultado = await buscarInvestigacionProducto("empresa-1", "reloj digital");

    expect(obtenerProducto).toHaveBeenCalledWith("MCO1", "token-falso");
    expect(obtenerItemMl).toHaveBeenCalledWith("MCO2", "token-falso");
    expect(obtenerProducto).not.toHaveBeenCalledWith("MCOU3", expect.anything());
    expect(obtenerItemMl).not.toHaveBeenCalledWith("MCOU3", expect.anything());
    // obtenerOfertasProducto SOLO para el PRODUCT (MCO1) — el ITEM (MCO2)
    // nunca pasa por ahí, ya trae su oferta resuelta.
    expect(obtenerOfertasProducto).toHaveBeenCalledTimes(1);
    expect(obtenerOfertasProducto).toHaveBeenCalledWith("MCO1", "token-falso");
    // El ITEM igual aparece en el resultado final, construido directo
    // de la oferta que trajo obtenerItemMl.
    expect(resultado.publicacionesEncontradas).toBe(2);
    expect(resultado.publicaciones.map((p) => p.itemId).sort()).toEqual(["MCO111", "MCO222"]);
  });

  it("límite de búsquedas por minuto por empresa: la búsqueda número 11 en la misma ventana se bloquea", async () => {
    vi.mocked(buscarProductosCatalogo).mockResolvedValue([]);
    const t0 = 10_000_000;
    for (let i = 0; i < LIMITE_BUSQUEDAS_POR_MINUTO; i++) {
      await buscarInvestigacionProducto("empresa-limite", "reloj digital", t0 + i);
    }
    await expect(buscarInvestigacionProducto("empresa-limite", "reloj digital", t0 + LIMITE_BUSQUEDAS_POR_MINUTO)).rejects.toThrow(LimiteBusquedasError);
  });

  it("el límite de búsquedas es por empresa: otra empresa no se ve afectada por el tope de la primera", async () => {
    vi.mocked(buscarProductosCatalogo).mockResolvedValue([]);
    const t0 = 20_000_000;
    for (let i = 0; i < LIMITE_BUSQUEDAS_POR_MINUTO; i++) {
      await buscarInvestigacionProducto("empresa-A", "reloj digital", t0 + i);
    }
    // empresa-B arranca su propia cuenta en cero, aunque empresa-A ya esté en el tope.
    await expect(buscarInvestigacionProducto("empresa-B", "reloj digital", t0)).resolves.toBeDefined();
  });

  it("pasado un minuto, la empresa puede volver a buscar", async () => {
    vi.mocked(buscarProductosCatalogo).mockResolvedValue([]);
    const t0 = 30_000_000;
    for (let i = 0; i < LIMITE_BUSQUEDAS_POR_MINUTO; i++) {
      await buscarInvestigacionProducto("empresa-ventana", "reloj digital", t0 + i);
    }
    await expect(buscarInvestigacionProducto("empresa-ventana", "reloj digital", t0 + 60_001)).resolves.toBeDefined();
  });
});
