import { afterEach, describe, expect, it, vi } from "vitest";

// Rama fix-promociones-aprobadas-participando, punto 3 — IMPORTANTE:
// este módulo toca Postgres (dbComoEmpresa) y Mercado Libre
// (obtenerAccessTokenVigente, leerPromocionesItemMl) — ninguno existe
// en este sandbox, y la instrucción explícita de Mateo es que ninguna
// prueba automática llame nunca un DELETE/POST real a ML. Mismo patrón
// de mock ya usado en lib/trabajos/buscarPromocionesMultiCuenta.test.ts.
const { filasPorTabla } = vi.hoisted(() => ({ filasPorTabla: new Map<unknown, unknown[]>() }));

vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => unknown) => {
    const tx = {
      select: () => ({
        from: (tabla: unknown) => ({
          where: async () => filasPorTabla.get(tabla) ?? [],
        }),
      }),
    };
    return fn(tx);
  },
}));

const { obtenerAccessTokenVigenteMock } = vi.hoisted(() => ({
  obtenerAccessTokenVigenteMock: vi.fn(async () => "token-falso"),
}));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: obtenerAccessTokenVigenteMock }));

const { leerPromocionesItemMlMock } = vi.hoisted(() => ({ leerPromocionesItemMlMock: vi.fn() }));
vi.mock("@/lib/ml/cliente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/cliente")>();
  return { ...real, leerPromocionesItemMl: leerPromocionesItemMlMock };
});

import { costosSku, promocionesCandidatos, promocionesReglas } from "@/db/schema";
import { listarParticipandoCuenta } from "./promocionesParticipando";

function candidatoDescubierto(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "MCO1",
    skuCodigo: "SKU-1",
    tituloProducto: "Producto participando",
    thumbnail: "https://x/thumb.jpg",
    tipoPromocion: "DEAL",
    promotionIdMl: "PROMO-1",
    ...overrides,
  };
}

function promoCruda(overrides: Record<string, unknown> = {}) {
  return {
    id: "PROMO-1",
    type: "DEAL",
    status: "started",
    price: 90000,
    original_price: 100000,
    max_discounted_price: 95000,
    start_date: "2026-11-01T00:00:00-05:00",
    finish_date: "2026-11-30T23:59:59-05:00",
    ...overrides,
  };
}

function limpiar() {
  filasPorTabla.clear();
  vi.clearAllMocks();
  obtenerAccessTokenVigenteMock.mockResolvedValue("token-falso");
}

describe("listarParticipandoCuenta — rama fix-promociones-aprobadas-participando, punto 3", () => {
  afterEach(limpiar);

  it("sin ningún candidato started/pending en el snapshot: lista vacía, nunca llama a Mercado Libre", async () => {
    filasPorTabla.set(promocionesCandidatos, []);
    const filas = await listarParticipandoCuenta("empresa-1", "cuenta-1");
    expect(filas).toEqual([]);
    expect(leerPromocionesItemMlMock).not.toHaveBeenCalled();
  });

  it("caso real: trae precio, %, fechas, utilidad y si se puede salir por API", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoDescubierto()]);
    filasPorTabla.set(promocionesReglas, [{ descuentoMaximoPct: 20, participarCompartidas: false, igualarAlPiso: true }]);
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "60000" }]);
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [promoCruda()] });

    const filas = await listarParticipandoCuenta("empresa-1", "cuenta-1");

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      itemId: "MCO1",
      tipoPromocion: "DEAL",
      estadoMl: "started",
      precioActual: 90000,
      precioMinimo: 90000,
      gananciaEstimada: 30000, // 90000 - 60000
      fechaInicio: "2026-11-01T00:00:00",
      fechaFin: "2026-11-30T23:59:59",
      puedeSalirApi: false, // DEAL: una vez activa, la doc de ML no deja DELETE
    });
  });

  it("tipo que SÍ se puede dejar por API (ej. PRICE_DISCOUNT): puedeSalirApi true", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoDescubierto({ tipoPromocion: "PRICE_DISCOUNT", promotionIdMl: "PROMO-2" })]);
    filasPorTabla.set(promocionesReglas, [{ descuentoMaximoPct: 20, participarCompartidas: false, igualarAlPiso: true }]);
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "60000" }]);
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [promoCruda({ id: "PROMO-2", type: "PRICE_DISCOUNT" })] });

    const filas = await listarParticipandoCuenta("empresa-1", "cuenta-1");
    expect(filas[0]?.puedeSalirApi).toBe(true);
  });

  it("la cuenta ya salió de esa promo desde que se guardó el snapshot (ya no está started/pending en vivo): se omite, nunca se muestra 'participando' algo que ya no lo es", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoDescubierto()]);
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [] }); // ya no hay ninguna promo real para este ítem

    const filas = await listarParticipandoCuenta("empresa-1", "cuenta-1");
    expect(filas).toEqual([]);
  });

  it("un ítem con error puntual (403/401/5xx) al revalidar: se omite, nunca rompe el resto de la lista", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoDescubierto({ itemId: "MCO1" }), candidatoDescubierto({ itemId: "MCO2", promotionIdMl: "PROMO-3" })]);
    filasPorTabla.set(promocionesReglas, [{ descuentoMaximoPct: 20, participarCompartidas: false, igualarAlPiso: true }]);
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "60000" }]);
    leerPromocionesItemMlMock.mockImplementation(async (itemId: string) => {
      if (itemId === "MCO1") return { estado: "sin_permiso" };
      return { estado: "ok", promociones: [promoCruda({ id: "PROMO-3" })] };
    });

    const filas = await listarParticipandoCuenta("empresa-1", "cuenta-1");
    expect(filas).toHaveLength(1);
    expect(filas[0]?.itemId).toBe("MCO2");
  });

  it("NUNCA llama a salirDePromocionMl ni a ningún DELETE/POST real — solo lee (leerPromocionesItemMl)", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoDescubierto()]);
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [promoCruda()] });

    await listarParticipandoCuenta("empresa-1", "cuenta-1");
    expect(leerPromocionesItemMlMock).toHaveBeenCalled();
    // Este módulo (listar) nunca escribe — "Dejar de participar" vive
    // en una ruta separada (app/api/ml/promociones/participando/salir),
    // con su propio test, también con mocks.
  });
});
