import { afterEach, describe, expect, it, vi } from "vitest";

// Mismo patrón de mock que lib/ml/promocionesPublicaciones.test.ts — ni
// Postgres ni Mercado Libre existen en este sandbox. NADA acá toca una
// cuenta real: salirDePromocionMl es un mock.
const { filasPorTabla, insertsRegistrados } = vi.hoisted(() => ({
  filasPorTabla: new Map<unknown, unknown[]>(),
  insertsRegistrados: [] as Record<string, unknown>[],
}));
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => unknown) => {
    const tx = {
      select: () => ({ from: (tabla: unknown) => ({ where: async () => filasPorTabla.get(tabla) ?? [] }) }),
      insert: () => ({
        values: async (valores: Record<string, unknown>) => {
          insertsRegistrados.push(valores);
        },
      }),
    };
    return fn(tx);
  },
}));

const { obtenerAccessTokenVigenteMock } = vi.hoisted(() => ({ obtenerAccessTokenVigenteMock: vi.fn(async (_e: string, _c: string) => "token-falso") }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: obtenerAccessTokenVigenteMock }));

const { leerItemParaPromocionMlMock, leerPromocionesItemMlMock, listarItemsActivosMlMock, salirDePromocionMlMock } = vi.hoisted(() => ({
  leerItemParaPromocionMlMock: vi.fn(),
  leerPromocionesItemMlMock: vi.fn(),
  listarItemsActivosMlMock: vi.fn(),
  salirDePromocionMlMock: vi.fn(),
}));
vi.mock("@/lib/ml/cliente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/cliente")>();
  return {
    ...real,
    leerItemParaPromocionMl: leerItemParaPromocionMlMock,
    leerPromocionesItemMl: leerPromocionesItemMlMock,
    listarItemsActivosMl: listarItemsActivosMlMock,
    salirDePromocionMl: salirDePromocionMlMock,
  };
});

import { cuentasMl } from "@/db/schema";
import { salirDeTodasLasPromociones, vistaPreviaSalirTodas } from "./promocionesSalirTodas";

const CUENTA = { id: "cuenta-1", cuentaIdExterna: "123", nickname: "Mi Tienda", siteId: "MLM" };

let seleccion: { cuentaId: string; itemId: string }[] = [];

function prepararCatalogo(promocionesPorItem: Record<string, unknown[]>) {
  filasPorTabla.set(cuentasMl, [CUENTA]);
  const ids = Object.keys(promocionesPorItem);
  seleccion = ids.map((itemId) => ({ cuentaId: CUENTA.id, itemId }));
  leerPromocionesItemMlMock.mockImplementation(async (itemId: string) => ({ estado: "ok", promociones: promocionesPorItem[itemId] ?? [] }));
  leerItemParaPromocionMlMock.mockImplementation(async (itemId: string) => ({ title: `Título ${itemId}` }));
}

afterEach(() => {
  vi.clearAllMocks();
  filasPorTabla.clear();
  insertsRegistrados.length = 0;
});

describe("vistaPreviaSalirTodas — solo lee y cuenta, nunca escribe", () => {
  it("cuenta publicaciones y promociones activas (started/pending), ignora candidate, y separa las no permitidas", async () => {
    prepararCatalogo({
      A1: [
        { type: "DEAL", status: "started", id: "p1" },
        { type: "PRICE_DISCOUNT", status: "pending", id: "p2" },
      ],
      A2: [{ type: "LIGHTNING", status: "started", id: "p3" }],
      A3: [{ type: "DEAL", status: "candidate", id: "p4" }],
      A4: [],
    });

    const vista = await vistaPreviaSalirTodas("empresa-1", seleccion);

    expect(vista).toMatchObject({ revisadas: 4, publicaciones: 2, promociones: 3, salibles: 2, noPermitidas: 1, lecturasConError: 0 });
    expect(vista.porTipo).toEqual({ DEAL: 1, PRICE_DISCOUNT: 1, LIGHTNING: 1 });
    expect(salirDePromocionMlMock).not.toHaveBeenCalled();
    expect(insertsRegistrados).toHaveLength(0);
  });

  it("una publicación que no se puede leer se cuenta aparte, sin romper el resto", async () => {
    prepararCatalogo({ A1: [{ type: "DEAL", status: "started", id: "p1" }], A2: [] });
    leerPromocionesItemMlMock.mockImplementation(async (itemId: string) =>
      itemId === "A2" ? { estado: "otro_error" } : { estado: "ok", promociones: [{ type: "DEAL", status: "started", id: "p1" }] }
    );
    const vista = await vistaPreviaSalirTodas("empresa-1", seleccion);
    expect(vista).toMatchObject({ revisadas: 1, publicaciones: 1, promociones: 1, lecturasConError: 1 });
  });

  it("una cuenta sin token válido se salta sin romper", async () => {
    prepararCatalogo({ A1: [{ type: "DEAL", status: "started", id: "p1" }] });
    obtenerAccessTokenVigenteMock.mockRejectedValueOnce(new Error("sin token"));
    const vista = await vistaPreviaSalirTodas("empresa-1", seleccion);
    expect(vista.publicaciones).toBe(0);
  });
});

describe("salirDeTodasLasPromociones", () => {
  it("sale de las permitidas, reporta las no permitidas SIN llamar a ML, y audita solo lo que se intentó", async () => {
    prepararCatalogo({
      A1: [{ type: "DEAL", status: "started", id: "p1", price: 80000 }],
      A2: [
        { type: "DOD", status: "started", id: "p2" },
        { type: "SELLER_CAMPAIGN", status: "started", id: "p3" },
        { type: "TIPO_NUEVO_DESCONOCIDO", status: "pending", id: "p4" },
      ],
    });
    salirDePromocionMlMock.mockResolvedValue({ ok: true, status: 200, textoCrudo: "" });

    const resumen = await salirDeTodasLasPromociones("empresa-1", "usuario-1", seleccion);

    expect(resumen).toMatchObject({ revisadas: 2, salieron: 1, errores: 0, noPermitidas: 3 });
    // Solo el DELETE de la DEAL — DOD, SELLER_CAMPAIGN (borraría la campaña entera) y el tipo desconocido NUNCA se llaman.
    expect(salirDePromocionMlMock).toHaveBeenCalledTimes(1);
    expect(salirDePromocionMlMock).toHaveBeenCalledWith("A1", "token-falso", "p1", "DEAL");
    expect(resumen.filas.filter((f) => f.estado === "no_permitida").map((f) => f.tipoPromocion)).toEqual(["DOD", "SELLER_CAMPAIGN", "TIPO_NUEVO_DESCONOCIDO"]);
    expect(resumen.filas.find((f) => f.estado === "no_permitida")?.error).toContain("Central de Promociones");
    // Resultado por ítem con título.
    expect(resumen.filas.find((f) => f.itemId === "A1")).toMatchObject({ estado: "salio", tituloProducto: "Título A1", tipoPromocion: "DEAL", error: null });
    // Promo-E: 100 = 100 — las 3 no permitidas también quedan (estado «rechazada», sin llamar a ML), todas con el mismo lote.
    expect(insertsRegistrados).toHaveLength(4);
    const salida = insertsRegistrados.find((f) => f.itemId === "A1");
    expect(salida).toMatchObject({ accion: "salir", estado: "ejecutada", itemId: "A1", tipoPromocion: "DEAL", promotionIdMl: "p1", precioAntes: "80000", precioDespues: null, modoSimulacion: false, ejecutadoPor: "usuario-1" });
    const noApi = insertsRegistrados.filter((f) => f.estado === "rechazada");
    expect(noApi).toHaveLength(3);
    expect(noApi[0]).toMatchObject({ accion: "salir", resultadoMl: { regla: "salir", origen: "salir-todas", llamoAMercadoLibre: false, limite: "ml" } });
    const lotes = new Set(insertsRegistrados.map((f) => (f.resultadoMl as { lote: string }).lote));
    expect(lotes.size).toBe(1);
  });

  it("si ML rechaza la salida, muestra el motivo de ML y queda 'fallida' en la auditoría", async () => {
    prepararCatalogo({ A1: [{ type: "DEAL", status: "started", id: "p1" }], A2: [{ type: "PRICE_DISCOUNT", status: "started", id: "p2" }] });
    salirDePromocionMlMock.mockImplementation(async (itemId: string) =>
      itemId === "A1" ? { ok: false, status: 400, textoCrudo: JSON.stringify({ message: "La oferta ya inició y no se puede borrar" }) } : { ok: true, status: 200, textoCrudo: "" }
    );

    const resumen = await salirDeTodasLasPromociones("empresa-1", "usuario-1", seleccion);

    expect(resumen).toMatchObject({ salieron: 1, errores: 1, noPermitidas: 0 });
    const fallida = resumen.filas.find((f) => f.estado === "error");
    expect(fallida?.itemId).toBe("A1");
    expect(fallida?.error).toContain("HTTP 400");
    expect(insertsRegistrados.map((i) => i.estado).sort()).toEqual(["ejecutada", "fallida"]);
  });

  it("429 de ML tras el reintento: error claro, y NO se audita como fallida (no se sabe si el DELETE pasó)", async () => {
    vi.useFakeTimers();
    try {
      const { LimiteMercadoLibreError } = await import("@/lib/ml/cliente");
      prepararCatalogo({ A1: [{ type: "DEAL", status: "started", id: "p1" }] });
      salirDePromocionMlMock.mockRejectedValue(new LimiteMercadoLibreError(null));
      const promesa = salirDeTodasLasPromociones("empresa-1", "usuario-1", seleccion);
      await vi.runAllTimersAsync();
      const resumen = await promesa;
      expect(resumen).toMatchObject({ salieron: 0, errores: 1 });
      expect(resumen.filas[0].error).toContain("limitando");
      expect(salirDePromocionMlMock).toHaveBeenCalledTimes(2); // intento + 1 reintento
      expect(insertsRegistrados).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignora las promociones 'candidate' (no se participa en ellas, no hay de qué salir)", async () => {
    prepararCatalogo({ A1: [{ type: "DEAL", status: "candidate", id: "p1" }] });
    const resumen = await salirDeTodasLasPromociones("empresa-1", "usuario-1", seleccion);
    expect(resumen.filas).toHaveLength(0);
    expect(salirDePromocionMlMock).not.toHaveBeenCalled();
  });
});
