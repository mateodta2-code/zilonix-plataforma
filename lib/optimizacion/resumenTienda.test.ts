import { describe, expect, it } from "vitest";
import { periodoTienda, resumirTienda, type VentaTienda } from "@/lib/optimizacion/resumenTienda";

const venta = (dia: string, total: string, extra: Partial<VentaTienda> = {}): VentaTienda => ({
  dia,
  total,
  estado: "paid",
  cancelada: false,
  reembolsos: "0.00",
  unidades: 1,
  ...extra,
});

describe("periodoTienda", () => {
  it("últimos N días contando hoy, y los N de antes", () => {
    expect(periodoTienda(7, "2026-11-19")).toEqual({ desde: "2026-11-13", hasta: "2026-11-19", anteriorDesde: "2026-11-06", anteriorHasta: "2026-11-12" });
  });
});

describe("resumirTienda", () => {
  it("cuadra con el resumen de Mercado Libre: brutas, ventas, unidades, precios y conversión", () => {
    // 17 ventas, 19 unidades, $1.534.841 → $80.781,10 por unidad y $90.284,76 por venta; 793 visitas → 2,14 %.
    const ventas = [
      ...Array.from({ length: 15 }, () => venta("2026-11-15", "90000.00")),
      venta("2026-11-16", "92420.50", { unidades: 2 }),
      venta("2026-11-17", "92420.50", { unidades: 2 }),
    ];
    const r = resumirTienda(ventas, "2026-11-13", "2026-11-19", 793);
    expect(r).toMatchObject({ ventasBrutas: "1534841.00", ventas: 17, unidades: 19, unidadesCompletas: true, precioPorUnidad: "80781.10", precioPorVenta: "90284.76", visitas: 793, conversion: "2.14" });
  });

  it("canceladas y devueltas van aparte; fuera del período no cuenta", () => {
    const r = resumirTienda(
      [
        venta("2026-11-15", "100.00"),
        venta("2026-11-15", "50.00", { estado: "cancelled" }),
        venta("2026-11-15", "40.00", { cancelada: true }),
        venta("2026-11-16", "80.00", { reembolsos: "80.00" }),
        venta("2026-11-01", "999.00"),
      ],
      "2026-11-13",
      "2026-11-19",
      null
    );
    expect(r).toMatchObject({ ventasBrutas: "180.00", ventas: 2, canceladas: 2, valorCanceladas: "90.00", devueltas: 1, valorDevueltas: "80.00", visitas: null, conversion: null });
  });

  it("sin ventas o con ventas sin sus líneas, no inventa precios", () => {
    expect(resumirTienda([], "2026-11-13", "2026-11-19", 10)).toMatchObject({ ventas: 0, precioPorUnidad: null, precioPorVenta: null, conversion: "0.00" });
    const r = resumirTienda([venta("2026-11-15", "100.00", { unidades: null })], "2026-11-13", "2026-11-19", 0);
    expect(r).toMatchObject({ unidadesCompletas: false, precioPorUnidad: null, precioPorVenta: "100.00", conversion: null });
  });
});
