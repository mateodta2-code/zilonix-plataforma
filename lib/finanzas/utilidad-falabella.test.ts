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

  // Issue #422: caso real del corte del 11/11 — la orden 8002135931
  // (OrderId) es la 3260783999 del reporte (OrderNumber de GetOrders).
  it("cruza la orden 3260783999 del reporte con su OrderId 8002135931", () => {
    const movimientos = movimientosDelCorte().map((m) => (m.numeroOrden === "3000001" ? { ...m, numeroOrden: "3260783999" } : m));
    const real = pedido("3260783999", { numeros: ["3260783999", "8002135931"], numeroInterno: "8002135931" });
    const { ordenes } = calcularUtilidadFalabella({ pedidos: [real], movimientos, maestra: MAESTRA });
    expect(ordenes[0]).toMatchObject({ numero: "3260783999", numeroInterno: "8002135931", estado: "calculada", utilidad: "3992.00" });
  });

  it("sin OrderNumber guardado (solo OrderId) la orden queda sin reporte", () => {
    const movimientos = movimientosDelCorte().map((m) => (m.numeroOrden === "3000001" ? { ...m, numeroOrden: "3260783999" } : m));
    const { ordenes } = calcularUtilidadFalabella({ pedidos: [pedido("8002135931")], movimientos, maestra: MAESTRA });
    expect(ordenes[0]).toMatchObject({ numero: "8002135931", numeroInterno: null, estado: "sin_reporte" });
  });

  it("encuentra la orden por su OrderNumber y solo en su cuenta", () => {
    const porOrderNumber = pedido("1104089001", { numeros: ["3000001", "1104089001"] });
    const otraCuenta = pedido("3000002", { cuentaId: "otra-cuenta" });
    const { ordenes } = calcularUtilidadFalabella({ pedidos: [porOrderNumber, otraCuenta], movimientos: movimientosDelCorte(), maestra: MAESTRA });
    expect(ordenes[0]).toMatchObject({ numero: "1104089001", estado: "calculada", utilidad: "3992.00" });
    expect(ordenes[1].estado).toBe("sin_reporte");
  });

  // Revisión de Pablo en #482: el OrderId de A es igual al numero_orden
  // de B, en la misma cuenta. Las líneas de 3000002 son de B.
  it("el OrderId de un pedido igual al OrderNumber de otro no le roba las líneas", () => {
    const a = pedido("3000001", { pedidoId: "pedido-a", numeros: ["3000001", "3000002"], numeroInterno: "3000002" });
    const b = pedido("3000002", { pedidoId: "pedido-b", numeros: ["3000002", "8000000002"], numeroInterno: "8000000002" });
    const { ordenes, totales } = calcularUtilidadFalabella({ pedidos: [a, b], movimientos: movimientosDelCorte(), maestra: MAESTRA });
    expect(ordenes[0]).toMatchObject({ numero: "3000001", estado: "calculada", ventas: "20000.00" });
    expect(ordenes[1]).toMatchObject({ numero: "3000002", estado: "calculada", ventas: "25000.00" });
    expect(totales).toMatchObject({ ordenesConflicto: 0, ventas: "45000.00" });
  });

  it("sin líneas por su OrderNumber, A no usa un OrderId que es el OrderNumber de B", () => {
    const a = pedido("3999999", { pedidoId: "pedido-a", numeros: ["3999999", "3000002"], numeroInterno: "3000002" });
    const b = pedido("3000002", { pedidoId: "pedido-b", numeros: ["3000002", "8000000002"], numeroInterno: "8000000002" });
    const { ordenes, totales } = calcularUtilidadFalabella({ pedidos: [a, b], movimientos: movimientosDelCorte(), maestra: MAESTRA });
    expect(ordenes[0]).toMatchObject({ estado: "sin_reporte", ventas: "0.00" });
    expect(ordenes[1]).toMatchObject({ estado: "calculada", ventas: "25000.00" });
    expect(totales).toMatchObject({ ordenesConflicto: 0, ventas: "25000.00" });
  });

  it("el OrderId de respaldo solo se usa si el OrderNumber no tiene líneas", () => {
    // Las dos claves tienen líneas en el reporte: se suma solo la del OrderNumber.
    const p = pedido("3000001", { numeros: ["3000001", "3000002"], numeroInterno: "3000002" });
    const { ordenes } = calcularUtilidadFalabella({ pedidos: [p], movimientos: movimientosDelCorte(), maestra: MAESTRA });
    expect(ordenes[0]).toMatchObject({ estado: "calculada", ventas: "20000.00" });
    // Sin líneas por el OrderNumber, cae al OrderId.
    const viejo = pedido("3888888", { numeros: ["3888888", "3000002"], numeroInterno: "3000002" });
    expect(calcularUtilidadFalabella({ pedidos: [viejo], movimientos: movimientosDelCorte(), maestra: MAESTRA }).ordenes[0]).toMatchObject({ ventas: "25000.00" });
  });

  it("dos pedidos de la misma cuenta con el mismo OrderNumber quedan en conflicto y no suman dos veces", () => {
    const uno = pedido("1104089001", { numeros: ["3000001", "1104089001"] });
    const otro = pedido("1104089777", { numeros: ["3000001", "1104089777"] });
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
