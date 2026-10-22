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

vi.mock("@/lib/ml/cliente", () => ({
  buscarProductosCatalogo: vi.fn(),
  resolverCategoria: vi.fn(),
  obtenerMejoresProductosCategoria: vi.fn(),
  obtenerProducto: vi.fn(),
  obtenerOfertasProducto: vi.fn(),
  obtenerVendedor: vi.fn(),
  linkPublicacion: (itemId: string) => `https://articulo.mercadolibre.com.co/${itemId}`,
}));
vi.mock("@/lib/ml/cuentas", () => ({
  obtenerCuentaMlActiva: vi.fn(),
  obtenerAccessTokenVigente: vi.fn(),
}));

import { buscarProductosCatalogo, obtenerMejoresProductosCategoria, obtenerOfertasProducto, obtenerProducto, obtenerVendedor, resolverCategoria } from "@/lib/ml/cliente";
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
