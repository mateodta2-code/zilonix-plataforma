import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #175 — mockea lib/ml/cliente.ts por completo: esta prueba es
// de la TRADUCCIÓN (lib/seguimiento/lector.ts), nunca de las llamadas
// reales (eso ya lo prueba lib/ml/cliente.test.ts con fetch simulado).
vi.mock("@/lib/ml/cliente", () => ({
  obtenerFotoItemMl: vi.fn(),
  obtenerOfertasProducto: vi.fn(),
  obtenerPublicacionesVendedorAjenoMl: vi.fn(),
}));

import { obtenerFotoItemMl, obtenerOfertasProducto, obtenerPublicacionesVendedorAjenoMl } from "@/lib/ml/cliente";
import { leerFotoSeguimiento } from "./lector";

const CUENTA_PROPIA = "111111111";

describe("leerFotoSeguimiento — tienda", () => {
  beforeEach(() => vi.clearAllMocks());

  it("solo llama a obtenerPublicacionesVendedorAjenoMl, con el resto de la foto vacío", async () => {
    vi.mocked(obtenerPublicacionesVendedorAjenoMl).mockResolvedValue([{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }]);

    const resultado = await leerFotoSeguimiento({ tipo: "tienda", recursoMl: "seller", mlIdExterno: "222222222" }, "token", CUENTA_PROPIA);

    expect(obtenerPublicacionesVendedorAjenoMl).toHaveBeenCalledWith("222222222", "token");
    expect(obtenerFotoItemMl).not.toHaveBeenCalled();
    expect(obtenerOfertasProducto).not.toHaveBeenCalled();
    expect(resultado.publicaciones).toEqual([{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }]);
    expect(resultado.precio).toBeNull();
    expect(resultado.estado).toBeNull();
  });

  // Issue #250, punto B — "sin dato de la API" (null) nunca se
  // confunde con "la tienda no tiene publicaciones" ([]): se propaga
  // tal cual, nunca revienta ni se convierte en [].
  it("obtenerPublicacionesVendedorAjenoMl devuelve null (sin dato de la API hoy): se propaga tal cual, nunca revienta", async () => {
    vi.mocked(obtenerPublicacionesVendedorAjenoMl).mockResolvedValue(null);

    const resultado = await leerFotoSeguimiento({ tipo: "tienda", recursoMl: "seller", mlIdExterno: "222222222" }, "token", CUENTA_PROPIA);

    expect(resultado.publicaciones).toBeNull();
  });
});

describe("leerFotoSeguimiento — producto, recursoMl item", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin catalogProductId: nunca llama a obtenerOfertasProducto, ganaBotonCompra queda null", async () => {
    vi.mocked(obtenerFotoItemMl).mockResolvedValue({
      precio: 100,
      precioAnterior: null,
      inventarioDisponible: 5,
      vendidos: 10,
      estado: "active",
      enCatalogo: false,
      catalogProductId: null,
      esFull: false,
      esEnvioGratis: null,
      fechaCreacion: "2024-01-01T00:00:00.000Z",
    });

    const resultado = await leerFotoSeguimiento({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", CUENTA_PROPIA);

    expect(obtenerOfertasProducto).not.toHaveBeenCalled();
    expect(resultado.ganaBotonCompra).toBeNull();
    expect(resultado.precio).toBe(100);
    expect(resultado.vendidos).toBe(10);
    // item ajeno con inventario real -> siempre marcado aproximado
    expect(resultado.inventarioAproximado).toBe(true);
    // Issue #251 — date_created real de la API, reusado tal cual.
    expect(resultado.fechaCreacion).toBe("2024-01-01T00:00:00.000Z");
  });

  it("con catalogProductId: gana el botón de compra si nuestro itemId es la primera oferta", async () => {
    vi.mocked(obtenerFotoItemMl).mockResolvedValue({
      precio: 100,
      precioAnterior: 120,
      inventarioDisponible: 5,
      vendidos: 10,
      estado: "active",
      enCatalogo: true,
      catalogProductId: "MCO999",
      esFull: true,
      esEnvioGratis: true,
      fechaCreacion: null,
    });
    vi.mocked(obtenerOfertasProducto).mockResolvedValue([
      { itemId: "MCO111", precio: 100, monedaId: "COP", sellerId: "333", esFull: true, esEnvioGratis: true, vendidos: null, fechaCreacion: null, permalink: null },
      { itemId: "MCO222", precio: 105, monedaId: "COP", sellerId: "444", esFull: false, esEnvioGratis: false, vendidos: null, fechaCreacion: null, permalink: null },
    ]);

    const resultado = await leerFotoSeguimiento({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", CUENTA_PROPIA);

    expect(obtenerOfertasProducto).toHaveBeenCalledWith("MCO999", "token");
    expect(resultado.ganaBotonCompra).toBe(true);
  });

  it("con catalogProductId pero NUESTRA oferta no es la primera: perdió el botón de compra", async () => {
    vi.mocked(obtenerFotoItemMl).mockResolvedValue({
      precio: 105,
      precioAnterior: null,
      inventarioDisponible: 5,
      vendidos: 10,
      estado: "active",
      enCatalogo: true,
      catalogProductId: "MCO999",
      esFull: false,
      esEnvioGratis: false,
      fechaCreacion: null,
    });
    vi.mocked(obtenerOfertasProducto).mockResolvedValue([
      { itemId: "MCO222", precio: 100, monedaId: "COP", sellerId: "444", esFull: true, esEnvioGratis: true, vendidos: null, fechaCreacion: null, permalink: null },
      { itemId: "MCO111", precio: 105, monedaId: "COP", sellerId: "333", esFull: false, esEnvioGratis: false, vendidos: null, fechaCreacion: null, permalink: null },
    ]);

    const resultado = await leerFotoSeguimiento({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", CUENTA_PROPIA);

    expect(resultado.ganaBotonCompra).toBe(false);
  });

  it("item no disponible (obtenerFotoItemMl null): foto vacía, nunca revienta", async () => {
    vi.mocked(obtenerFotoItemMl).mockResolvedValue(null);
    const resultado = await leerFotoSeguimiento({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", CUENTA_PROPIA);
    expect(resultado.precio).toBeNull();
    expect(resultado.ganaBotonCompra).toBeNull();
    expect(obtenerOfertasProducto).not.toHaveBeenCalled();
  });
});

describe("leerFotoSeguimiento — producto, recursoMl product (catálogo directo)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gana el botón de compra cuando la cuenta PROPIA es la primera oferta", async () => {
    vi.mocked(obtenerOfertasProducto).mockResolvedValue([
      { itemId: "MCO111", precio: 100, monedaId: "COP", sellerId: CUENTA_PROPIA, esFull: true, esEnvioGratis: true, vendidos: null, fechaCreacion: "2024-06-01T00:00:00.000Z", permalink: null },
      { itemId: "MCO222", precio: 105, monedaId: "COP", sellerId: "444", esFull: false, esEnvioGratis: false, vendidos: null, fechaCreacion: null, permalink: null },
    ]);

    const resultado = await leerFotoSeguimiento({ tipo: "producto", recursoMl: "product", mlIdExterno: "MCO999" }, "token", CUENTA_PROPIA);

    expect(obtenerFotoItemMl).not.toHaveBeenCalled();
    expect(resultado.ganaBotonCompra).toBe(true);
    expect(resultado.precio).toBe(100);
    expect(resultado.enCatalogo).toBe(true);
    // Issue #262 (revisión de Pablo, punto bloqueante) — bug real
    // corregido: ANTES esto devolvía el `fechaCreacion` de la oferta
    // GANADORA (acá, "2024-06-01...") como si fuera la antigüedad del
    // catálogo — es el date_created de un ÍTEM puntual de un vendedor
    // cualquiera, nunca el del catálogo en sí. Ahora SIEMPRE null para
    // recursoMl "product", sin importar qué fechaCreacion traiga la
    // oferta ganadora — el date_created real del catálogo sale aparte
    // (resolverNombreYFechaCatalogo, lib/seguimiento/seguimientos.ts).
    expect(resultado.fechaCreacion).toBeNull();
  });

  it("sin ninguna oferta real: foto vacía salvo enCatalogo en null (nunca se afirma catálogo sin ofertas)", async () => {
    vi.mocked(obtenerOfertasProducto).mockResolvedValue([]);
    const resultado = await leerFotoSeguimiento({ tipo: "producto", recursoMl: "product", mlIdExterno: "MCO999" }, "token", CUENTA_PROPIA);
    expect(resultado.ganaBotonCompra).toBeNull();
    expect(resultado.precio).toBeNull();
  });
});
