import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aplicarVendidosExtension, combinarKpisConCompletados, ordenarPorVendidos, type KpisDemanda, type VendidosExtension } from "./investigacionCliente";
import type { PublicacionInvestigacion } from "./investigacion";

const AHORA = new Date("2026-10-31T00:00:00.000Z");

function publicacion(parciales: Partial<PublicacionInvestigacion> & { itemId: string }): PublicacionInvestigacion {
  return {
    productId: null,
    titulo: "Producto",
    foto: null,
    precio: 100_000,
    moneda: "COP",
    esFull: false,
    esEnvioGratis: null,
    vendedor: "Vendedor X",
    esPlatinum: false,
    link: "https://articulo.mercadolibre.com.co/MCO-1",
    vendidos: null,
    ventasMesEstimadas: null,
    facturacionMesEstimada: null,
    ...parciales,
  };
}

function datosExtension(parciales: Partial<VendidosExtension> & { itemId: string }): VendidosExtension {
  return { sold_quantity: 100, date_created: "2026-10-11T00:00:00.000Z", esFull: false, etiquetaMasN: false, ...parciales };
}

describe("aplicarVendidosExtension — issue #210 (bridge extensión → panel)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });
  afterEach(() => vi.useRealTimers());

  it("completa vendidos/ventasMesEstimadas/facturacionMesEstimada cuando la publicación no tenía dato", () => {
    const publicaciones = [publicacion({ itemId: "MCO1", precio: 1000 })];
    const resultado = aplicarVendidosExtension(publicaciones, datosExtension({ itemId: "MCO1" }));

    expect(resultado[0].vendidos).toBe(100);
    // Creado hace 20 días, sin Full ni +N: 100*30/20 = 150.
    expect(resultado[0].ventasMesEstimadas).toBe(150);
    expect(resultado[0].facturacionMesEstimada).toBe(1000 * 150);
  });

  it("nunca pisa un vendidos que ya vino real de la API", () => {
    const publicaciones = [publicacion({ itemId: "MCO1", vendidos: 7 })];
    const resultado = aplicarVendidosExtension(publicaciones, datosExtension({ itemId: "MCO1", sold_quantity: 999 }));

    expect(resultado[0].vendidos).toBe(7);
  });

  it("no toca publicaciones de otro itemId", () => {
    const publicaciones = [publicacion({ itemId: "MCO1" }), publicacion({ itemId: "MCO2" })];
    const resultado = aplicarVendidosExtension(publicaciones, datosExtension({ itemId: "MCO1" }));

    expect(resultado[0].vendidos).toBe(100);
    expect(resultado[1].vendidos).toBeNull();
  });

  it("aplica el multiplicador +N (etiquetaMasN) igual que el servidor", () => {
    const publicaciones = [publicacion({ itemId: "MCO1", precio: 1000 })];
    const resultado = aplicarVendidosExtension(publicaciones, datosExtension({ itemId: "MCO1", etiquetaMasN: true }));

    expect(resultado[0].ventasMesEstimadas).toBe((100 * 1.55 * 30) / 20);
  });
});

describe("ordenarPorVendidos", () => {
  it("con dato real siempre antes que sin dato, sin importar el precio", () => {
    const publicaciones = [publicacion({ itemId: "A", vendidos: null, precio: 999_999 }), publicacion({ itemId: "B", vendidos: 5, precio: 1 })];
    const [primero] = ordenarPorVendidos(publicaciones);
    expect(primero.itemId).toBe("B");
  });

  it("entre las que tienen dato real, más vendidos primero", () => {
    const publicaciones = [publicacion({ itemId: "A", vendidos: 3 }), publicacion({ itemId: "B", vendidos: 10 })];
    const [primero] = ordenarPorVendidos(publicaciones);
    expect(primero.itemId).toBe("B");
  });

  it("entre las que no tienen dato real, precio descendente", () => {
    const publicaciones = [publicacion({ itemId: "A", vendidos: null, precio: 100 }), publicacion({ itemId: "B", vendidos: null, precio: 500 })];
    const [primero] = ordenarPorVendidos(publicaciones);
    expect(primero.itemId).toBe("B");
  });
});

describe("combinarKpisConCompletados — issue #210", () => {
  const base: KpisDemanda = {
    vendidosTotalesReales: 40,
    publicacionesConVendidosReal: 4,
    promedioVendidosPorPublicacion: 10,
    facturacionMesTotalEstimada: 400_000,
  };

  it("sin completadas, devuelve exactamente la base del servidor (nunca recalcula sobre el Top 10 solo)", () => {
    expect(combinarKpisConCompletados(base, [])).toBe(base);
  });

  it("suma el aporte de cada fila completada sin tocar el denominador real (publicacionesEncontradas)", () => {
    const completadas = [publicacion({ itemId: "A", vendidos: 10, facturacionMesEstimada: 100_000 })];
    const resultado = combinarKpisConCompletados(base, completadas);

    expect(resultado.vendidosTotalesReales).toBe(50);
    expect(resultado.publicacionesConVendidosReal).toBe(5);
    expect(resultado.promedioVendidosPorPublicacion).toBe(10);
    expect(resultado.facturacionMesTotalEstimada).toBe(500_000);
  });

  it("parte de null (nunca de 0) cuando la base no tenía ningún dato real todavía", () => {
    const baseVacia: KpisDemanda = { vendidosTotalesReales: null, publicacionesConVendidosReal: 0, promedioVendidosPorPublicacion: null, facturacionMesTotalEstimada: null };
    const completadas = [publicacion({ itemId: "A", vendidos: 5, facturacionMesEstimada: 50_000 })];
    const resultado = combinarKpisConCompletados(baseVacia, completadas);

    expect(resultado.vendidosTotalesReales).toBe(5);
    expect(resultado.publicacionesConVendidosReal).toBe(1);
    expect(resultado.promedioVendidosPorPublicacion).toBe(5);
    expect(resultado.facturacionMesTotalEstimada).toBe(50_000);
  });

  // Corrección de Pablo (revisión PR #211) — bug real: facturacionMesEstimada
  // puede quedar null en una fila completada (ventasMesEst sin
  // dateCreated, ver investigacionCliente.ts) — sumarla con `?? 0`
  // inventaba un "$0 Estimado" en vez de "Sin dato" cuando ni la base
  // ni ninguna fila nueva traían el número.
  it("base null + fila completada sin facturacionMesEstimada (vendidos sin dateCreated): queda null, nunca 0", () => {
    const baseVacia: KpisDemanda = { vendidosTotalesReales: null, publicacionesConVendidosReal: 0, promedioVendidosPorPublicacion: null, facturacionMesTotalEstimada: null };
    const completadas = [publicacion({ itemId: "A", vendidos: 5, facturacionMesEstimada: null })];
    const resultado = combinarKpisConCompletados(baseVacia, completadas);

    expect(resultado.vendidosTotalesReales).toBe(5);
    expect(resultado.facturacionMesTotalEstimada).toBeNull();
  });

  it("base con facturación real + fila completada sin facturacionMesEstimada: mantiene la base tal cual, nunca le resta ni le suma 0 de más", () => {
    const completadas = [publicacion({ itemId: "A", vendidos: 5, facturacionMesEstimada: null })];
    const resultado = combinarKpisConCompletados(base, completadas);

    expect(resultado.facturacionMesTotalEstimada).toBe(400_000);
  });
});
