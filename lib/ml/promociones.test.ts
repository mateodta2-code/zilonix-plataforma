import { afterEach, describe, expect, it, vi } from "vitest";

// MED 8 / HIGH 2 (review de Pablo) — listarTodosLosItemsActivos toca
// Mercado Libre (lib/ml/cliente) y las 2 lecturas "frescas" tocan
// Postgres (dbComoEmpresa) — ninguno existe en este sandbox. Mismo
// patrón de mock que lib/trabajos/buscarPromocionesMultiCuenta.test.ts:
// una tabla "tx" mínima que devuelve lo programado por tabla.
const { listarItemsActivosMlMock } = vi.hoisted(() => ({ listarItemsActivosMlMock: vi.fn() }));
vi.mock("@/lib/ml/cliente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/cliente")>();
  return { ...real, listarItemsActivosMl: listarItemsActivosMlMock };
});

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

import { costosSku, promocionesReglas } from "@/db/schema";
import {
  calcularCandidatosItem,
  fechasParaParticipar,
  leerPisoYCostoFresco,
  leerPisosYCostosFrescos,
  leerReglasFrescasCuenta,
  listarTodosLosItemsActivos,
  REGLAS_POR_DEFECTO,
  TIPOS_SIN_ESCRITURA_API,
  type ItemConPromociones,
  type ReglasCuentaPromocion,
} from "./promociones";

const REGLAS_DEFECTO: ReglasCuentaPromocion = { descuentoMaximoPct: 20, participarCompartidas: false, igualarAlPiso: true };

function item(overrides: Partial<ItemConPromociones> = {}): ItemConPromociones {
  return {
    itemId: "MCO111",
    cuentaMlId: "cuenta-1",
    nickname: "Cuenta 1",
    tituloProducto: "Producto de prueba",
    thumbnail: "https://x/thumb.jpg",
    skuCodigo: "SKU-1",
    tieneVariantes: false,
    promociones: [],
    ...overrides,
  };
}

// Rama feat-promociones — mismos 7 bugs reales ya resueltos en
// zilonix-os-web (docs/investigacion/promociones-mercado-libre.md,
// §7 de ese documento), portados como casos de prueba acá para no
// volver a pisarlos.
describe("calcularCandidatosItem — motor de reglas (rama feat-promociones)", () => {
  it("bug 1 — producto con variantes: SIEMPRE a mano, sin importar tipo/estado/piso", () => {
    const resultado = calcularCandidatosItem(
      item({ tieneVariantes: true, promociones: [{ type: "DEAL", status: "candidate", original_price: 100000, max_discounted_price: 90000 }] }),
      REGLAS_DEFECTO,
      80000,
      50000
    );
    expect(resultado[0].cumpleReglas).toBe(false);
    expect(resultado[0].accionSugerida).toBeNull();
    expect(resultado[0].motivoRevisarManual).toContain("variantes");
  });

  it("bug 5 — PRICE_DISCOUNT/LIGHTNING/SMART/UNHEALTHY_STOCK: solo_en_ml, nunca se intenta escribir", () => {
    for (const tipo of TIPOS_SIN_ESCRITURA_API) {
      const resultado = calcularCandidatosItem(
        item({ promociones: [{ type: tipo, status: "candidate", original_price: 100000 }] }),
        REGLAS_DEFECTO,
        80000,
        50000
      );
      expect(resultado[0].soloEnMl).toBe(true);
      expect(resultado[0].accionSugerida).toBeNull();
      expect(resultado[0].motivoRevisarManual).toContain(tipo);
    }
  });

  it("bug 7 (regla nueva de Mateo) — sin precio mínimo en costos_sku: bloqueado, nunca inventa un piso con el sugerido de ML", () => {
    const resultado = calcularCandidatosItem(
      item({ promociones: [{ type: "DEAL", status: "candidate", original_price: 100000, suggested_discounted_price: 85000 }] }),
      REGLAS_DEFECTO,
      null, // sin precio mínimo
      50000
    );
    expect(resultado[0].cumpleReglas).toBe(false);
    expect(resultado[0].accionSugerida).toBeNull();
    expect(resultado[0].precioSugerido).toBeNull();
    expect(resultado[0].motivoRevisarManual).toContain("precio mínimo");
  });

  it("bug 6 — el piso supera max_discounted_price de esa promoción puntual: revisar manual, nunca participa por debajo del piso", () => {
    const resultado = calcularCandidatosItem(
      item({ promociones: [{ type: "DEAL", status: "candidate", original_price: 100000, max_discounted_price: 70000 }] }),
      REGLAS_DEFECTO,
      80000, // piso por encima del máximo de 70000
      50000
    );
    expect(resultado[0].cumpleReglas).toBe(false);
    expect(resultado[0].accionSugerida).toBeNull();
    expect(resultado[0].motivoRevisarManual).toContain("máximo");
  });

  it("bug 4 — promoción compartida (+Meli): bloqueada por defecto (participarCompartidas=false)", () => {
    const resultado = calcularCandidatosItem(
      item({ promociones: [{ type: "DEAL", status: "candidate", original_price: 100000, meli_percentage: 10 }] }),
      REGLAS_DEFECTO,
      90000,
      50000
    );
    expect(resultado[0].esCompartida).toBe(true);
    expect(resultado[0].cumpleReglas).toBe(false);
    expect(resultado[0].motivoRevisarManual).toContain("compartida");
  });

  it("compartida con participarCompartidas=true en la cuenta: sí se calcula participar", () => {
    const reglas: ReglasCuentaPromocion = { ...REGLAS_DEFECTO, participarCompartidas: true };
    const resultado = calcularCandidatosItem(
      item({ promociones: [{ type: "DEAL", status: "candidate", original_price: 100000, meli_percentage: 10 }] }),
      reglas,
      90000,
      50000
    );
    expect(resultado[0].cumpleReglas).toBe(true);
    expect(resultado[0].accionSugerida).toBe("participar");
    expect(resultado[0].precioSugerido).toBe(90000);
  });

  it("tope de descuento — igualar al piso implica más del tope configurado: revisar manual", () => {
    const reglas: ReglasCuentaPromocion = { ...REGLAS_DEFECTO, descuentoMaximoPct: 15 };
    // Piso de 70000 sobre un original de 100000 = 30% de descuento, por encima del 15% configurado.
    const resultado = calcularCandidatosItem(
      item({ promociones: [{ type: "DEAL", status: "candidate", original_price: 100000 }] }),
      reglas,
      70000,
      40000
    );
    expect(resultado[0].cumpleReglas).toBe(false);
    expect(resultado[0].motivoRevisarManual).toContain("15%");
  });

  it("dentro del tope de descuento: participa, con ganancia estimada real contra el costo", () => {
    // Piso de 90000 sobre 100000 = 10%, dentro del tope de 20%.
    const resultado = calcularCandidatosItem(
      item({ promociones: [{ type: "DEAL", status: "candidate", original_price: 100000 }] }),
      REGLAS_DEFECTO,
      90000,
      50000
    );
    expect(resultado[0].cumpleReglas).toBe(true);
    expect(resultado[0].accionSugerida).toBe("participar");
    expect(resultado[0].precioSugerido).toBe(90000);
    expect(resultado[0].gananciaEstimada).toBe(40000);
  });

  it("igualar — una promoción ya confirmada por encima del piso se baja a igualarlo (tipo 'modificar')", () => {
    const resultado = calcularCandidatosItem(
      item({ promociones: [{ type: "DEAL", status: "started", price: 95000, original_price: 100000 }] }),
      REGLAS_DEFECTO,
      80000,
      50000
    );
    expect(resultado[0].cumpleReglas).toBe(true);
    expect(resultado[0].accionSugerida).toBe("modificar");
    expect(resultado[0].precioSugerido).toBe(80000);
  });

  it("igualarAlPiso=false en la cuenta: una promoción confirmada por encima del piso NO se toca", () => {
    const reglas: ReglasCuentaPromocion = { ...REGLAS_DEFECTO, igualarAlPiso: false };
    const resultado = calcularCandidatosItem(
      item({ promociones: [{ type: "DEAL", status: "started", price: 95000, original_price: 100000 }] }),
      reglas,
      80000,
      50000
    );
    expect(resultado[0].cumpleReglas).toBe(true);
    expect(resultado[0].accionSugerida).toBeNull();
    expect(resultado[0].precioSugerido).toBe(95000);
  });

  it("una promoción confirmada ya igual o por debajo del piso: cumple, sin acción", () => {
    const resultado = calcularCandidatosItem(
      item({ promociones: [{ type: "DEAL", status: "started", price: 75000, original_price: 100000 }] }),
      REGLAS_DEFECTO,
      80000,
      50000
    );
    expect(resultado[0].cumpleReglas).toBe(true);
    expect(resultado[0].accionSugerida).toBeNull();
  });

  it("varias promociones del mismo item: cada una se calcula de forma independiente", () => {
    const resultado = calcularCandidatosItem(
      item({
        promociones: [
          { type: "DEAL", status: "candidate", original_price: 100000 },
          { type: "LIGHTNING", status: "candidate", original_price: 100000 },
        ],
      }),
      REGLAS_DEFECTO,
      90000,
      50000
    );
    expect(resultado).toHaveLength(2);
    expect(resultado[0].accionSugerida).toBe("participar");
    expect(resultado[1].soloEnMl).toBe(true);
  });
});

describe("fechasParaParticipar — bug 3 (formato local Colombia, sin zona horaria)", () => {
  it("usa las fechas reales de la promoción cuando vienen, recortadas a 19 caracteres sin zona", () => {
    const resultado = fechasParaParticipar({ start_date: "2026-11-01T00:00:00-05:00", finish_date: "2026-11-30T23:59:59-05:00" });
    expect(resultado.fechaInicio).toBe("2026-11-01T00:00:00");
    expect(resultado.fechaFin).toBe("2026-11-30T23:59:59");
    expect(resultado.fechaInicio).not.toContain("-05:00");
  });

  it("sin fechas reales: hoy y fin de mes, en el mismo formato sin zona", () => {
    const resultado = fechasParaParticipar({});
    expect(resultado.fechaInicio).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/);
    expect(resultado.fechaFin).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59$/);
  });
});

describe("listarTodosLosItemsActivos — paginación sin tope fijo (MED 8, review de Pablo)", () => {
  afterEach(() => vi.clearAllMocks());

  it("una sola página, menos de 50 ids: termina ahí, catalogoIncompleto=false", async () => {
    listarItemsActivosMlMock.mockResolvedValue({ ids: ["MCO1", "MCO2"], totalCatalogo: 2 });
    const resultado = await listarTodosLosItemsActivos("111", "token");
    expect(resultado).toEqual({ ids: ["MCO1", "MCO2"], catalogoIncompleto: false });
  });

  it("varias páginas llenas hasta agotar el catálogo real: junta todas, catalogoIncompleto=false", async () => {
    const pagina1 = Array.from({ length: 50 }, (_, i) => `MCO${i}`);
    const pagina2 = Array.from({ length: 10 }, (_, i) => `MCO${50 + i}`);
    listarItemsActivosMlMock
      .mockResolvedValueOnce({ ids: pagina1, totalCatalogo: 60 })
      .mockResolvedValueOnce({ ids: pagina2, totalCatalogo: 60 });
    const resultado = await listarTodosLosItemsActivos("111", "token");
    expect(resultado.ids).toHaveLength(60);
    expect(resultado.catalogoIncompleto).toBe(false);
    expect(listarItemsActivosMlMock).toHaveBeenCalledTimes(2);
  });

  it("una página falla DESPUÉS de haber leído al menos una con éxito: corta ahí, catalogoIncompleto=true (nunca tira abajo toda la cuenta)", async () => {
    const pagina1 = Array.from({ length: 50 }, (_, i) => `MCO${i}`);
    listarItemsActivosMlMock.mockResolvedValueOnce({ ids: pagina1, totalCatalogo: 1000 }).mockRejectedValueOnce(new Error("ML no respondió"));
    const resultado = await listarTodosLosItemsActivos("111", "token");
    expect(resultado).toEqual({ ids: pagina1, catalogoIncompleto: true });
  });

  it("la primera página falla sin haber leído nada antes: el error se propaga (nunca se esconde)", async () => {
    listarItemsActivosMlMock.mockRejectedValueOnce(new Error("ML no respondió"));
    await expect(listarTodosLosItemsActivos("111", "token")).rejects.toThrow("ML no respondió");
  });
});

describe("leerReglasFrescasCuenta / leerPisosYCostosFrescos / leerPisoYCostoFresco — HIGH 2, review de Pablo (releer fresco, nunca el snapshot)", () => {
  afterEach(() => filasPorTabla.clear());

  it("leerReglasFrescasCuenta — sin fila en promociones_reglas: REGLAS_POR_DEFECTO", async () => {
    filasPorTabla.set(promocionesReglas, []);
    const reglas = await leerReglasFrescasCuenta("empresa-1", "cuenta-1");
    expect(reglas).toEqual(REGLAS_POR_DEFECTO);
  });

  it("leerReglasFrescasCuenta — con fila real: exactamente lo guardado, nunca el default", async () => {
    filasPorTabla.set(promocionesReglas, [{ descuentoMaximoPct: 10, participarCompartidas: true, igualarAlPiso: false }]);
    const reglas = await leerReglasFrescasCuenta("empresa-1", "cuenta-1");
    expect(reglas).toEqual({ descuentoMaximoPct: 10, participarCompartidas: true, igualarAlPiso: false });
  });

  it("leerPisosYCostosFrescos — batcheada, convierte los numeric de Postgres a number", async () => {
    filasPorTabla.set(costosSku, [
      { skuCodigo: "SKU-1", precioMinimoUnidad: "90000.00", costo: "50000.00" },
      { skuCodigo: "SKU-2", precioMinimoUnidad: null, costo: null },
    ]);
    const mapa = await leerPisosYCostosFrescos("empresa-1", ["SKU-1", "SKU-2", "SKU-3"]);
    expect(mapa.get("SKU-1")).toEqual({ precioMinimo: 90000, costo: 50000 });
    expect(mapa.get("SKU-2")).toEqual({ precioMinimo: null, costo: null });
    expect(mapa.has("SKU-3")).toBe(false); // sin costos_sku para ese SKU — nunca se inventa una fila
  });

  it("leerPisosYCostosFrescos — lista vacía: mapa vacío, nunca consulta la base", async () => {
    const mapa = await leerPisosYCostosFrescos("empresa-1", []);
    expect(mapa.size).toBe(0);
  });

  it("leerPisoYCostoFresco — sin skuCodigo: null/null sin consultar la base", async () => {
    const resultado = await leerPisoYCostoFresco("empresa-1", null);
    expect(resultado).toEqual({ precioMinimo: null, costo: null });
  });

  it("leerPisoYCostoFresco — con skuCodigo real: el piso/costo de ese SKU puntual", async () => {
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "50000" }]);
    const resultado = await leerPisoYCostoFresco("empresa-1", "SKU-1");
    expect(resultado).toEqual({ precioMinimo: 90000, costo: 50000 });
  });
});
