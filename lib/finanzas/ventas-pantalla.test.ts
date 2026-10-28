import { describe, expect, it } from "vitest";
import { armarDetalleVentas, type TotalesDetalle } from "./detalle-ventas";
import { aCentavos, calcularUtilidadVenta, desdeCentavos } from "./utilidad-venta";
import {
  armarVentaEntrada,
  mesActualBogota,
  porcentajeVentasConCosto,
  resolverRangoVentas,
  resumirPorCuenta,
  type CabeceraVentaFila,
  type LineaVentaFila,
} from "./ventas-pantalla";

// Issue #131 (Z-FIN-09, Parte A) — piezas puras de la pantalla de ventas:
// armado de la entrada del motor, resumen por cuenta y rango de fechas.

function cabecera(extra: Partial<CabeceraVentaFila> = {}): CabeceraVentaFila {
  return {
    pedidoId: "p1",
    cuentaMlId: "c1",
    formaEntrega: "agencia",
    fechaCreacion: new Date("2026-10-20T15:00:00Z"),
    fechaPagoAprobado: new Date("2026-10-21T15:00:00Z"),
    valorVenta: "100000.00",
    comisionMl: "12000.00",
    fleteMl: "5000.00",
    empaqueCongelado: "2000.00",
    envioAgenciaCongelado: "3000.00",
    ...extra,
  };
}

function linea(n: number, extra: Partial<LineaVentaFila> = {}): LineaVentaFila {
  return { linea: n, cantidad: 1, valorLinea: "50000.00", costoCongelado: "20000.00", empaqueCongelado: "1000.00", envioCongelado: "1500.00", ...extra };
}

// Una venta ya calculada, lista para armarDetalleVentas. Sin empaque ni
// envío por línea: el motor reparte los del paquete.
function ventaDetalle(c: CabeceraVentaFila, lineas: LineaVentaFila[], nickname: string) {
  const sinPorLinea = lineas.map((l) => ({ ...l, empaqueCongelado: null, envioCongelado: null }));
  return {
    resultado: calcularUtilidadVenta(armarVentaEntrada(c, sinPorLinea, []).entrada),
    estado: "paid",
    cancelada: false,
    fecha_creacion: c.fechaCreacion,
    fecha_despacho: null,
    fecha_entrega: null,
    cuenta_nickname: nickname,
    lineas: lineas.map((l) => ({ linea: l.linea, titulo: `Producto ${l.linea}`, sku_codigo: `SKU-${l.linea}` })),
  };
}

const COLUMNAS_MONTO = ["recaudo", "recaudo_sin_costo", "comision_ml", "flete_ml", "costo_producto", "empaque", "envio", "utilidad"] as const;
const COLUMNAS_CONTEO = ["ventas", "ventas_sin_costo", "cantidad"] as const;

function sumarColumna(totales: TotalesDetalle[], columna: (typeof COLUMNAS_MONTO)[number]): string {
  return desdeCentavos(totales.reduce((s, t) => s + aCentavos(t[columna]), BigInt(0)));
}

describe("armarVentaEntrada (issue #131 Parte A)", () => {
  it("valor_venta tal cual; sin fecha de pago usa la de creación; comisión y flete vacíos → 0 con aviso", () => {
    const { entrada, avisos } = armarVentaEntrada(
      cabecera({ fechaPagoAprobado: null, comisionMl: null, fleteMl: null }),
      [linea(1, { valorLinea: "100000.00" })],
      []
    );
    expect(entrada.valor_venta).toBe("100000.00");
    expect(entrada.fecha_pago_aprobado).toEqual(new Date("2026-10-20T15:00:00Z"));
    expect(entrada.comision_ml).toBe("0.00");
    expect(entrada.flete_ml).toBe("0.00");
    expect(avisos).toEqual(["comision_sin_dato", "flete_sin_dato"]);
  });

  it("líneas con empaque/envío completos van todas; una foto a medias no pasa ninguna y el motor reparte", () => {
    const completa = armarVentaEntrada(cabecera(), [linea(2, { empaqueCongelado: "1000.00", envioCongelado: "1500.00" }), linea(1)], []);
    expect(completa.avisos).toEqual([]);
    expect(completa.entrada.lineas.map((l) => [l.linea, l.empaque_congelado, l.envio_congelado])).toEqual([
      [1, "1000.00", "1500.00"],
      [2, "1000.00", "1500.00"],
    ]);

    const aMedias = armarVentaEntrada(cabecera(), [linea(1), linea(2, { empaqueCongelado: null, envioCongelado: null })], []);
    expect(aMedias.entrada.lineas.every((l) => !("empaque_congelado" in l) && !("envio_congelado" in l))).toBe(true);
    // El motor reparte el valor del paquete por peso, con suma exacta.
    const resultado = calcularUtilidadVenta(aMedias.entrada);
    expect(resultado.lineas.map((l) => l.empaque.valor)).toEqual(["1000.00", "1000.00"]);
    expect(resultado.lineas.map((l) => l.envio.valor)).toEqual(["1500.00", "1500.00"]);
  });

  it("pasa también las correcciones anuladas: el motor solo usa la activa", () => {
    const { entrada } = armarVentaEntrada(cabecera(), [linea(1, { valorLinea: "100000.00", empaqueCongelado: "2000.00", envioCongelado: "3000.00" })], [
      { linea: 1, campo: "costo_producto", valorNuevo: "5000.00", anuladaTs: new Date("2026-10-22T10:00:00Z") },
      { linea: 1, campo: "costo_producto", valorNuevo: "8000.00", anuladaTs: null },
    ]);
    expect(entrada.correcciones).toHaveLength(2);
    expect(calcularUtilidadVenta(entrada).costo_producto).toEqual({ valor: "8000.00", origen: "corregido" });
  });
});

describe("resumirPorCuenta (issue #131 Parte A)", () => {
  // Dos días, dos cuentas, una venta sin costo y centavos que no dividen
  // parejo.
  const ventas = [
    ventaDetalle(cabecera({ pedidoId: "a1", cuentaMlId: "ca", valorVenta: "33333.33", comisionMl: "3999.99" }), [linea(1, { valorLinea: "33333.33" })], "Mateo"),
    ventaDetalle(
      cabecera({ pedidoId: "a2", cuentaMlId: "ca", fechaCreacion: new Date("2026-10-21T15:00:00Z"), valorVenta: "70000.01" }),
      [linea(1, { valorLinea: "35000.00" }), linea(2, { valorLinea: "35000.01" })],
      "Mateo"
    ),
    ventaDetalle(cabecera({ pedidoId: "b1", cuentaMlId: "cb" }), [linea(1, { valorLinea: "100000.00", costoCongelado: null })], "Rafa"),
    ventaDetalle(
      cabecera({ pedidoId: "b2", cuentaMlId: "cb", fechaCreacion: new Date("2026-10-21T16:00:00Z"), valorVenta: "12345.67" }),
      [linea(1, { valorLinea: "12345.67", costoCongelado: "0.00" })],
      "Rafa"
    ),
  ];
  const detalle = armarDetalleVentas(ventas, { agruparPor: "creacion" });
  const resumen = resumirPorCuenta(detalle);

  it("cada cuenta cuadra al centavo con la suma de sus filas en todos los días, y las cuentas suman el total", () => {
    expect(resumen.map((r) => r.nickname)).toEqual(["Mateo", "Rafa"]);
    for (const r of resumen) {
      const deLaCuenta = detalle.dias.flatMap((d) => d.cuentas.filter((c) => c.cuenta_ml_id === r.cuenta_ml_id).map((c) => c.totales));
      expect(deLaCuenta).toHaveLength(2);
      for (const col of COLUMNAS_MONTO) expect(r.totales[col], col).toBe(sumarColumna(deLaCuenta, col));
      for (const col of COLUMNAS_CONTEO) expect(r.totales[col], col).toBe(deLaCuenta.reduce((s, t) => s + t[col], 0));
    }
    const totales = resumen.map((r) => r.totales);
    for (const col of COLUMNAS_MONTO) expect(sumarColumna(totales, col), col).toBe(detalle.total[col]);
    for (const col of COLUMNAS_CONTEO) expect(totales.reduce((s, t) => s + t[col], 0), col).toBe(detalle.total[col]);
  });

  it("% de ventas con costo: un costo 0.00 puesto a propósito cuenta como con costo y no lleva alerta", () => {
    const rafa = resumen.find((r) => r.nickname === "Rafa")!;
    expect(rafa.totales.ventas).toBe(2);
    expect(rafa.totales.ventas_sin_costo).toBe(1);
    expect(rafa.porcentaje_ventas_con_costo).toBe("50.00");
    expect(ventas.find((v) => v.resultado.pedido_id === "b2")!.resultado.avisos).not.toContain("sin_costo");
    expect(resumen.find((r) => r.nickname === "Mateo")!.porcentaje_ventas_con_costo).toBe("100.00");
    expect(porcentajeVentasConCosto(detalle.total)).toBe("75.00");
    expect(porcentajeVentasConCosto({ ventas: 0, ventas_sin_costo: 0 })).toBeNull();
  });

  it("los porcentajes se recalculan sobre las sumas (nunca se suman porcentajes)", () => {
    const mateo = resumen.find((r) => r.nickname === "Mateo")!;
    // % ML = comisión ÷ recaudo; el flete no entra.
    // 15999.99 ÷ 103333.34 = 15,48 %; promediar los dos días daría otra cifra.
    expect(mateo.totales.porcentaje_ml).toBe("15.48");
    expect(mateo.totales.recaudo).toBe("103333.34");
    expect(mateo.totales.comision_ml).toBe("15999.99");
  });
});

describe("resolverRangoVentas (issue #131 Parte A)", () => {
  it("sin fechas: el mes en curso de Bogotá, aunque en UTC ya sea el mes siguiente", () => {
    // 31-oct 22:00 en Bogotá = 1-nov 03:00 UTC.
    const ahora = new Date("2026-11-01T03:00:00Z");
    expect(mesActualBogota(ahora)).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    const { rango } = resolverRangoVentas(undefined, undefined, ahora);
    expect(rango?.inicio.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(rango?.finExclusivo.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(mesActualBogota(new Date("2028-02-10T12:00:00Z"))).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
  });

  it("valida el rango con un error claro: máximo 31 días, hasta no antes de desde, días reales", () => {
    const ahora = new Date("2026-10-28T12:00:00Z");
    expect(resolverRangoVentas("2026-10-01", "2026-10-31", ahora).rango?.desde).toBe("2026-10-01");
    expect(resolverRangoVentas("2026-10-01", "2026-11-01", ahora).error).toMatch(/máximo 31 días/);
    expect(resolverRangoVentas("2026-10-10", "2026-10-09", ahora).error).toMatch(/anterior/);
    expect(resolverRangoVentas("2026-02-30", "2026-03-01", ahora).error).toMatch(/AAAA-MM-DD/);
    // Una sola fecha = ese día.
    const unDia = resolverRangoVentas("2026-10-20", undefined, ahora).rango!;
    expect([unDia.desde, unDia.hasta]).toEqual(["2026-10-20", "2026-10-20"]);
  });
});
