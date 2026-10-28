import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/trabajador-publicidad-context", () => ({
  dbTrabajadorPublicidad: { select: vi.fn() },
}));
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: vi.fn(),
}));
vi.mock("@/lib/ml/cuentas", () => ({
  obtenerAccessTokenVigente: vi.fn(),
}));
vi.mock("@/lib/ml/costos-item", () => ({
  costosDeItem: vi.fn(),
}));
vi.mock("@/lib/publicidad/guardar", () => {
  class SyncEnCursoError extends Error {
    constructor() {
      super("en curso");
      this.name = "SyncEnCursoError";
    }
  }
  class SyncMuyRecienteError extends Error {
    constructor() {
      super("reciente");
      this.name = "SyncMuyRecienteError";
    }
  }
  return {
    SyncEnCursoError,
    SyncMuyRecienteError,
    abrirSincronizacion: vi.fn(),
    cerrarSincronizacion: vi.fn(),
    costoYaConsultado: vi.fn(),
    guardarAnunciante: vi.fn(),
    guardarAnuncios: vi.fn(),
    guardarCampanas: vi.fn(),
    guardarCostoItem: vi.fn(),
    guardarMetricas: vi.fn(),
    historialSync: vi.fn(),
    itemsSincronizadosDesde: vi.fn(),
  };
});
vi.mock("@/lib/ml/publicidad", async () => {
  const real = await vi.importActual<typeof import("@/lib/ml/publicidad")>("@/lib/ml/publicidad");
  return {
    ...real,
    obtenerAnunciante: vi.fn(),
    listarCampanas: vi.fn(),
    metricasDiariasCampana: vi.fn(),
    metricasDiariasCuenta: vi.fn(),
    adGroupsDeCampana: vi.fn(),
    metricasAdGroupsDelDia: vi.fn(),
    anunciosDeAdGroup: vi.fn(),
  };
});

import { dbTrabajadorPublicidad } from "@/db/trabajador-publicidad-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { costosDeItem } from "@/lib/ml/costos-item";
import {
  adGroupsDeCampana,
  anunciosDeAdGroup,
  listarCampanas,
  metricasAdGroupsDelDia,
  metricasDiariasCampana,
  metricasDiariasCuenta,
  obtenerAnunciante,
} from "@/lib/ml/publicidad";
import {
  abrirSincronizacion,
  cerrarSincronizacion,
  costoYaConsultado,
  guardarAnunciante,
  guardarAnuncios,
  guardarCampanas,
  guardarCostoItem,
  guardarMetricas,
  historialSync,
  itemsSincronizadosDesde,
} from "@/lib/publicidad/guardar";
import { AVISO_FUERA_DE_RANGO } from "@/lib/publicidad/metricas";
import { sincronizarCuenta, sincronizarPublicidadProgramada } from "./sincronizarPublicidad";

const EMPRESA = "22222222-2222-2222-2222-222222222222";
const CUENTA = "11111111-1111-1111-1111-111111111111";
const CUENTA_B = "33333333-3333-3333-3333-333333333333";
const AHORA = new Date("2026-10-26T15:00:00Z");

const historialVacio = { ultima: null, yaTerminoBackfill: false, reintentosMismoTramo: 0 };

const costoVacio = {
  itemId: "MCO111",
  skuCodigo: null,
  categoryId: null,
  precioVentaVigente: null,
  precioRegular: null,
  comisionMl: null,
  comisionDetalle: null,
  envioVendedorEstimado: null,
  compradorPagaEnvio: null,
  logisticType: null,
  shippingMode: null,
  listingTypeId: null,
  envioEsEstimado: false,
};

function cadena(filas?: unknown[]) {
  const q: Record<string, (...args: unknown[]) => unknown> = {};
  const self = () => q;
  q.from = self;
  q.leftJoin = self;
  q.groupBy = self;
  q.as = () => ({});
  q.where = () => Promise.resolve(filas ?? []);
  return q;
}

describe("corte real de sincronizarCuenta (issue #254)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(dbComoEmpresa).mockImplementation(async (_empresa, fn) =>
      fn({
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ cuentaIdExterna: "998877" }]) }) }),
      } as never)
    );
    vi.mocked(obtenerAccessTokenVigente).mockResolvedValue("token");
    vi.mocked(obtenerAnunciante).mockResolvedValue({
      estado: "ok",
      advertiserId: "222",
      siteId: "MCO",
      nombre: "Tienda",
      cuentaNombre: null,
    });
    vi.mocked(listarCampanas).mockResolvedValue([]);
    vi.mocked(metricasDiariasCampana).mockResolvedValue({ results: [] });
    vi.mocked(metricasDiariasCuenta).mockResolvedValue([]);
    vi.mocked(adGroupsDeCampana).mockResolvedValue([]);
    vi.mocked(metricasAdGroupsDelDia).mockResolvedValue({ results: [] });
    vi.mocked(anunciosDeAdGroup).mockResolvedValue([]);
    vi.mocked(costosDeItem).mockResolvedValue(costoVacio);
    vi.mocked(abrirSincronizacion).mockResolvedValue("sync-1");
    vi.mocked(cerrarSincronizacion).mockResolvedValue(undefined);
    vi.mocked(historialSync).mockResolvedValue(historialVacio);
    vi.mocked(costoYaConsultado).mockResolvedValue(false);
    vi.mocked(itemsSincronizadosDesde).mockResolvedValue([]);
    vi.mocked(guardarAnunciante).mockResolvedValue(undefined);
    vi.mocked(guardarCampanas).mockResolvedValue(undefined);
    vi.mocked(guardarMetricas).mockResolvedValue(undefined);
    vi.mocked(guardarAnuncios).mockResolvedValue(undefined);
    vi.mocked(guardarCostoItem).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("un corte antes del bucle de días queda en fase pre-dias y no entra a los ad groups", async () => {
    vi.mocked(listarCampanas).mockResolvedValue([{ id: 11, name: "A", status: "active" }]);

    const aviso = await sincronizarCuenta(EMPRESA, CUENTA, "programada", null, AHORA, 0);

    expect(aviso).toMatch(/medias/);
    expect(metricasAdGroupsDelDia).not.toHaveBeenCalled();
    expect(cerrarSincronizacion).toHaveBeenCalledWith(
      EMPRESA,
      "sync-1",
      expect.objectContaining({
        estado: "error",
        reanudaDesde: null,
        error: expect.stringContaining("fase:pre-dias"),
      })
    );
  });

  it("un corte en la segunda campaña del primer día guarda ese día y la fase dias", async () => {
    const base = 1_700_000_000_000;
    let ahoraMs = base;
    vi.spyOn(Date, "now").mockImplementation(() => ahoraMs);
    vi.mocked(listarCampanas).mockResolvedValue([
      { id: 11, name: "A", status: "active" },
      { id: 22, name: "B", status: "active" },
    ]);
    vi.mocked(metricasDiariasCampana).mockResolvedValue({ results: [{ date: "2026-10-26", clicks: 1, cost: 1 }] });
    vi.mocked(metricasAdGroupsDelDia).mockImplementation(async () => {
      ahoraMs = base + 60_000 + 1;
      return { results: [] };
    });

    await sincronizarCuenta(EMPRESA, CUENTA, "programada", null, AHORA, base + 60_000);

    expect(metricasAdGroupsDelDia).toHaveBeenCalledTimes(1);
    expect(cerrarSincronizacion).toHaveBeenCalledWith(
      EMPRESA,
      "sync-1",
      expect.objectContaining({
        estado: "error",
        reanudaDesde: "2026-10-20",
        error: expect.stringContaining("fase:dias"),
      })
    );
  });

  it("un corte en costos guarda el último día con fase costos y la siguiente corrida no rehace los días", async () => {
    const base = 1_700_000_000_000;
    let ahoraMs = base;
    vi.spyOn(Date, "now").mockImplementation(() => ahoraMs);
    vi.mocked(listarCampanas).mockResolvedValue([{ id: 11, name: "A", status: "active" }]);
    vi.mocked(adGroupsDeCampana).mockImplementation(async (_cuenta, filtro) =>
      filtro.estado === "active" ? [{ id: 77, campaign_id: 11, ad_group_type: "ITEM" }] : []
    );
    vi.mocked(anunciosDeAdGroup).mockResolvedValue([
      { item_id: "MCO111", title: "Uno", price: 10 },
      { item_id: "MCO222", title: "Dos", price: 12 },
    ]);
    vi.mocked(costosDeItem).mockImplementation(async () => {
      ahoraMs = base + 120_000;
      return costoVacio;
    });

    await sincronizarCuenta(EMPRESA, CUENTA, "programada", null, AHORA, base + 60_000);

    expect(cerrarSincronizacion).toHaveBeenCalledWith(
      EMPRESA,
      "sync-1",
      expect.objectContaining({
        estado: "error",
        reanudaDesde: "2026-10-26",
        error: expect.stringContaining("fase:costos"),
      })
    );
    const llamadasDias = vi.mocked(metricasAdGroupsDelDia).mock.calls.length;

    ahoraMs = base;
    vi.mocked(costosDeItem).mockResolvedValue(costoVacio);
    vi.mocked(historialSync).mockResolvedValue({
      ultima: {
        estado: "error",
        rangoDesde: "2026-10-20",
        rangoHasta: "2026-10-26",
        iniciadaTs: AHORA,
        error: "CorridaIncompletaError: fase:costos. corte",
        cierraBackfill: false,
        reanudaDesde: "2026-10-26",
      },
      yaTerminoBackfill: false,
      reintentosMismoTramo: 0,
    });
    vi.mocked(itemsSincronizadosDesde).mockResolvedValue(["MCO111", "MCO222"]);
    vi.mocked(listarCampanas).mockClear();
    vi.mocked(metricasAdGroupsDelDia).mockClear();

    await sincronizarCuenta(EMPRESA, CUENTA, "programada", null, AHORA, base + 120_000);

    expect(listarCampanas).not.toHaveBeenCalled();
    expect(metricasAdGroupsDelDia).not.toHaveBeenCalled();
    expect(llamadasDias).toBeGreaterThan(0);
    expect(costosDeItem).toHaveBeenCalled();
    expect(itemsSincronizadosDesde).toHaveBeenCalledWith(EMPRESA, CUENTA, AHORA);
  });

  it("un click que no entra en integer deja aviso y la cuenta sigue", async () => {
    vi.mocked(listarCampanas).mockResolvedValue([{ id: 11, name: "A", status: "active" }]);
    vi.mocked(metricasDiariasCampana).mockResolvedValue({
      results: [{ date: "2026-10-26", clicks: 2147483648, cost: 10 }],
    });

    const aviso = await sincronizarCuenta(EMPRESA, CUENTA, "programada", null, AHORA, Date.now() + 60_000);

    expect(aviso).toMatch(/tramo/);
    expect(cerrarSincronizacion).toHaveBeenCalledWith(
      EMPRESA,
      "sync-1",
      expect.objectContaining({
        estado: "parcial",
        error: expect.stringContaining(AVISO_FUERA_DE_RANGO),
      })
    );
  });

  it("con menos de 60 s no arranca la cuenta siguiente y la deja pendiente", async () => {
    const base = 1_700_000_000_000;
    let ahoraMs = base;
    vi.spyOn(Date, "now").mockImplementation(() => ahoraMs);
    vi.mocked(cerrarSincronizacion).mockImplementation(async () => {
      ahoraMs += 200_000;
    });
    let paso = 0;
    vi.mocked(dbTrabajadorPublicidad.select).mockImplementation(() => {
      paso += 1;
      const filas =
        paso === 1
          ? undefined
          : [
              { id: CUENTA, empresaId: EMPRESA, creadoTs: new Date(1), ultimaSyncTs: null },
              { id: CUENTA_B, empresaId: EMPRESA, creadoTs: new Date(2), ultimaSyncTs: null },
            ];
      return cadena(filas) as never;
    });

    const resultado = await sincronizarPublicidadProgramada(AHORA);

    expect(resultado.procesadas).toBe(1);
    expect(resultado.pendientes).toBe(1);
    expect(abrirSincronizacion).toHaveBeenCalledTimes(1);
  });
});
