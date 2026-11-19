import { describe, expect, it } from "vitest";
import { leerVisitasPorDia } from "@/lib/ml/cliente";
import { diasInventario, porUnidad, precioMinimo, resumirPeriodo, serieDiaria, utilidadAcumulada, variacion, type LineaVendida } from "@/lib/optimizacion/calculos";
import { opcionesPeriodo, resolverPeriodoDetalle } from "@/lib/optimizacion/periodo";

const AHORA = new Date("2026-11-17T15:00:00-05:00");

describe("período del detalle", () => {
  it("últimos N días y el período anterior del mismo largo", () => {
    expect(resolverPeriodoDetalle("7", AHORA)).toMatchObject({ desde: "2026-11-11", hasta: "2026-11-17", dias: 7, anteriorDesde: "2026-11-04", anteriorHasta: "2026-11-10" });
    expect(resolverPeriodoDetalle("30", AHORA)).toMatchObject({ desde: "2026-10-19", anteriorHasta: "2026-10-18", anteriorDesde: "2026-09-19" });
  });

  it("mes en curso: hasta hoy, contra el mismo tramo del mes anterior", () => {
    expect(resolverPeriodoDetalle("2026-11", AHORA)).toMatchObject({ desde: "2026-11-01", hasta: "2026-11-17", dias: 17, anteriorDesde: "2026-10-01", anteriorHasta: "2026-10-17" });
  });

  it("mes cerrado: completo, contra el mes anterior completo", () => {
    expect(resolverPeriodoDetalle("2026-10", AHORA)).toMatchObject({ desde: "2026-10-01", hasta: "2026-10-31", anteriorDesde: "2026-09-01", anteriorHasta: "2026-09-30" });
  });

  it("lista blanca: lo desconocido cae a 30 días", () => {
    expect(resolverPeriodoDetalle("2020-01", AHORA).clave).toBe("30");
    expect(resolverPeriodoDetalle("drop", AHORA).clave).toBe("30");
    expect(opcionesPeriodo(AHORA).map((o) => o.clave)).toEqual(["7", "30", "90", "2026-11", "2026-10", "2026-09", "2026-08"]);
  });
});

const costos = (utilidad: string | null, costoProducto: string | null = "20000.00") => ({
  comision: "15000.00",
  envio: "10000.00",
  costoProducto,
  empaque: "1000.00",
  utilidad,
});

function linea(parcial: Partial<LineaVendida>): LineaVendida {
  return { pedidoId: "p1", dia: "2026-11-12", cantidad: 1, valor: "100000.00", valida: true, costos: costos("54000.00"), ...parcial };
}

describe("resumen del período", () => {
  const base = {
    publicidad: [{ dia: "2026-11-12", inversion: "4000.00", ingresos: "100000.00" }],
    visitasPorDia: new Map([
      ["2026-11-12", 80],
      ["2026-11-13", 20],
    ]),
    visitasCompletas: true,
    desde: "2026-11-11",
    hasta: "2026-11-17",
    conFinanzas: true,
  };

  it("brutas incluye canceladas; concretadas, unidades, conversión, ACOS y ganancia real", () => {
    const r = resumirPeriodo({
      ...base,
      lineas: [
        linea({}),
        linea({ pedidoId: "p2", cantidad: 2, valor: "200000.00", costos: costos("108000.00") }),
        linea({ pedidoId: "p3", valida: false, costos: null }),
        linea({ pedidoId: "fuera", dia: "2026-11-01" }),
      ],
    });
    expect(r.ventasBrutas).toBe("400000.00");
    expect(r.ventasConcretadas).toBe("300000.00");
    expect(r.pedidos).toBe(2);
    expect(r.unidades).toBe(3);
    expect(r.precioPromedio).toBe("100000.00");
    expect(r.visitas).toBe(100);
    expect(r.conversion).toBe("2.00");
    expect(r.acos).toBe("4.00");
    expect(r.tacos).toBe("1.33");
    // 54.000 + 108.000 − 4.000 de publicidad.
    expect(r.ganancia).toBe("158000.00");
    expect(r.margen).toBe("52.67");
  });

  it("sin permiso de Finanzas, o con un costo faltante, no hay ganancia inventada", () => {
    expect(resumirPeriodo({ ...base, conFinanzas: false, lineas: [linea({})] }).ganancia).toBeNull();
    expect(resumirPeriodo({ ...base, lineas: [linea({}), linea({ pedidoId: "p2", costos: null })] }).costos).toBeNull();
    const sinCosto = resumirPeriodo({ ...base, lineas: [linea({ costos: costos(null, null) })] });
    expect(sinCosto.costos?.costoProducto).toBeNull();
    expect(sinCosto.ganancia).toBeNull();
  });

  it("visitas incompletas o sin visitas: sin conversión", () => {
    expect(resumirPeriodo({ ...base, visitasCompletas: false, lineas: [linea({})] }).visitas).toBeNull();
    expect(resumirPeriodo({ ...base, visitasPorDia: new Map(), lineas: [linea({})] }).conversion).toBeNull();
  });
});

describe("indicadores", () => {
  it("variación contra el período anterior; sin anterior no se inventa", () => {
    expect(variacion("150.00", "100.00")).toBe("50.00");
    expect(variacion(3, 4)).toBe("-25.00");
    expect(variacion("10.00", "0.00")).toBeNull();
    expect(variacion(null, 5)).toBeNull();
  });

  it("por unidad, precio mínimo y días de inventario", () => {
    expect(porUnidad("300000.00", 3)).toBe("100000.00");
    expect(porUnidad("1.00", 0)).toBeNull();
    const r = resumirPeriodo({
      lineas: [linea({})],
      publicidad: [],
      visitasPorDia: null,
      visitasCompletas: false,
      desde: "2026-11-11",
      hasta: "2026-11-17",
      conFinanzas: true,
    });
    // Fijos 31.000 por unidad; la comisión es el 15 %: 31.000 / 0,85.
    expect(precioMinimo(r)).toBe("36470.59");
    expect(diasInventario(20, 10, 30)).toBe(60);
    expect(diasInventario(20, 0, 30)).toBeNull();
  });

  it("serie diaria con ceros y visitas por día de Mercado Libre", () => {
    const visitas = leerVisitasPorDia({ results: [{ date: "2026-11-12T00:00:00Z", total: 7 }, { date: "malo", total: 1 }] });
    expect([...visitas]).toEqual([["2026-11-12", 7]]);
    expect(serieDiaria([linea({ cantidad: 2 })], visitas, ["2026-11-11", "2026-11-12"])).toEqual([
      { dia: "2026-11-11", ventas: 0, visitas: 0 },
      { dia: "2026-11-12", ventas: 2, visitas: 7 },
    ]);
  });
});

describe("utilidad total de la publicación (toda la historia)", () => {
  const linea = (pedidoId: string, dia: string, utilidad: string | null, extra: Partial<LineaVendida> = {}): LineaVendida => ({
    pedidoId,
    dia,
    cantidad: 1,
    valor: "100000.00",
    valida: true,
    costos: utilidad === undefined ? null : { comision: "15000.00", envio: "10000.00", costoProducto: "50000.00", empaque: "2000.00", utilidad },
    ...extra,
  });

  it("suma lo que tiene costos, resta TODA la publicidad y avisa cuántas ventas no suman", () => {
    const r = utilidadAcumulada(
      [
        linea("p1", "2026-06-01", "23000.00"),
        linea("p2", "2026-09-10", "23000.00", { cantidad: 2, valor: "200000.00" }),
        linea("p3", "2026-10-01", null), // sin costo del producto
        linea("p4", "2026-11-01", null, { costos: null }), // sin foto de Finanzas
        linea("p5", "2026-11-02", "99999.00", { valida: false }), // cancelada: no cuenta
      ],
      [
        { dia: "2026-06-01", inversion: "1000.00", ingresos: "0.00" },
        { dia: "2026-11-01", inversion: "5000.00", ingresos: "0.00" },
      ],
      true
    );
    expect(r).toMatchObject({ ganancia: "40000.00", unidades: 5, pedidos: 4, pedidosSinCosto: 2, primerDia: "2026-06-01", ventas: "500000.00" });
    // margen sobre lo vendido que SÍ tiene costos (300.000)
    expect(r.margen).toBe("13.33");
  });

  it("sin permiso de Finanzas o sin ninguna venta con costos: sin ganancia (nunca un 0 inventado)", () => {
    expect(utilidadAcumulada([linea("p1", "2026-06-01", "23000.00")], [], false)).toMatchObject({ ganancia: null, pedidosSinCosto: 0, unidades: 1 });
    expect(utilidadAcumulada([linea("p1", "2026-06-01", null, { costos: null })], [], true).ganancia).toBeNull();
    expect(utilidadAcumulada([], [], true)).toMatchObject({ ganancia: null, pedidos: 0, primerDia: null });
  });
});
