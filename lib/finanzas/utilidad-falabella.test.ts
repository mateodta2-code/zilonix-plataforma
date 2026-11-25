import { describe, expect, it } from "vitest";
import { leerReporteTransacciones } from "@/lib/falabella/reporte-transacciones";
import { crearReporteDePrueba } from "@/lib/test-utils/reporte-falabella";
import type { MaestraSku } from "./combo-sku";
import {
  aDiezmilesimas,
  calcularUtilidadFalabella,
  construirMaestraFalabella,
  construirReferenciasEstimacionFalabella,
  type MovimientoEntrada,
  type PedidoFalabellaEntrada,
  ventasSinIvaCentavos,
} from "./utilidad-falabella";

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

describe("calcularUtilidadFalabella — utilidad estimada sin reporte", () => {
  // Historial: la orden 9001 (la más reciente) vendió SKU-A a 100000 con
  // comisión -15000 (15 %) y envío -8000; la 9002 (más vieja) vendió SKU-A
  // a 100000 con comisión -20000 y envío -9000; la 9003 vendió SKU-B con
  // envío directo (no sirve de referencia de envío).
  const mov = (numeroOrden: string, sku: string | null, categoria: MovimientoEntrada["categoria"], monto: string, tipoTransaccion = "x"): MovimientoEntrada => ({
    cuentaId: CUENTA,
    numeroOrden,
    sku,
    categoria,
    monto,
    tipoTransaccion,
  });
  const historial: MovimientoEntrada[] = [
    mov("9001", "sku-a", "precio", "100000.0000", "Precio producto"),
    mov("9001", null, "comision", "-15000.0000", "Comisión"),
    mov("9001", null, "envio", "-8000.0000", "Envío"),
    mov("9002", "sku-a", "precio", "100000.0000"),
    mov("9002", null, "comision", "-20000.0000"),
    mov("9002", null, "envio", "-9000.0000"),
    mov("9003", "sku-b", "precio", "50000.0000"),
    mov("9003", null, "comision", "-5000.0000"),
    mov("9003", null, "envio", "12000.0000", "Pago por ENVIO directo"),
  ];
  const referencias = construirReferenciasEstimacionFalabella(historial);
  const maestra = new Map([
    ["SKU-A", fila("40000.00")],
    ["SKU-B", fila("10000.00")],
    ["SKU-NUEVO", fila("20000.00")],
  ]);
  const item = (sku: string, precio: string, nombre = `Producto ${sku}`, envioPropio = false) => ({ sku, nombre, precio, envioPropio });

  it("referencias: último % y envío del SKU; respaldo de la cuenta sin envíos directos", () => {
    expect(referencias.get(`${CUENTA}|SKU-A`)).toEqual({ tasaComisionDiezmilesimas: BigInt(-1500), envioNetoUnitarioCentavos: BigInt(-800000) });
    // SKU-B solo tuvo envío directo: el envío sale de la mediana de la cuenta.
    expect(referencias.get(`${CUENTA}|SKU-B`)).toEqual({ tasaComisionDiezmilesimas: BigInt(-1000), envioNetoUnitarioCentavos: BigInt(-850000) });
    // Mediana de tasas (-1500, -2000, -1000) y de envíos (-8000, -9000).
    expect(referencias.get(`${CUENTA}|*`)).toEqual({ tasaComisionDiezmilesimas: BigInt(-1500), envioNetoUnitarioCentavos: BigInt(-850000) });
  });

  it("estima con el último reporte del mismo SKU y agrupa productos", () => {
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [pedido("5001", { itemsApi: [item("SKU-A", "120000.00"), item("SKU-A", "120000.00")] })],
      movimientos: [],
      maestra,
      referenciasEstimacion: referencias,
    });
    expect(ordenes[0]).toMatchObject({
      estado: "estimada",
      cantidad: 2,
      ventas: "240000.00",
      costo: "80000.00",
      comisiones: "-36000.00",
      envios: "-16000.00",
      // 240000 − 80000 − 36000 − 16000
      utilidad: "108000.00",
      porcentajeUtilidad: "45.00",
      productos: [{ nombre: "Producto SKU-A", sku: "SKU-A", cantidad: 2 }],
      envioPropio: false,
    });
    expect(totales).toMatchObject({ ordenesEstimadas: 1, utilidadEstimadas: "108000.00", ventasEstimadas: "240000.00", utilidadPeriodo: "0.00", ordenesCalculadas: 0 });
  });

  it("SKU nuevo: usa el respaldo de la cuenta", () => {
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("5002", { itemsApi: [item("sku-nuevo", "100000.00")] })],
      movimientos: [],
      maestra,
      referenciasEstimacion: referencias,
    });
    expect(ordenes[0]).toMatchObject({ estado: "estimada", comisiones: "-15000.00", envios: "-8500.00", utilidad: "56500.00" });
  });

  it("envío propio: envío estimado en 0.00 y la orden queda marcada", () => {
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("5003", { itemsApi: [item("SKU-A", "100000.00", "Lámpara", true)] })],
      movimientos: [],
      maestra,
      referenciasEstimacion: referencias,
    });
    expect(ordenes[0]).toMatchObject({ estado: "estimada", envios: "0.00", envioPropio: true, utilidad: "45000.00" });
  });

  it("detecta el envío directo en el reporte, sin importar tildes ni mayúsculas", () => {
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("9003")],
      movimientos: historial,
      maestra,
    });
    expect(ordenes[0]).toMatchObject({ estado: "calculada", envioPropio: true, productos: [{ nombre: "sku-b", sku: "sku-b", cantidad: 1 }] });
  });

  it("sin costo: conserva cantidad, ventas y producto visibles", () => {
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [pedido("5004", { itemsApi: [item("SKU-SIN-COSTO", "70000.00", "Silla")] })],
      movimientos: [],
      maestra,
      referenciasEstimacion: referencias,
    });
    expect(ordenes[0]).toMatchObject({
      estado: "falta_costo",
      cantidad: 1,
      ventas: "70000.00",
      utilidad: null,
      skusSinCosto: ["SKU-SIN-COSTO"],
      productos: [{ nombre: "Silla", sku: "SKU-SIN-COSTO", cantidad: 1 }],
    });
    expect(totales).toMatchObject({ ordenesFaltaCosto: 1, ventasFaltaCosto: "70000.00", ordenesConReporte: 0 });
  });

  it("cuenta sin ningún reporte: «sin_reporte» pero con producto, cantidad y ventas", () => {
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("5005", { itemsApi: [item("SKU-A", "100000.00")] })],
      movimientos: [],
      maestra,
      referenciasEstimacion: new Map(),
    });
    expect(ordenes[0]).toMatchObject({ estado: "sin_reporte", cantidad: 1, ventas: "100000.00", utilidad: null, productos: [{ sku: "SKU-A", cantidad: 1 }] });
  });

  it("pasa sola a «calculada» cuando llega el reporte, y separa los totales", () => {
    const pedidos = [pedido("9001", { itemsApi: [item("SKU-A", "100000.00")] }), pedido("5001", { itemsApi: [item("SKU-A", "100000.00")] })];
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos,
      movimientos: historial.filter((m) => m.numeroOrden === "9001"),
      maestra,
      referenciasEstimacion: referencias,
    });
    expect(ordenes.map((o) => o.estado)).toEqual(["calculada", "estimada"]);
    // 9001 real: 100000 − 40000 − 15000 − 8000.
    expect(ordenes[0]).toMatchObject({ utilidad: "37000.00", productos: [{ nombre: "Producto SKU-A", sku: "SKU-A", cantidad: 1 }] });
    expect(totales).toMatchObject({
      ordenesCalculadas: 1,
      ordenesEstimadas: 1,
      utilidadPeriodo: "37000.00",
      utilidadEstimadas: "37000.00",
      ventas: "100000.00",
      ventasEstimadas: "100000.00",
    });
  });
});

describe("calcularUtilidadFalabella — alias, ajustes manuales y defectos de cuenta", () => {
  const mov = (numeroOrden: string, sku: string | null, categoria: MovimientoEntrada["categoria"], monto: string, tipoTransaccion = "x"): MovimientoEntrada => ({
    cuentaId: CUENTA,
    numeroOrden,
    sku,
    categoria,
    monto,
    tipoTransaccion,
  });
  // Orden 7001 con reporte: SKU de Falabella «FULKit6027fulfy», precio
  // 100000, comisión -15000, envío -8000.
  const reporte7001 = [
    mov("7001", "FULKit6027fulfy", "precio", "100000.0000"),
    mov("7001", null, "comision", "-15000.0000"),
    mov("7001", null, "envio", "-8000.0000"),
  ];
  // Orden 7002 con envío directo (el vendedor pone el flete).
  const reporte7002 = [
    mov("7002", "KIT-6027", "precio", "100000.0000"),
    mov("7002", null, "comision", "-15000.0000"),
    mov("7002", null, "envio", "0.0000", "Pago por envío directo"),
  ];
  const filaAlias = (sku: string, skuFalabella: string | null, costo: string | null) => ({ sku, skuFalabella, ...fila(costo) });
  const item = (sku: string, precio: string, envioPropio = false) => ({ sku, nombre: sku, precio, envioPropio });

  it("alias: costea por sku_falabella cuando no hay coincidencia exacta", () => {
    const maestra = construirMaestraFalabella([filaAlias("KIT-6027", "fulkit6027FULFY ", "30000.00")]);
    const { ordenes } = calcularUtilidadFalabella({ pedidos: [pedido("7001")], movimientos: reporte7001, maestra });
    // 100000 − 30000 − 15000 − 8000.
    expect(ordenes[0]).toMatchObject({ estado: "calculada", costo: "30000.00", utilidad: "47000.00", costoManual: null });
  });

  it("alias: la coincidencia exacta en sku_codigo gana al alias de otro SKU", () => {
    const maestra = construirMaestraFalabella([
      filaAlias("KIT-6027", "FULKIT6027FULFY", "30000.00"),
      filaAlias("FULKIT6027FULFY", null, "25000.00"),
    ]);
    expect(maestra.get("FULKIT6027FULFY")?.costo).toBe("25000.00");
    expect(maestra.get("KIT-6027")?.costo).toBe("30000.00");
  });

  it("costo_manual reemplaza la maestra y saca la orden de «Falta costo»", () => {
    const sinMaestra = calcularUtilidadFalabella({ pedidos: [pedido("7001")], movimientos: reporte7001, maestra: new Map() });
    expect(sinMaestra.ordenes[0].estado).toBe("falta_costo");

    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [pedido("7001", { costoManual: "12000.00" })],
      movimientos: reporte7001,
      maestra: new Map(),
    });
    expect(ordenes[0]).toMatchObject({ estado: "calculada", costo: "12000.00", utilidad: "65000.00", costoManual: "12000.00", skusSinCosto: [] });
    expect(totales).toMatchObject({ ordenesCalculadas: 1, ordenesFaltaCosto: 0, costo: "12000.00" });
  });

  it("costo_manual también gana sobre una maestra con costo", () => {
    const maestra = construirMaestraFalabella([filaAlias("KIT-6027", "FULKIT6027FULFY", "30000.00")]);
    const { ordenes } = calcularUtilidadFalabella({ pedidos: [pedido("7001", { costoManual: "0.00" })], movimientos: reporte7001, maestra });
    expect(ordenes[0]).toMatchObject({ costo: "0.00", utilidad: "77000.00" });
  });

  it("costo_manual en una orden sin reporte: «Estimada» en vez de «Falta costo»", () => {
    const referencias = construirReferenciasEstimacionFalabella(reporte7001);
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("7100", { itemsApi: [item("SIN-MAESTRA", "50000.00")], costoManual: "10000.00" })],
      movimientos: [],
      maestra: new Map(),
      referenciasEstimacion: referencias,
    });
    // Comisión 15 % de la cuenta, envío -8000: 50000 − 10000 − 7500 − 8000.
    expect(ordenes[0]).toMatchObject({ estado: "estimada", costo: "10000.00", utilidad: "24500.00" });
  });

  it("flete_manual resta encima del envío del reporte (que se conserva)", () => {
    const maestra = construirMaestraFalabella([filaAlias("KIT-6027", "FULKIT6027FULFY", "30000.00")]);
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [pedido("7001", { fleteManual: "5000.00" })],
      movimientos: reporte7001,
      maestra,
    });
    // Envío -8000 del reporte − 5000 manual; 100000 − 30000 − 15000 − 13000.
    expect(ordenes[0]).toMatchObject({ estado: "calculada", envios: "-13000.00", utilidad: "42000.00", fleteManual: "5000.00" });
    expect(totales).toMatchObject({ envios: "-13000.00", utilidadPeriodo: "42000.00" });
  });

  it("flete_manual en envío propio con reporte", () => {
    const maestra = construirMaestraFalabella([filaAlias("KIT-6027", null, "30000.00")]);
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("7002", { fleteManual: "9500.00" })],
      movimientos: reporte7002,
      maestra,
    });
    expect(ordenes[0]).toMatchObject({ estado: "calculada", envioPropio: true, envios: "-9500.00", utilidad: "45500.00", fleteManual: "9500.00" });
  });

  it("flete_manual en envío propio sin reporte (estimada)", () => {
    const referencias = construirReferenciasEstimacionFalabella(reporte7001);
    const maestra = construirMaestraFalabella([filaAlias("KIT-6027", null, "30000.00")]);
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("7200", { itemsApi: [item("KIT-6027", "100000.00", true)], fleteManual: "7000.00" })],
      movimientos: [],
      maestra,
      referenciasEstimacion: referencias,
    });
    // El envío estimado de un envío propio es 0; solo resta el manual.
    expect(ordenes[0]).toMatchObject({ estado: "estimada", envioPropio: true, envios: "-7000.00", utilidad: "48000.00" });
  });

  it("los ajustes manuales no se aplican en «conflicto», pero se conservan para el lápiz", () => {
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("7001", { pedidoId: "a", costoManual: "1.00" }), pedido("7001", { pedidoId: "b" })],
      movimientos: reporte7001,
      maestra: new Map(),
    });
    expect(ordenes[0]).toMatchObject({ estado: "conflicto", costo: null, costoManual: "1.00" });
  });

  it("cuenta nueva sin reportes: estima con la comisión y el flete por defecto", () => {
    const maestra = construirMaestraFalabella([filaAlias("KIT-6027", null, "30000.00")]);
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [pedido("7300", { itemsApi: [item("KIT-6027", "100000.00"), item("KIT-6027", "100000.00")] })],
      movimientos: [],
      maestra,
      referenciasEstimacion: new Map(),
      defectosCuenta: new Map([[CUENTA, { comisionPct: "15.50", flete: "6000.00" }]]),
    });
    // 200000 − 60000 − 31000 (15,5 %) − 12000 (2 × 6000).
    expect(ordenes[0]).toMatchObject({ estado: "estimada", comisiones: "-31000.00", envios: "-12000.00", utilidad: "97000.00" });
    expect(totales).toMatchObject({ ordenesEstimadas: 1, ordenesSinReporte: 0, utilidadPeriodo: "0.00" });
  });

  it("defectos: flete vacío cuenta como 0; sin comisión sigue «Sin reporte»", () => {
    const maestra = construirMaestraFalabella([filaAlias("KIT-6027", null, "30000.00")]);
    const pedidos = [pedido("7400", { itemsApi: [item("KIT-6027", "100000.00")] })];
    const soloComision = calcularUtilidadFalabella({
      pedidos,
      movimientos: [],
      maestra,
      referenciasEstimacion: new Map(),
      defectosCuenta: new Map([[CUENTA, { comisionPct: "10", flete: null }]]),
    });
    expect(soloComision.ordenes[0]).toMatchObject({ estado: "estimada", comisiones: "-10000.00", envios: "0.00", utilidad: "60000.00" });

    const sinComision = calcularUtilidadFalabella({
      pedidos,
      movimientos: [],
      maestra,
      referenciasEstimacion: new Map(),
      defectosCuenta: new Map([[CUENTA, { comisionPct: null, flete: "6000.00" }]]),
    });
    expect(sinComision.ordenes[0].estado).toBe("sin_reporte");
  });

  it("defectos: el historial de la cuenta gana a los valores por defecto", () => {
    const referencias = construirReferenciasEstimacionFalabella(reporte7001);
    const maestra = construirMaestraFalabella([filaAlias("KIT-6027", null, "30000.00")]);
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("7500", { itemsApi: [item("KIT-6027", "100000.00")] })],
      movimientos: [],
      maestra,
      referenciasEstimacion: referencias,
      defectosCuenta: new Map([[CUENTA, { comisionPct: "50.00", flete: "99999.00" }]]),
    });
    expect(ordenes[0]).toMatchObject({ estado: "estimada", comisiones: "-15000.00", envios: "-8000.00" });
  });
});

describe("calcularUtilidadFalabella — envío agencia y empaque", () => {
  const cargos = (costo: string, empaque: string | null, envioAgencia: string | null): MaestraSku => ({ ...fila(costo), empaque, envioAgencia });
  const maestra = new Map([
    ["SKU-X", cargos("40000.00", "800.00", "2000.00")],
    ["SKU-Y", cargos("20000.00", "500.00", "3500.00")],
    ["SKU-Z", cargos("40000.00", "600.00", null)],
  ]);
  const item = (sku: string, precio: string, tipoEnvio: string | null = "Dropshipping") => ({ sku, nombre: sku, precio, tipoEnvio, proveedor: "Servientrega" });
  const reporte = (numero: string, sku: string, tipoEnvio?: string): MovimientoEntrada[] => [
    { cuentaId: CUENTA, numeroOrden: numero, sku, categoria: "precio", monto: "100000.00" },
    { cuentaId: CUENTA, numeroOrden: numero, sku, categoria: "comision", monto: "-10000.00" },
    { cuentaId: CUENTA, numeroOrden: numero, sku, categoria: "envio", monto: "-5000.00", tipoTransaccion: tipoEnvio },
  ];

  it("orden de agencia: resta envío agencia y empaque una vez; flete manual sigue aparte", () => {
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [pedido("7001", { itemsApi: [item("SKU-X", "100000.00")], fleteManual: "3000.00" })],
      movimientos: reporte("7001", "SKU-X"),
      maestra,
    });
    expect(ordenes[0]).toMatchObject({
      estado: "calculada",
      tipoEnvio: "agencia",
      envios: "-8000.00",
      envioAgencia: "2000.00",
      empaque: "800.00",
      envioAgenciaSinDato: false,
      // 100000 − 10000 − 8000 − 40000 − 2000 − 800
      utilidad: "39200.00",
    });
    expect(totales).toMatchObject({ envioAgencia: "2000.00", empaque: "800.00", utilidadPeriodo: "39200.00" });
  });

  it("orden de envío propio: no resta envío agencia, sí empaque", () => {
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [pedido("7002", { itemsApi: [item("SKU-X", "100000.00")] })],
      movimientos: reporte("7002", "SKU-X", "Pago por envío directo"),
      maestra,
    });
    expect(ordenes[0]).toMatchObject({ tipoEnvio: "propio", envioPropio: true, envioAgencia: "0.00", empaque: "800.00", utilidad: "44200.00" });
    expect(totales.envioAgencia).toBe("0.00");
  });

  it("varios SKU (estimada): toma el mayor envío agencia y el mayor empaque, una sola vez", () => {
    const { ordenes } = calcularUtilidadFalabella({
      pedidos: [pedido("7003", { itemsApi: [item("SKU-X", "100000.00"), item("SKU-Y", "50000.00")] })],
      movimientos: [],
      maestra,
      defectosCuenta: new Map([[CUENTA, { comisionPct: "10.00", flete: null }]]),
    });
    expect(ordenes[0]).toMatchObject({
      estado: "estimada",
      tipoEnvio: "agencia",
      envioAgencia: "3500.00",
      empaque: "800.00",
      // 150000 − 15000 − 60000 − 3500 − 800
      utilidad: "70700.00",
    });
  });

  it("SKU sin envío agencia: aviso, resta 0; tipo desconocido no resta envío agencia", () => {
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [
        pedido("7004", { itemsApi: [item("SKU-Z", "100000.00")] }),
        pedido("7005", { itemsApi: [item("SKU-X", "100000.00", null)] }),
      ],
      movimientos: [...reporte("7004", "SKU-Z"), ...reporte("7005", "SKU-X")],
      maestra,
    });
    expect(ordenes[0]).toMatchObject({ tipoEnvio: "agencia", envioAgencia: "0.00", envioAgenciaSinDato: true, empaque: "600.00", utilidad: "44400.00" });
    expect(ordenes[1]).toMatchObject({ tipoEnvio: "desconocido", envioAgencia: "0.00", envioAgenciaSinDato: false, utilidad: "44200.00" });
    expect(totales).toMatchObject({ ordenesSinEnvioAgencia: 1, ordenesEnvioDesconocido: 1 });
  });
});

describe("calcularUtilidadFalabella — ventas sin IVA (informativo)", () => {
  const filaAlias = (sku: string, skuFalabella: string | null, costo: string | null) => ({ sku, skuFalabella, ...fila(costo) });
  const item = (sku: string, precio: string) => ({ sku, nombre: sku, precio, envioPropio: false });

  it("ventas sin IVA: en centavos con BigInt, redondeando la mitad lejos de cero", () => {
    // 119000 ÷ 1,19 = 100000.
    expect(ventasSinIvaCentavos(BigInt(11900000), BigInt(1900))).toBe(BigInt(10000000));
    // 0,01 ÷ 1,19 = 0,0084 → 0,01; 0,50 ÷ 2 (100 %) = 0,25.
    expect(ventasSinIvaCentavos(BigInt(1), BigInt(1900))).toBe(BigInt(1));
    expect(ventasSinIvaCentavos(BigInt(50), BigInt(10000))).toBe(BigInt(25));
    expect(ventasSinIvaCentavos(BigInt(11900000), BigInt(0))).toBe(BigInt(11900000));
  });

  it("ventas sin IVA: solo con el % configurado, y la utilidad no cambia", () => {
    const maestra = construirMaestraFalabella([filaAlias("KIT-6027", null, "30000.00")]);
    const entrada = {
      pedidos: [pedido("7500", { itemsApi: [item("KIT-6027", "119000.00")] })],
      movimientos: [],
      maestra,
      referenciasEstimacion: new Map(),
    };
    const sin = calcularUtilidadFalabella({
      ...entrada,
      defectosCuenta: new Map([[CUENTA, { comisionPct: "10", flete: null }]]),
    });
    const con = calcularUtilidadFalabella({
      ...entrada,
      defectosCuenta: new Map([[CUENTA, { comisionPct: "10", flete: null, ivaVentasPct: "19.00" }]]),
    });
    expect(sin.ordenes[0].ventasSinIva).toBeNull();
    expect(sin.totales.ventasSinIva).toBeNull();
    expect(con.ordenes[0]).toMatchObject({ ventas: "119000.00", ventasSinIva: "100000.00" });
    expect(con.ordenes[0].utilidad).toBe(sin.ordenes[0].utilidad);
    expect(con.totales.utilidadEstimadas).toBe(sin.totales.utilidadEstimadas);
  });

  it("ventas sin IVA en el total: suma las órdenes con reporte de cuentas con % configurado", () => {
    const { ordenes, totales } = calcularUtilidadFalabella({
      pedidos: [pedido(ORDENES[0])],
      movimientos: movimientosDelCorte(),
      maestra: new Map(),
      defectosCuenta: new Map([[CUENTA, { comisionPct: null, flete: null, ivaVentasPct: "19" }]]),
    });
    expect(ordenes[0].ventasSinIva).not.toBeNull();
    expect(totales.ventasSinIva).toBe(ordenes[0].ventasSinIva);
  });
});
