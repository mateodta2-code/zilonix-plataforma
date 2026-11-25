import { describe, expect, it } from "vitest";
import type { FilaMetrica } from "@/lib/ml/devoluciones";
import { avisoTope, calcularMetricas, desdePeriodoMs, leerPeriodoDias, porcentajeSobreVentas, serieSemanal } from "@/lib/posventa/metricasDevoluciones";

const fila = (p: Partial<FilaMetrica>): FilaMetrica => ({
  cuentaMlId: "c1", nickname: "Uno", siteId: "MCO", fecha: "2026-11-10T00:00:00Z", motivoId: "PDD1", motivoTexto: "No lo quiere",
  costo: null, itemId: null, productoTitulo: null, ...p,
});

describe("porcentajeSobreVentas", () => {
  it("denominador 0 da null", () => {
    expect(porcentajeSobreVentas(3, 0)).toBeNull();
    expect(porcentajeSobreVentas(1, 50)).toBe(2);
  });
});

describe("calcularMetricas", () => {
  it("cuenta, agrupa motivos, suma costo por moneda y rankea", () => {
    const r = calcularMetricas([
      fila({ costo: { monto: 10, moneda: "COP" }, itemId: "MCO1", productoTitulo: "A" }),
      fila({ costo: { monto: 5, moneda: "COP" }, itemId: "MCO1", productoTitulo: "A" }),
      fila({ cuentaMlId: "c2", nickname: "Dos", motivoId: "PDD2", motivoTexto: null, costo: { monto: 3, moneda: "MXN" }, itemId: "MCO2" }),
    ]);
    expect(r.cantidad).toBe(3);
    expect(r.motivos[0]).toMatchObject({ motivoId: "PDD1", cantidad: 2 });
    expect(r.costos).toEqual([{ moneda: "COP", total: 15 }, { moneda: "MXN", total: 3 }]);
    expect(r.porProducto[0]).toMatchObject({ clave: "MCO1", cantidad: 2 });
    expect(r.porCuenta[0]).toMatchObject({ titulo: "Uno", cantidad: 2 });
  });
  it("sin filas no rompe", () => {
    expect(calcularMetricas([])).toMatchObject({ cantidad: 0, motivos: [], costos: [] });
  });
});

describe("periodo, serie y aviso", () => {
  it("lee el periodo con 30 por defecto", () => {
    expect(leerPeriodoDias("90")).toBe(90);
    expect(leerPeriodoDias("x")).toBe(30);
    expect(desdePeriodoMs(30, 30 * 86_400_000)).toBe(0);
  });
  it("serie semanal reparte por semana e ignora fuera de rango", () => {
    const dia = 86_400_000;
    const s = serieSemanal(["1970-01-02T00:00:00Z", "1970-01-09T00:00:00Z", "1969-01-01T00:00:00Z", null], 0, 14 * dia);
    expect(s.map((x) => x.cantidad)).toEqual([1, 1]);
  });
  it("aviso solo si hay más", () => {
    expect(avisoTope(60, true)).toBe("Calculado sobre los 60 más recientes.");
    expect(avisoTope(5, false)).toBeNull();
  });
});
