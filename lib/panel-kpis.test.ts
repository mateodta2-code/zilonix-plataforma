import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl, empresas, membresias, pedidos, permisosRol, publicaciones, roles, skus, usuarios } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import {
  calcularVentasDeHoy,
  calcularVentasDelMes,
  contarDespachosPendientes,
  contarPedidos,
  contarSkuSinVincular,
  detalleVentasDeHoy,
  formatearVentasDelMes,
  obtenerKpisPanel,
} from "./panel-kpis";

// 15 de junio 2026, 15:00 UTC = 10:00 en Bogotá. Lejos del cambio de
// mes en las dos zonas: si la prueba usara `new Date()`, un CI que
// corriera entre las 00:00 y las 05:00 UTC del día 1 contaría el
// "mes actual" en el mes anterior de Bogotá y el fixture se correría
// de mes.
const AHORA = new Date("2026-06-15T15:00:00.000Z");
const MES_ANTERIOR = new Date("2026-05-15T15:00:00.000Z");

// KPIs reales del panel — prueba real contra Postgres (RLS, no un
// mock: la tabla pedidos/despachos_ml/publicaciones son tablas de
// negocio con empresa_id, el aislamiento no se puede simular). Cada
// función de lib/panel-kpis.ts se prueba con datos de DOS empresas a
// la vez — el punto central es que la empresa A nunca vea (ni mezcle)
// los números de la empresa B.
describe("KPIs del panel (empresa_id, aislamiento A/B)", () => {
  vi.setConfig({ testTimeout: 15_000 });

  const empresaAId = randomUUID();
  const empresaBId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A KPIs", nit: `TEST-KPIA-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B KPIs", nit: `TEST-KPIB-${empresaBId.slice(0, 8)}` })
    );

    const [cuentaA] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaAId,
          cuentaIdExterna: `ml-user-kpia-${randomUUID()}`,
          nickname: "VENDEDOR_KPI_A",
          accessTokenCifrado: cifrarToken("access-a"),
          refreshTokenCifrado: cifrarToken("refresh-a"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const [cuentaB] = await dbComoEmpresa(empresaBId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaBId,
          cuentaIdExterna: `ml-user-kpib-${randomUUID()}`,
          nickname: "VENDEDOR_KPI_B",
          accessTokenCifrado: cifrarToken("access-b"),
          refreshTokenCifrado: cifrarToken("refresh-b"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );

    // Empresa A: dos pedidos COP de este mes (100000.00 + 50000.00 =
    // 150000.00), uno USD de este mes más grande a propósito (500000.00,
    // para que un "quédate con el monto mayor" se note) y uno COP del
    // mes pasado (999999, para probar que "Ventas del mes" lo deja
    // afuera pero "Pedidos" sí lo cuenta). Las fechas son las de AHORA,
    // no `new Date()`: el rango del KPI también recibe AHORA.
    const [pedidoA1] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values({ empresaId: empresaAId, cuentaMlId: cuentaA.id, pedidoIdExterno: `ORD-A1-${randomUUID()}`, fecha: AHORA, total: "100000", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id })
    );
    const [pedidoA2] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values({ empresaId: empresaAId, cuentaMlId: cuentaA.id, pedidoIdExterno: `ORD-A2-${randomUUID()}`, fecha: AHORA, total: "50000", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id })
    );
    const [pedidoA3] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values({ empresaId: empresaAId, cuentaMlId: cuentaA.id, pedidoIdExterno: `ORD-A3-${randomUUID()}`, fecha: MES_ANTERIOR, total: "999999", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id })
    );
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(pedidos).values({
        empresaId: empresaAId,
        cuentaMlId: cuentaA.id,
        pedidoIdExterno: `ORD-A4-${randomUUID()}`,
        fecha: AHORA,
        total: "500000",
        moneda: "USD",
        estado: "paid",
      })
    );

    // despachoA1: imprimible y sin etiqueta todavía -> pendiente.
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(despachosMl).values({
        empresaId: empresaAId,
        pedidoId: pedidoA1.id,
        cuentaMlId: cuentaA.id,
        shipmentIdExterno: `SHIP-A1-${randomUUID()}`,
        status: "ready_to_ship",
        imprimible: true,
      })
    );
    // despachoA2: imprimible pero YA impreso -> no cuenta como pendiente.
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(despachosMl).values({
        empresaId: empresaAId,
        pedidoId: pedidoA2.id,
        cuentaMlId: cuentaA.id,
        shipmentIdExterno: `SHIP-A2-${randomUUID()}`,
        status: "ready_to_ship",
        imprimible: true,
        etiquetaImpresaTs: new Date(),
      })
    );
    // despachoA3: ya no es imprimible (ej. ya lo recogieron) -> tampoco pendiente.
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(despachosMl).values({
        empresaId: empresaAId,
        pedidoId: pedidoA3.id,
        cuentaMlId: cuentaA.id,
        shipmentIdExterno: `SHIP-A3-${randomUUID()}`,
        status: "shipped",
        imprimible: false,
      })
    );

    // Una publicación sin SKU (sin vincular) y una ya vinculada.
    const [skuA] = await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(skus).values({ empresaId: empresaAId, codigo: "KPI-A-1", nombre: "SKU de prueba A" }).returning({ id: skus.id })
    );
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(publicaciones).values({
        empresaId: empresaAId,
        cuentaMlId: cuentaA.id,
        publicacionIdExterno: `MCO-A-SINSKU-${randomUUID()}`,
        titulo: "Publicación A sin SKU",
        precio: "10000",
        stock: 5,
      })
    );
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(publicaciones).values({
        empresaId: empresaAId,
        cuentaMlId: cuentaA.id,
        publicacionIdExterno: `MCO-A-CONSKU-${randomUUID()}`,
        titulo: "Publicación A con SKU",
        precio: "20000",
        stock: 3,
        skuId: skuA.id,
      })
    );

    // Empresa B: un solo pedido este mes, con un monto bien distinto
    // (999999) para que un error de aislamiento (mezclar A y B) se note
    // de inmediato en el total.
    const [pedidoB1] = await dbComoEmpresa(empresaBId, (tx) =>
      tx
        .insert(pedidos)
        .values({ empresaId: empresaBId, cuentaMlId: cuentaB.id, pedidoIdExterno: `ORD-B1-${randomUUID()}`, fecha: AHORA, total: "999999", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(despachosMl).values({
        empresaId: empresaBId,
        pedidoId: pedidoB1.id,
        cuentaMlId: cuentaB.id,
        shipmentIdExterno: `SHIP-B1-${randomUUID()}`,
        status: "ready_to_ship",
        imprimible: true,
      })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(publicaciones).values({
        empresaId: empresaBId,
        cuentaMlId: cuentaB.id,
        publicacionIdExterno: `MCO-B-SINSKU-${randomUUID()}`,
        titulo: "Publicación B sin SKU",
        precio: "30000",
        stock: 1,
      })
    );
  });

  const ventasA = [
    { moneda: "COP", total: "150000.00" },
    { moneda: "USD", total: "500000.00" },
  ];

  it("calcularVentasDelMes suma en Postgres, por moneda, solo los pedidos de este mes de esa empresa", async () => {
    expect(await calcularVentasDelMes(empresaAId, AHORA)).toEqual(ventasA);
  });

  it("contarPedidos cuenta TODO el histórico, incluido el pedido del mes pasado", async () => {
    const totalA = await contarPedidos(empresaAId);
    expect(totalA).toBe(4);
  });

  it("contarDespachosPendientes solo cuenta lo imprimible sin etiqueta impresa", async () => {
    const pendientesA = await contarDespachosPendientes(empresaAId);
    expect(pendientesA).toBe(1);
  });

  it("contarSkuSinVincular solo cuenta publicaciones sin SKU enlazado", async () => {
    const sinVincularA = await contarSkuSinVincular(empresaAId);
    expect(sinVincularA).toBe(1);
  });

  it("aislamiento A/B: la empresa A nunca ve ni mezcla los números de la empresa B, ni al revés", async () => {
    const [ventasDeA, ventasDeB] = await Promise.all([
      calcularVentasDelMes(empresaAId, AHORA),
      calcularVentasDelMes(empresaBId, AHORA),
    ]);
    expect(ventasDeA).toEqual(ventasA);
    expect(ventasDeB).toEqual([{ moneda: "COP", total: "999999.00" }]);

    const [pedidosA, pedidosB] = await Promise.all([contarPedidos(empresaAId), contarPedidos(empresaBId)]);
    expect(pedidosA).toBe(4);
    expect(pedidosB).toBe(1);

    const [despachosA, despachosB] = await Promise.all([contarDespachosPendientes(empresaAId), contarDespachosPendientes(empresaBId)]);
    expect(despachosA).toBe(1);
    expect(despachosB).toBe(1);

    const [skuDeA, skuDeB] = await Promise.all([contarSkuSinVincular(empresaAId), contarSkuSinVincular(empresaBId)]);
    expect(skuDeA).toBe(1);
    expect(skuDeB).toBe(1);
  });

  it("RLS: un select de pedidos sin WHERE, con la empresa A activa, no devuelve filas de la empresa B", async () => {
    const filas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(pedidos));
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.some((fila) => fila.empresaId === empresaBId)).toBe(false);
  });

  it("empresa sin ningún pedido todavía: Ventas del mes es lista vacía (nunca un número inventado) y los conteos son 0", async () => {
    const empresaVaciaId = randomUUID();
    await dbComoEmpresa(empresaVaciaId, (tx) =>
      tx.insert(empresas).values({ id: empresaVaciaId, nombre: "Empresa vacía KPIs", nit: `TEST-KPIV-${empresaVaciaId.slice(0, 8)}` })
    );
    expect(await calcularVentasDelMes(empresaVaciaId, AHORA)).toEqual([]);
    expect(await contarPedidos(empresaVaciaId)).toBe(0);
    expect(await contarDespachosPendientes(empresaVaciaId)).toBe(0);
    expect(await contarSkuSinVincular(empresaVaciaId)).toBe(0);
  });

  it("un pedido a las 20:00 de Bogotá del último día del mes cuenta en ese mes", async () => {
    // 2026-04-01 01:00 UTC = 2026-03-31 20:00 America/Bogota (UTC-5,
    // sin horario de verano). El mes de calendario en Colombia sigue
    // siendo marzo; en UTC ya es 1 de abril.
    const enElBorde = new Date("2026-04-01T01:00:00.000Z");
    const empresaId = randomUUID();
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa borde mes", nit: `TEST-KPIE-${empresaId.slice(0, 8)}` })
    );
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: `ml-user-kpie-${randomUUID()}`,
          nickname: "VENDEDOR_KPI_BORDE",
          accessTokenCifrado: cifrarToken("access-borde"),
          refreshTokenCifrado: cifrarToken("refresh-borde"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(pedidos).values({
        empresaId,
        cuentaMlId: cuenta.id,
        pedidoIdExterno: `ORD-BORDE-${randomUUID()}`,
        fecha: enElBorde,
        total: "12345.67",
        moneda: "COP",
        estado: "paid",
      })
    );

    expect(await calcularVentasDelMes(empresaId, enElBorde)).toEqual([{ moneda: "COP", total: "12345.67" }]);
    // 2026-04-01 05:00 UTC = 2026-04-01 00:00 Bogotá: fin exclusivo de
    // marzo. El mismo pedido ya no entra.
    expect(await calcularVentasDelMes(empresaId, new Date("2026-04-01T05:00:00.000Z"))).toEqual([]);
  });

  it("un rol sin ventas ni inventario recibe todos los KPIs en null aunque la empresa tenga datos", async () => {
    const usuarioId = await membresiaCon(empresaAId, "Solo finanzas KPIs", [{ modulo: "finanzas", accion: "consultar" }]);
    expect(await obtenerKpisPanel(usuarioId, empresaAId, AHORA)).toEqual({
      ventasDeHoy: null,
      ventasDelMes: null,
      pedidos: null,
      despachosPendientes: null,
      skuSinVincular: null,
    });
  });

  it("un rol con ventas e inventario ve los KPIs; uno solo con ventas no ve el de SKU", async () => {
    const conAmbos = await membresiaCon(empresaAId, "Ventas e inventario KPIs", [
      { modulo: "ventas", accion: "consultar" },
      { modulo: "inventario", accion: "consultar" },
    ]);
    // Los tres pedidos de A con fecha AHORA son de hoy (15 de junio en
    // Bogotá) y no cancelados: Ventas de hoy los cuenta igual que el mes.
    expect(await obtenerKpisPanel(conAmbos, empresaAId, AHORA)).toEqual({
      ventasDeHoy: { cantidad: 3, montos: ventasA, porCuenta: [{ nickname: "VENDEDOR_KPI_A", cantidad: 3 }] },
      ventasDelMes: ventasA,
      pedidos: 4,
      despachosPendientes: 1,
      skuSinVincular: 1,
    });

    const soloVentas = await membresiaCon(empresaAId, "Solo ventas KPIs", [{ modulo: "ventas", accion: "consultar" }]);
    expect(await obtenerKpisPanel(soloVentas, empresaAId, AHORA)).toEqual({
      ventasDeHoy: { cantidad: 3, montos: ventasA, porCuenta: [{ nickname: "VENDEDOR_KPI_A", cantidad: 3 }] },
      ventasDelMes: ventasA,
      pedidos: 4,
      despachosPendientes: 1,
      skuSinVincular: null,
    });
  });

  it("un error que no es falta de permiso se propaga", async () => {
    await expect(obtenerKpisPanel(randomUUID(), "no-es-uuid", AHORA)).rejects.toThrow(/empresaId inválido/);
  });
});

describe("formatearVentasDelMes", () => {
  it("lista cada moneda y, sin ventas, muestra COP 0", () => {
    expect(
      formatearVentasDelMes([
        { moneda: "COP", total: "1234000" },
        { moneda: "USD", total: "50" },
      ])
    ).toBe("COP 1.234.000 · USD 50");
    expect(formatearVentasDelMes([])).toBe("COP 0");
    expect(formatearVentasDelMes([{ moneda: "COP", total: "150000.00" }])).toBe("COP 150.000");
    expect(formatearVentasDelMes([{ moneda: "COP", total: "12345.67" }])).toBe("COP 12.345,67");
  });
});

// "Ventas de hoy" (issue #153) — su propio par de empresas, con un
// `ahora` fijo (20 de julio 2026, 12:00 en Bogotá) que no se cruza con
// el AHORA de arriba: así los pedidos de borde de este bloque (ayer a
// las 23:59, mañana a las 00:00) no tocan las cifras del mes.
const HOY = new Date("2026-07-20T17:00:00.000Z");

describe("Ventas de hoy (empresa_id, aislamiento A/B)", () => {
  vi.setConfig({ testTimeout: 15_000 });

  const empresaAId = randomUUID();
  const empresaBId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A hoy", nit: `TEST-HOYA-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B hoy", nit: `TEST-HOYB-${empresaBId.slice(0, 8)}` })
    );
    const cuentaA1 = await crearCuenta(empresaAId, "HOY_A_1");
    const cuentaA2 = await crearCuenta(empresaAId, "HOY_A_2");
    const cuentaB = await crearCuenta(empresaBId, "HOY_B");

    // Empresa A, cuenta 1: hoy a las 00:00 de Bogotá (05:00 UTC, el
    // primer instante del día), uno confirmed y uno USD a mediodía — 3
    // ventas. Cancelled e invalid hoy, con montos enormes para que se
    // noten si se cuelan. Ayer a las 23:59 de Bogotá y mañana a las
    // 00:00 (fin exclusivo): afuera.
    await insertarPedido(empresaAId, cuentaA1, "2026-07-20T05:00:00.000Z", "10000", "COP", "paid");
    await insertarPedido(empresaAId, cuentaA1, "2026-07-20T17:00:00.000Z", "2500.50", "COP", "confirmed");
    await insertarPedido(empresaAId, cuentaA1, "2026-07-20T17:00:00.000Z", "20", "USD", "payment_required");
    await insertarPedido(empresaAId, cuentaA1, "2026-07-20T17:00:00.000Z", "1000000", "COP", "cancelled");
    await insertarPedido(empresaAId, cuentaA1, "2026-07-20T17:00:00.000Z", "2000000", "COP", "invalid");
    await insertarPedido(empresaAId, cuentaA1, "2026-07-20T04:59:00.000Z", "3000000", "COP", "paid");
    await insertarPedido(empresaAId, cuentaA1, "2026-07-21T05:00:00.000Z", "4000000", "COP", "paid");
    // Empresa A, cuenta 2: una venta hoy.
    await insertarPedido(empresaAId, cuentaA2, "2026-07-20T22:00:00.000Z", "7000", "COP", "payment_in_process");
    // Empresa B: una venta hoy, con un monto que se nota si se mezcla.
    await insertarPedido(empresaBId, cuentaB, "2026-07-20T17:00:00.000Z", "999999", "COP", "paid");
  });

  const ventasDeHoyA = {
    cantidad: 4,
    montos: [
      { moneda: "COP", total: "19500.50" },
      { moneda: "USD", total: "20.00" },
    ],
    porCuenta: [
      { nickname: "HOY_A_1", cantidad: 3 },
      { nickname: "HOY_A_2", cantidad: 1 },
    ],
  };

  it("cuenta las ventas del día de Bogotá de todas las cuentas, sin cancelled ni invalid, ni ayer 23:59 ni mañana 00:00", async () => {
    expect(await calcularVentasDeHoy(empresaAId, HOY)).toEqual(ventasDeHoyA);
  });

  it("el monto llega como string, nunca como Number", async () => {
    const { montos } = await calcularVentasDeHoy(empresaAId, HOY);
    for (const grupo of montos) expect(typeof grupo.total).toBe("string");
    expect(montos[0].total).toBe("19500.50");
  });

  it("el conteo por cuenta suma el total", async () => {
    const ventas = await calcularVentasDeHoy(empresaAId, HOY);
    expect(ventas.porCuenta.reduce((total, cuenta) => total + cuenta.cantidad, 0)).toBe(ventas.cantidad);
  });

  it("aislamiento A/B: la empresa A no ve los pedidos de la B, ni al revés", async () => {
    const [deA, deB] = await Promise.all([calcularVentasDeHoy(empresaAId, HOY), calcularVentasDeHoy(empresaBId, HOY)]);
    expect(deA).toEqual(ventasDeHoyA);
    expect(deB).toEqual({
      cantidad: 1,
      montos: [{ moneda: "COP", total: "999999.00" }],
      porCuenta: [{ nickname: "HOY_B", cantidad: 1 }],
    });
  });

  it("el pedido de ayer a las 23:59 de Bogotá cuenta en su propio día, y el de mañana a las 00:00 en el suyo", async () => {
    expect((await calcularVentasDeHoy(empresaAId, new Date("2026-07-20T04:59:00.000Z"))).montos).toEqual([
      { moneda: "COP", total: "3000000.00" },
    ]);
    expect((await calcularVentasDeHoy(empresaAId, new Date("2026-07-21T05:00:00.000Z"))).montos).toEqual([
      { moneda: "COP", total: "4000000.00" },
    ]);
  });

  it("sin ventas hoy: 0, sin montos ni cuentas, y la tarjeta dice COP 0", async () => {
    const vacia = await calcularVentasDeHoy(empresaAId, new Date("2026-07-25T17:00:00.000Z"));
    expect(vacia).toEqual({ cantidad: 0, montos: [], porCuenta: [] });
    expect(detalleVentasDeHoy(vacia)).toEqual(["COP 0"]);
  });

  it("obtenerKpisPanel la incluye con ventas/consultar y la deja en null sin ese permiso", async () => {
    const conVentas = await membresiaCon(empresaAId, "Ventas hoy KPIs", [{ modulo: "ventas", accion: "consultar" }]);
    expect((await obtenerKpisPanel(conVentas, empresaAId, HOY)).ventasDeHoy).toEqual(ventasDeHoyA);

    const sinVentas = await membresiaCon(empresaAId, "Sin ventas hoy KPIs", [{ modulo: "inventario", accion: "consultar" }]);
    expect((await obtenerKpisPanel(sinVentas, empresaAId, HOY)).ventasDeHoy).toBeNull();
  });
});

describe("detalleVentasDeHoy", () => {
  it("monto por moneda y, solo con más de una cuenta, el conteo por cuenta", () => {
    expect(
      detalleVentasDeHoy({
        cantidad: 4,
        montos: [
          { moneda: "COP", total: "19500.50" },
          { moneda: "USD", total: "20.00" },
        ],
        porCuenta: [
          { nickname: "HOY_A_1", cantidad: 3 },
          { nickname: "HOY_A_2", cantidad: 1 },
        ],
      })
    ).toEqual(["COP 19.500,5 · USD 20", "HOY_A_1: 3 · HOY_A_2: 1"]);
    expect(
      detalleVentasDeHoy({ cantidad: 2, montos: [{ moneda: "COP", total: "150000.00" }], porCuenta: [{ nickname: "UNA", cantidad: 2 }] })
    ).toEqual(["COP 150.000"]);
  });
});

async function crearCuenta(empresaId: string, nickname: string): Promise<string> {
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: `ml-user-hoy-${randomUUID()}`,
        nickname,
        accessTokenCifrado: cifrarToken("access-hoy"),
        refreshTokenCifrado: cifrarToken("refresh-hoy"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
      .returning({ id: cuentasMl.id })
  );
  return cuenta.id;
}

async function insertarPedido(empresaId: string, cuentaMlId: string, fecha: string, total: string, moneda: string, estado: string) {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.insert(pedidos).values({
      empresaId,
      cuentaMlId,
      pedidoIdExterno: `ORD-HOY-${randomUUID()}`,
      fecha: new Date(fecha),
      total,
      moneda,
      estado,
    })
  );
}

async function membresiaCon(
  empresaId: string,
  nombreRol: string,
  permisos: { modulo: "ventas" | "inventario" | "finanzas"; accion: "consultar" }[]
): Promise<string> {
  const usuarioId = randomUUID();
  const rolId = randomUUID();
  await db.insert(usuarios).values({
    id: usuarioId,
    email: `kpi-${usuarioId.slice(0, 8)}@zilonix.test`,
    nombre: nombreRol,
  });
  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.insert(roles).values({ id: rolId, nombre: nombreRol, empresaId });
    if (permisos.length > 0) {
      await tx.insert(permisosRol).values(
        permisos.map((permiso) => ({
          id: randomUUID(),
          rolId,
          modulo: permiso.modulo,
          accion: permiso.accion,
          alcance: "todo" as const,
        }))
      );
    }
    await tx.insert(membresias).values({ id: randomUUID(), usuarioId, empresaId, rolId });
  });
  return usuarioId;
}
