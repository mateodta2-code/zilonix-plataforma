import { describe, expect, it } from "vitest";
import { leerReporteTransacciones } from "@/lib/falabella/reporte-transacciones";
import { crearReporteDePrueba } from "@/lib/test-utils/reporte-falabella";
import type { MaestraSku } from "./combo-sku";
import { aDiezmilesimas, calcularUtilidadFalabella, type MovimientoEntrada, type PedidoFalabellaEntrada } from "./utilidad-falabella";

// Issue #422 — utilidad por orden de Falabella con el corte del 11 de
// noviembre ANONIMIZADO (lib/test-utils/reporte-falabella.ts): 8 órdenes,
// precio 185800, comisiones -28869, envíos neto -12300, retenciones
// -26800.06.

const CUENTA = "cuenta-falabella-1";

function movimientosDelCorte(): MovimientoEntrada[] {
  const reporte = leerReporteTransacciones(crearReporteDePrueba());
  if (!reporte.ok) throw new Error(reporte.mensaje);
  return reporte.lineas.map((l) => ({ cuentaId: CUENTA, numeroOrden: l.numeroOrden, sku: l.sku, categoria: l.categoria, monto: l.monto }));
}

function pedido(numero: string, otros: Partial<PedidoFalabellaEntrada> = {}): PedidoFalabellaEntrada {
  return {
    pedidoId: `pedido-${numero}`,
    numeros: [numero],
    numeroVisible: numero,
    cuentaId: CUENTA,
    cuenta: "Tienda de prueba",
    fecha: new Date("2026-11-03T15:00:00Z"),
    moneda: "COP",
    ...otros,
  };
}

const ORDENES = ["3000001", "3000002", "3000003", "3000004", "3000005", "3000006", "3000007", "3000008"];

function fila(costo: string | null): MaestraSku {
  return { costo, empaque: null, empaqueProveedor: null, envioAgencia: null };
}

// La maestra guarda el SKU normalizado (mayúsculas).
const MAESTRA = new Map(ORDENES.map((_, i) => [`SKU-PRUEBA-${i + 1}`, fila("5000.00")]));

describe("calcularUtilidadFalabella — corte del 11 de noviembre", () => {
  const { ordenes, totales } = calcularUtilidadFalabella({ pedidos: ORDENES.map((o) => pedido(o)), movimientos: movimientosDelCorte(), maestra: MAESTRA });

  it("utilidad de una orden: ventas − costo − comisión − envío neto", () => {
    const primera = ordenes.find((o) => o.numero === "3000001")!;
    expect(primera).toMatchObject({
      estado: "calculada",
      cantidad: 1,
      ventas: "20000.00",
      costo: "5000.00",
      comisiones: "-3108.00",
      envios: "-7900.00",
      promociones: "0.00",
      retenciones: "-8933.35",
      // 20000 − 5000 − 3108 − 7900: las retenciones NO restan.
      utilidad: "3992.00",
      porcentajeUtilidad: "19.96",
    });
    // «Envío a cargo del seller» viene positivo y suma.
    expect(ordenes.find((o) => o.numero === "3000003")).toMatchObject({ envios: "3500.00", utilidad: "13703.00" });
  });

  it("totales del corte: cuadran con la conciliación y las retenciones van aparte", () => {
    expect(totales).toMatchObject({
      ordenes: 8,
      ordenesCalculadas: 8,
      ordenesFaltaCosto: 0,
      ordenesSinReporte: 0,
      cantidad: 8,
      ventas: "185800.00",
      costo: "40000.00",
      comisiones: "-28869.00",
      envios: "-12300.00",
      // 185800 − 28869 − 12300 − 40000
      utilidadOrdenes: "104631.00",
      cargosSinOrden: "0.00",
      utilidadPeriodo: "104631.00",
      retenciones: "-26800.06",
    });
  });
});

describe("calcularUtilidadFalabella — casos", () => {
  it("un SKU viejo sin costo en la maestra sale como «Falta costo», sin costo inventado", () => {
    const movimientos = movimientosDelCorte().map((m) => (m.numeroOrden === "3000002" ? { ...m, sku: "FULKit6027fulfy" } : m));
    // La base del SKU viejo sí tiene costo: igual no se adivina.
    const maestra = new Map([...MAESTRA, ["FULKIT6027", fila("9000.00")]]);
    const { ordenes, totales } = calcularUtilidadFalabella({ pedidos: ORDENES.map((o) => pedido(o)), movimientos, maestra });
    const orden = ordenes.find((o) => o.numero === "3000002")!;
    expect(orden).toMatchObject({ estado: "falta_costo", costo: null, utilidad: null, skusSinCosto: ["FULKit6027fulfy"] });
    expect(totales).toMatchObject({ ordenesFaltaCosto: 1, ordenesCalculadas: 7, ventasFaltaCosto: "25000.00", ventas: "185800.00" });
    // Fuera de la utilidad: 104631 − (25000 − 3885 − 7900 − 5000).
    expect(totales.utilidadOrdenes).toBe("96416.00");
  });

  it("usa la maestra con el SKU vendedor tal cual y el combo X3 por su base", () => {
    const movimientos = movimientosDelCorte().map((m) =>
      m.numeroOrden === "3000001" ? { ...m, sku: "FULOre6299" } : m.numeroOrden === "3000002" ? { ...m, sku: "FULCom6304x3" } : m
    );
    const maestra = new Map([...MAESTRA, ["FULORE6299", fila("4000.00")], ["FULCOM6304", fila("2000.00")]]);
    const { ordenes } = calcularUtilidadFalabella({ pedidos: ORDENES.map((o) => pedido(o)), movimientos, maestra });
    expect(ordenes.find((o) => o.numero === "3000001")).toMatchObject({ estado: "calculada", costo: "4000.00" });
    expect(ordenes.find((o) => o.numero === "3000002")).toMatchObject({ estado: "calculada", costo: "6000.00" });
  });

  it("la publicidad sin Nº de orden se resta del periodo, no de una orden", () => {
    const publicidad: MovimientoEntrada = { cuentaId: CUENTA, numeroOrden: null, sku: null, categoria: "publicidad", monto: "-11900.0000" };
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: ORDENES.map((o) => pedido(o)),
      movimientos: [...movimientosDelCorte(), publicidad],
      maestra: MAESTRA,
    });
    expect(ordenes.find((o) => o.numero === "3000001")!.utilidad).toBe("3992.00");
    expect(totales).toMatchObject({ utilidadOrdenes: "104631.00", cargosSinOrden: "-11900.00", utilidadPeriodo: "92731.00" });
  });

  it("las retenciones no restan: con o sin ellas la utilidad es la misma", () => {
    const sinRetenciones = movimientosDelCorte().filter((m) => m.categoria !== "retencion");
    const con = calcularUtilidadFalabella({ pedidos: ORDENES.map((o) => pedido(o)), movimientos: movimientosDelCorte(), maestra: MAESTRA });
    const sin = calcularUtilidadFalabella({ pedidos: ORDENES.map((o) => pedido(o)), movimientos: sinRetenciones, maestra: MAESTRA });
    expect(con.totales.utilidadPeriodo).toBe(sin.totales.utilidadPeriodo);
    expect(con.totales.retenciones).toBe("-26800.06");
    expect(sin.totales.retenciones).toBe("0.00");
  });

  it("una orden vendida sin reporte sale «Sin reporte de Falabella» y no suma nada", () => {
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [...ORDENES.map((o) => pedido(o)), pedido("3000099")],
      movimientos: movimientosDelCorte(),
      maestra: MAESTRA,
    });
    expect(ordenes.find((o) => o.numero === "3000099")).toMatchObject({ estado: "sin_reporte", utilidad: null, costo: null, ventas: "0.00" });
    expect(totales).toMatchObject({ ordenes: 9, ordenesSinReporte: 1, ventas: "185800.00", utilidadPeriodo: "104631.00" });
  });

  it("encuentra la orden por el OrderNumber de sus ítems y solo en su cuenta", () => {
    const porOrderNumber = pedido("1104089001", { numeros: ["1104089001", "3000001"] });
    const otraCuenta = pedido("3000002", { cuentaId: "otra-cuenta" });
    const { ordenes } = calcularUtilidadFalabella({ pedidos: [porOrderNumber, otraCuenta], movimientos: movimientosDelCorte(), maestra: MAESTRA });
    expect(ordenes[0]).toMatchObject({ numero: "1104089001", estado: "calculada", utilidad: "3992.00" });
    expect(ordenes[1].estado).toBe("sin_reporte");
  });

  it("dos pedidos de la misma cuenta con el mismo OrderNumber quedan en conflicto y no suman dos veces", () => {
    const uno = pedido("1104089001", { numeros: ["1104089001", "3000001"] });
    const otro = pedido("1104089777", { numeros: ["1104089777", "3000001"] });
    // Mismo número en otra cuenta: no es conflicto.
    const otraCuenta = pedido("3000001", { cuentaId: "otra-cuenta" });
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [uno, otro, otraCuenta, pedido("3000002")],
      movimientos: movimientosDelCorte(),
      maestra: MAESTRA,
    });
    expect(ordenes[0]).toMatchObject({ estado: "conflicto", utilidad: null, ventas: "0.00", numerosRepetidos: ["3000001"] });
    expect(ordenes[1]).toMatchObject({ estado: "conflicto", numerosRepetidos: ["3000001"] });
    expect(ordenes[2].estado).toBe("sin_reporte");
    expect(totales).toMatchObject({ ordenesConflicto: 2, ordenesCalculadas: 1, ventas: "25000.00" });
  });

  it("aDiezmilesimas lee los 4 decimales de numeric(16,4)", () => {
    expect(aDiezmilesimas("-3530.0200")).toBe(BigInt(-35300200));
    expect(aDiezmilesimas("185800")).toBe(BigInt(1858000000));
    expect(() => aDiezmilesimas("1.23456")).toThrow();
  });
});
