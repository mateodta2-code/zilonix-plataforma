import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl, empresas, pedidos, publicaciones, skus } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { calcularVentasDelMes, contarDespachosPendientes, contarPedidos, contarSkuSinVincular } from "./panel-kpis";

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

    const ahora = new Date();
    // Mismo día del mes anterior — el constructor de Date normaliza
    // solo el rollunder de año cuando el mes actual es enero (mes -1),
    // así que es seguro sin importar en qué mes se corra la prueba.
    const mesAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 15);

    // Empresa A: dos pedidos de este mes (100000 + 50000 = 150000) y uno
    // del mes pasado (999999, para probar que "Ventas del mes" lo deja
    // afuera pero "Pedidos" sí lo cuenta).
    const [pedidoA1] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values({ empresaId: empresaAId, cuentaMlId: cuentaA.id, pedidoIdExterno: `ORD-A1-${randomUUID()}`, fecha: ahora, total: "100000", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id })
    );
    const [pedidoA2] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values({ empresaId: empresaAId, cuentaMlId: cuentaA.id, pedidoIdExterno: `ORD-A2-${randomUUID()}`, fecha: ahora, total: "50000", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id })
    );
    const [pedidoA3] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values({ empresaId: empresaAId, cuentaMlId: cuentaA.id, pedidoIdExterno: `ORD-A3-${randomUUID()}`, fecha: mesAnterior, total: "999999", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id })
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
        .values({ empresaId: empresaBId, cuentaMlId: cuentaB.id, pedidoIdExterno: `ORD-B1-${randomUUID()}`, fecha: ahora, total: "999999", moneda: "COP", estado: "paid" })
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

  it("calcularVentasDelMes suma solo los pedidos de este mes de esa empresa", async () => {
    const ventasA = await calcularVentasDelMes(empresaAId);
    expect(ventasA).toEqual({ moneda: "COP", total: 150000 });
  });

  it("contarPedidos cuenta TODO el histórico, incluido el pedido del mes pasado", async () => {
    const totalA = await contarPedidos(empresaAId);
    expect(totalA).toBe(3);
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
    const [ventasA, ventasB] = await Promise.all([calcularVentasDelMes(empresaAId), calcularVentasDelMes(empresaBId)]);
    expect(ventasA).toEqual({ moneda: "COP", total: 150000 });
    expect(ventasB).toEqual({ moneda: "COP", total: 999999 });

    const [pedidosA, pedidosB] = await Promise.all([contarPedidos(empresaAId), contarPedidos(empresaBId)]);
    expect(pedidosA).toBe(3);
    expect(pedidosB).toBe(1);

    const [despachosA, despachosB] = await Promise.all([contarDespachosPendientes(empresaAId), contarDespachosPendientes(empresaBId)]);
    expect(despachosA).toBe(1);
    expect(despachosB).toBe(1);

    const [skuA, skuB] = await Promise.all([contarSkuSinVincular(empresaAId), contarSkuSinVincular(empresaBId)]);
    expect(skuA).toBe(1);
    expect(skuB).toBe(1);
  });

  it("empresa sin ningún pedido todavía: Ventas del mes es null (nunca un número inventado)", async () => {
    const empresaVaciaId = randomUUID();
    await dbComoEmpresa(empresaVaciaId, (tx) =>
      tx.insert(empresas).values({ id: empresaVaciaId, nombre: "Empresa vacía KPIs", nit: `TEST-KPIV-${empresaVaciaId.slice(0, 8)}` })
    );
    expect(await calcularVentasDelMes(empresaVaciaId)).toBeNull();
    expect(await contarPedidos(empresaVaciaId)).toBe(0);
    expect(await contarDespachosPendientes(empresaVaciaId)).toBe(0);
    expect(await contarSkuSinVincular(empresaVaciaId)).toBe(0);
  });
});
