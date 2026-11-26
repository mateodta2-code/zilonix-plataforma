import { beforeEach, describe, expect, it, vi } from "vitest";

// Alertas de Optimización con Mercado Libre simulado: topes, paralelismo
// de 3 y fallas parciales.
const ml = vi.hoisted(() => ({
  contar: vi.fn(),
  lista: vi.fn(),
  referencias: vi.fn(),
  referencia: vi.fn(),
  listar: vi.fn(),
  leerItems: vi.fn(),
  competencia: vi.fn(),
  calidad: vi.fn(),
}));
vi.mock("@/lib/ml/cliente", () => ({
  contarItemsVendedorPorEstadoMl: ml.contar,
  itemsConReferenciaPrecioMl: ml.referencias,
  referenciaPrecioItemMl: ml.referencia,
  listarItemsVendedorMl: ml.listar,
  leerItemsOptimizacionMl: ml.leerItems,
  competenciaItemMl: ml.competencia,
  calidadItemMl: ml.calidad,
}));

import { alertaCalidad, alertaCompetencia, alertaModeradas, alertaSinStock, alertaPrecioAlto, leerAlertasPublicaciones } from "./alertasDatos";

const ids = (n: number, desde = 0) => Array.from({ length: n }, (_, i) => `MCO${desde + i + 1}`);

beforeEach(() => {
  for (const f of Object.values(ml)) f.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("alertaModeradas", () => {
  it("suma under_review + pending", async () => {
    ml.contar.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    expect((await alertaModeradas("1", "t")).cantidad).toBe(5);
  });
  it("si uno falla, null (no un número inventado)", async () => {
    ml.contar.mockResolvedValueOnce(2).mockResolvedValueOnce(null);
    expect((await alertaModeradas("1", "t")).cantidad).toBeNull();
  });
});

describe("alertaPrecioAlto", () => {
  it("revisa máximo 50 detalles, de a 3 en paralelo, y cuenta los de precio alto", async () => {
    ml.referencias.mockResolvedValue({ total: 120, ids: ids(120) });
    let activas = 0;
    let maxActivas = 0;
    ml.referencia.mockImplementation(async (id: string) => {
      activas++;
      maxActivas = Math.max(maxActivas, activas);
      await new Promise((r) => setTimeout(r, 1));
      activas--;
      const n = Number(id.slice(3));
      return { estado: n % 10 === 0 ? "with_benchmark_highest" : "no_benchmark_ok", precioActual: 10, precioSugerido: 8, diferenciaPorcentaje: 25, moneda: "COP" };
    });
    const r = await alertaPrecioAlto("1", "t");
    expect(ml.referencia).toHaveBeenCalledTimes(50);
    expect(maxActivas).toBeLessThanOrEqual(3);
    expect(r.cantidad).toBe(5);
    expect(r.revisadas).toEqual({ hechas: 50, total: 120 });
    expect(r.ids).toEqual(["MCO10", "MCO20", "MCO30", "MCO40", "MCO50"]);
    expect(r.referencias.MCO10.diferenciaPorcentaje).toBe(25);
  });
  it("sin lista de ML → null; todos los detalles fallan → null", async () => {
    ml.referencias.mockResolvedValueOnce(null);
    expect((await alertaPrecioAlto("1", "t")).cantidad).toBeNull();
    ml.referencias.mockResolvedValueOnce({ total: 2, ids: ids(2) });
    ml.referencia.mockResolvedValue(null);
    expect((await alertaPrecioAlto("1", "t")).cantidad).toBeNull();
  });
  it("lista vacía → 0 real", async () => {
    ml.referencias.mockResolvedValue({ total: 0, ids: [] });
    expect((await alertaPrecioAlto("1", "t")).cantidad).toBe(0);
  });
});

describe("alertaCompetencia", () => {
  it("lee hasta 100 activas y máximo 50 de catálogo, y cuenta las que pierden", async () => {
    ml.listar.mockResolvedValueOnce({ ids: ids(50), total: 340 }).mockResolvedValueOnce({ ids: ids(50, 50), total: 340 });
    ml.leerItems.mockImplementation(async (lista: string[]) => lista.map((id) => ({ id, catalogo: true })));
    ml.competencia.mockImplementation(async (id: string) => ({ estado: Number(id.slice(3)) % 2 === 0 ? "competing" : "winning", precioParaGanar: 1 }));
    const r = await alertaCompetencia("1", "MCO", "t");
    expect(ml.listar).toHaveBeenCalledTimes(2);
    expect(ml.leerItems.mock.calls[0][0]).toHaveLength(100);
    expect(ml.competencia).toHaveBeenCalledTimes(50);
    expect(r.cantidad).toBe(25);
    expect(r.revisadas).toEqual({ hechas: 50, total: 340 });
    expect(r.ids.length).toBeLessThanOrEqual(50);
  });
  it("una sola página si hay 50 o menos", async () => {
    ml.listar.mockResolvedValueOnce({ ids: ids(3), total: 3 });
    ml.leerItems.mockResolvedValue([{ id: "MCO1", catalogo: true }, { id: "MCO2", catalogo: false }]);
    ml.competencia.mockResolvedValue({ estado: "listed", precioParaGanar: null });
    const r = await alertaCompetencia("1", "MCO", "t");
    expect(ml.listar).toHaveBeenCalledTimes(1);
    expect(r.cantidad).toBe(1);
    expect(r.revisadas).toEqual({ hechas: 3, total: 3 });
  });
});

describe("alertaSinStock", () => {
  it("pide pausadas por out_of_stock y usa el total de Mercado Libre", async () => {
    ml.listar.mockResolvedValueOnce({ ids: ids(2), total: 8 });
    const r = await alertaSinStock("1", "t");
    expect(ml.listar.mock.calls[0][2]).toMatchObject({ estado: "paused", subEstado: "out_of_stock", offset: 0 });
    expect(r.cantidad).toBe(8);
    expect(r.ids).toEqual(ids(2));
  });
  it("si Mercado Libre falla, null (no 0)", async () => {
    ml.listar.mockRejectedValueOnce(new Error("boom"));
    expect((await alertaSinStock("1", "t")).cantidad).toBeNull();
  });
});

describe("alertaCalidad", () => {
  it("cuenta las activas con objetivos pendientes y guarda cuáles", async () => {
    ml.listar.mockResolvedValueOnce({ ids: ids(3), total: 3 });
    ml.calidad.mockImplementation(async (id: string) => ({ puntaje: 70, nivel: null, pendientes: id === "MCO2" ? [] : ["Agrega una foto"] }));
    const r = await alertaCalidad("1", "t");
    expect(r.cantidad).toBe(2);
    expect(r.ids).toEqual(["MCO1", "MCO3"]);
    expect(r.pendientes.MCO1).toEqual(["Agrega una foto"]);
    expect(r.revisadas).toEqual({ hechas: 3, total: 3 });
  });
  it("revisa máximo 50 y avisa cuántas quedaron sin revisar", async () => {
    ml.listar.mockResolvedValueOnce({ ids: ids(50), total: 120 });
    ml.calidad.mockResolvedValue({ puntaje: 100, nivel: null, pendientes: [] });
    const r = await alertaCalidad("1", "t");
    expect(ml.calidad).toHaveBeenCalledTimes(50);
    expect(r.cantidad).toBe(0);
    expect(r.revisadas).toEqual({ hechas: 50, total: 120 });
  });
  it("si todas las lecturas fallan, null", async () => {
    ml.listar.mockResolvedValueOnce({ ids: ids(2), total: 2 });
    ml.calidad.mockResolvedValue(null);
    expect((await alertaCalidad("1", "t")).cantidad).toBeNull();
  });
});

describe("leerAlertasPublicaciones", () => {
  it("una alerta que falla queda en null y las demás siguen", async () => {
    ml.contar.mockRejectedValue(new Error("boom"));
    ml.referencias.mockResolvedValue({ total: 1, ids: ["MCO1"] });
    ml.referencia.mockResolvedValue({ estado: "with_benchmark_high", precioActual: 1, precioSugerido: 1, diferenciaPorcentaje: 5, moneda: "COP" });
    ml.listar.mockRejectedValue(new Error("boom"));
    const r = await leerAlertasPublicaciones({ cuentaIdExterna: "1", siteId: "MCO" }, "t");
    const por = Object.fromEntries(r.alertas.map((a) => [a.clave, a.cantidad]));
    expect(por).toEqual({ sin_stock: null, calidad: null, moderadas: null, competencia: null, precio_alto: 1 });
    expect(r.ids.precio_alto).toEqual(["MCO1"]);
  });
});
