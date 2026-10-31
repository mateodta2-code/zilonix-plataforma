import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { db } from "@/db";
import { crearCuentaMlDePrueba, crearPedidoDePrueba, crearVentaDePrueba, lineaDePrueba } from "@/db/test-utils/venta";
import { bodegas, cuentasMl, despachosMl, empresas, pedidoItems, pedidos, pedidosFinanzas, skus, stockBodega, usuarios } from "@/db/schema";
import { crearBodega } from "@/lib/inventario/bodegas";
import { cifrarToken } from "@/lib/cifrado";
import { LARGO_MAXIMO_BUSQUEDA, normalizarParametro, PAGINA_MAXIMA } from "@/lib/filtros-listado";
import {
  agruparDespachosPorDia,
  contarDespachosPendientes,
  deshacerDespachado,
  DespachoNoEncontradoError,
  esFlex,
  esPlazoVencido,
  estadoPlazo,
  etiquetaDiaVenta,
  etiquetaEstadoEnvio,
  EtiquetaNoImprimibleError,
  formatoPlazoChip,
  GuiaNoVistaError,
  listarCuentasConErrorDespacho,
  listarDespachosFiltrados,
  listarDespachosPendientes,
  listarTarjetasDespacho,
  marcarDespachado,
  marcarEtiquetasImpresas,
  marcarGuiaVista,
  obtenerEtiquetasPdf,
  puedeMarcarDespachado,
  sincronizarDespacho,
  VentanaDeshacerVencidaError,
  VENTANA_DESHACER_MS,
  type TarjetaDespacho,
} from "./despachos";

function respuestaJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}
function respuestaErrorPdf(cause: string) {
  return { ok: false, status: 400, text: async () => JSON.stringify({ failed_shipments: [{ cause }] }) } as Response;
}

// Tarea 2.10 — prueba real contra Postgres: la regla de "imprimible" es
// la misma ya confirmada en el sistema actual (status/substatus, Full
// nunca), y la impresión masiva pide varios shipment_ids de una vez.
describe("despachos (tarea 2.10)", () => {
  vi.setConfig({ testTimeout: 15_000 });

  const empresaId = randomUUID();
  const empresaBId = randomUUID();
  const cuentaExterna = `ml-user-desp-${randomUUID()}`;
  let cuentaId: string;
  let pedidoId: string;

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa despachos (prueba 2.10)", nit: `TEST-DESP-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B despachos (prueba 2.10)", nit: `TEST-DESPB-${empresaBId.slice(0, 8)}` })
    );
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: cuentaExterna,
          nickname: "VENDEDOR_DESP",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaId = cuenta.id;
    const [pedido] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(pedidos)
        .values({ empresaId, cuentaMlId: cuentaId, pedidoIdExterno: `ORD-${randomUUID()}`, fecha: new Date(), total: "10000", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id })
    );
    pedidoId = pedido.id;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("un envío en ready_to_ship (self_service/Flex) queda imprimible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "ready_to_ship", substatus: null, logistic_type: "self_service" })));
    await sincronizarDespacho(empresaId, cuentaId, pedidoId, "111");
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.shipmentIdExterno, "111")));
    expect(fila.imprimible).toBe(true);
    expect(fila.logisticType).toBe("self_service");
  });

  it("un envío ya recogido (substatus picked_up) deja de ser imprimible aunque el status siga ready_to_ship", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "ready_to_ship", substatus: "picked_up", logistic_type: "self_service" })));
    await sincronizarDespacho(empresaId, cuentaId, pedidoId, "222");
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.shipmentIdExterno, "222")));
    expect(fila.imprimible).toBe(false);
  });

  it("un envío Full (fulfillment) nunca queda imprimible, sin importar el status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "pending", substatus: null, logistic_type: "fulfillment" })));
    await sincronizarDespacho(empresaId, cuentaId, pedidoId, "333");
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.shipmentIdExterno, "333")));
    expect(fila.imprimible).toBe(false);
    expect(fila.logisticType).toBe("fulfillment");
  });

  it("un envío shipped ya no es imprimible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "shipped", substatus: null, logistic_type: "cross_docking" })));
    await sincronizarDespacho(empresaId, cuentaId, pedidoId, "444");
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.shipmentIdExterno, "444")));
    expect(fila.imprimible).toBe(false);
  });

  it("listarDespachosPendientes solo trae lo imprimible y sin etiqueta impresa", async () => {
    const lista = await listarDespachosPendientes(empresaId);
    const ids = lista.map((d) => d.shipmentIdExterno);
    expect(ids).toContain("111");
    expect(ids).not.toContain("222");
    expect(ids).not.toContain("333");
    expect(ids).not.toContain("444");
  });

  it("empresa B nunca ve los despachos de empresa A", async () => {
    const lista = await listarDespachosPendientes(empresaBId);
    expect(lista).toHaveLength(0);
  });

  it("contarDespachosPendientes() da el mismo número que listarDespachosPendientes(...).length", async () => {
    const [lista, total] = await Promise.all([listarDespachosPendientes(empresaId), contarDespachosPendientes(empresaId)]);
    expect(total).toBe(lista.length);
  });

  it("imprimir varios shipment_ids de una sola vez (impresión masiva) y marca cada uno como impreso", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("shipment_ids=111");
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const pdf = await obtenerEtiquetasPdf(empresaId, cuentaId, ["111"]);
    expect(pdf.byteLength).toBe(8);

    await marcarEtiquetasImpresas(empresaId, cuentaId, ["111"]);
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.shipmentIdExterno, "111")));
    expect(fila.etiquetaImpresaTs).not.toBeNull();

    const pendientes = await listarDespachosPendientes(empresaId);
    expect(pendientes.map((d) => d.shipmentIdExterno)).not.toContain("111"); // ya no aparece, tiene etiqueta impresa
  });

  it("si Mercado Libre bloquea la impresión (ya recogido), se ve el error real explicado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaErrorPdf("NOT_PRINTABLE_STATUS")));
    await expect(obtenerEtiquetasPdf(empresaId, cuentaId, ["222"])).rejects.toThrow(EtiquetaNoImprimibleError);
  });
});

// Issue "tabla completa de despachos" — prueba real contra Postgres de
// búsqueda, filtro por estado/fecha, orden, paginación (incluido el
// desempate por id y el tope de página clamp al total real) y el
// conteo, todo en listarDespachosFiltrados()/contarDespachosPendientes().
// 34 despachos pendientes insertados directo (sin pasar por
// sincronizarDespacho, que no deja fijar actualizado_ts a mano): 30
// con un día distinto cada uno (i=0..29, 1 a 30 de enero de 2026), 2
// con el EXACTO mismo actualizado_ts que el más nuevo (para probar que
// el desempate por id no pierde ni duplica filas entre páginas) y 2 en
// el borde exacto de medianoche en Bogotá (para probar que "hasta" es
// un límite exclusivo, no 23:59:59.999).
describe("listarDespachosFiltrados / contarDespachosPendientes — búsqueda, filtro, orden, paginación", () => {
  vi.setConfig({ testTimeout: 20_000 });

  const empresaId = randomUUID();
  const empresaBId = randomUUID();
  const TOTAL_BASE = 30;
  const TOTAL_DESPACHOS = TOTAL_BASE + 2 + 2; // + empate + borde de medianoche

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa filtros despachos", nit: `TEST-DESPF-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B filtros despachos", nit: `TEST-DESPFB-${empresaBId.slice(0, 8)}` })
    );

    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: `ml-user-despf-${randomUUID()}`,
          nickname: "VENDEDOR_DESPF",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const [cuentaB] = await dbComoEmpresa(empresaBId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaBId,
          cuentaIdExterna: `ml-user-despfb-${randomUUID()}`,
          nickname: "VENDEDOR_DESPFB",
          accessTokenCifrado: cifrarToken("access-b"),
          refreshTokenCifrado: cifrarToken("refresh-b"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );

    // despachos_ml.pedido_id es NOT NULL pero sin restricción de
    // unicidad — un solo pedido de relleno por empresa alcanza para
    // los 34/1 despachos de esta prueba.
    const [pedido] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(pedidos)
        .values({ empresaId, cuentaMlId: cuenta.id, pedidoIdExterno: `ORD-DESPF-${randomUUID()}`, fecha: new Date(), total: "10000", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id })
    );
    const [pedidoB] = await dbComoEmpresa(empresaBId, (tx) =>
      tx
        .insert(pedidos)
        .values({
          empresaId: empresaBId,
          cuentaMlId: cuentaB.id,
          pedidoIdExterno: `ORD-DESPFB-${randomUUID()}`,
          fecha: new Date(),
          total: "10000",
          moneda: "COP",
          estado: "paid",
        })
        .returning({ id: pedidos.id })
    );

    // i=0..29: actualizado_ts = 1..30 de enero de 2026 (sube con i).
    // i=15 tiene un shipmentIdExterno único para la búsqueda; i=20
    // tiene un status único ("handling") para el filtro de estado — el
    // resto queda en "pending".
    const filasBase = Array.from({ length: TOTAL_BASE }, (_, i) => ({
      empresaId,
      pedidoId: pedido.id,
      cuentaMlId: cuenta.id,
      shipmentIdExterno: i === 15 ? "BUSCAME-ESPECIAL" : `DESP-${i}`,
      logisticType: "self_service" as const,
      status: i === 20 ? "handling" : "pending",
      imprimible: true,
      actualizadoTs: new Date(Date.UTC(2026, 0, i + 1, 12, 0, 0)),
    }));

    // Empate a propósito: mismo actualizado_ts que i=29 (el más nuevo)
    // — sin el desempate por id, Postgres podría repartir estas 2 filas
    // entre la página 1 y la 2 de forma inconsistente entre una
    // corrida y otra.
    const filasEmpate = [
      { shipmentIdExterno: "TIE-30" },
      { shipmentIdExterno: "TIE-31" },
    ].map((f) => ({
      empresaId,
      pedidoId: pedido.id,
      cuentaMlId: cuenta.id,
      shipmentIdExterno: f.shipmentIdExterno,
      logisticType: "self_service" as const,
      status: "pending",
      imprimible: true,
      actualizadoTs: new Date(Date.UTC(2026, 0, 30, 12, 0, 0)), // mismo instante que i=29
    }));

    // Borde exacto de "hasta" (filtro desde=hasta="2026-01-10"): A cae
    // 1ms ANTES de la medianoche de Bogotá del día siguiente (sí debe
    // aparecer), B cae EXACTO en esa medianoche (no debe aparecer —
    // "hasta" es un límite exclusivo).
    const filasBorde = [
      { shipmentIdExterno: "BORDE-A", actualizadoTs: new Date("2026-01-11T04:59:59.999Z") },
      { shipmentIdExterno: "BORDE-B", actualizadoTs: new Date("2026-01-11T05:00:00.000Z") },
    ].map((f) => ({
      empresaId,
      pedidoId: pedido.id,
      cuentaMlId: cuenta.id,
      shipmentIdExterno: f.shipmentIdExterno,
      logisticType: "self_service" as const,
      status: "pending",
      imprimible: true,
      actualizadoTs: f.actualizadoTs,
    }));

    await dbComoEmpresa(empresaId, (tx) => tx.insert(despachosMl).values([...filasBase, ...filasEmpate, ...filasBorde]));

    // Empresa B: un despacho con el MISMO shipmentIdExterno que el de A
    // ("BUSCAME-ESPECIAL") — la prueba de aislamiento confirma que
    // buscar ese texto bajo el contexto de A nunca trae el de B.
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(despachosMl).values({
        empresaId: empresaBId,
        pedidoId: pedidoB.id,
        cuentaMlId: cuentaB.id,
        shipmentIdExterno: "BUSCAME-ESPECIAL",
        logisticType: "self_service",
        status: "pending",
        imprimible: true,
        actualizadoTs: new Date("2026-02-01T12:00:00.000Z"),
      })
    );
  });

  it("sin filtros: trae la primera página (25) ordenada por actualizado_ts descendente por defecto", async () => {
    const resultado = await listarDespachosFiltrados(empresaId);
    expect(resultado.total).toBe(TOTAL_DESPACHOS);
    expect(resultado.totalPaginas).toBe(2);
    expect(resultado.pagina).toBe(1);
    expect(resultado.despachos).toHaveLength(25);
  });

  it("página 2 trae el resto, sin perder ni duplicar las filas empatadas (desempate por id)", async () => {
    const [p1, p2] = await Promise.all([listarDespachosFiltrados(empresaId, { pagina: 1 }), listarDespachosFiltrados(empresaId, { pagina: 2 })]);
    expect(p2.despachos).toHaveLength(TOTAL_DESPACHOS - 25);

    const idsP1 = p1.despachos.map((d) => d.id);
    const idsP2 = p2.despachos.map((d) => d.id);
    expect(new Set([...idsP1, ...idsP2]).size).toBe(TOTAL_DESPACHOS); // ninguno se repite
    expect(idsP1.filter((id) => idsP2.includes(id))).toHaveLength(0); // ninguno falta ni se duplica
  });

  it(`página fuera de [1, ${PAGINA_MAXIMA}] (0, negativa, decimal, > ${PAGINA_MAXIMA}) se trata como 1`, async () => {
    for (const paginaInvalida of [0, -5, 1.5, PAGINA_MAXIMA + 1]) {
      const resultado = await listarDespachosFiltrados(empresaId, { pagina: paginaInvalida });
      expect(resultado.pagina).toBe(1);
    }
  });

  it("1e20 no es un entero seguro: vuelve a la página 1, sin tirar", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { pagina: 1e20 });
    expect(resultado.pagina).toBe(1);
  });

  it(`una página dentro de [1, ${PAGINA_MAXIMA}] pero mayor que el total real se recorta al total de páginas (nunca una página vacía)`, async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { pagina: 9999 });
    expect(resultado.pagina).toBe(resultado.totalPaginas);
    expect(resultado.despachos.length).toBeGreaterThan(0);
  });

  it("búsqueda por número de envío usa ilike (parcial, sin importar mayúsculas)", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { busqueda: "buscame" });
    expect(resultado.total).toBe(1);
    expect(resultado.despachos[0].shipmentIdExterno).toBe("BUSCAME-ESPECIAL");
  });

  it("un % suelto no es un comodín: no matchea ningún envío", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { busqueda: "%" });
    expect(resultado.total).toBe(0);
  });

  it("un _ suelto no es un comodín de un solo carácter: 'DESP_1' no encuentra 'DESP-1'", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { busqueda: "DESP_1" });
    expect(resultado.total).toBe(0);
  });

  it(`una búsqueda de 5000 caracteres se recorta a ${LARGO_MAXIMO_BUSQUEDA} y no revienta`, async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { busqueda: "a".repeat(5000) });
    expect(resultado.total).toBe(0);
  });

  it("un parámetro repetido en la URL (?q=a&q=b, arreglo) nunca revienta: se normaliza al primer valor antes de filtrar", async () => {
    // Simula lo que hace app/panel/despachos/page.tsx con searchParams
    // cuando Next entrega string[] — normalizarParametro() se queda con
    // el primer valor antes de que llegue a listarDespachosFiltrados,
    // que solo acepta string | undefined.
    const valorCrudo = ["BUSCAME-ESPECIAL", "otro-valor-que-nunca-se-usa"];
    const resultado = await listarDespachosFiltrados(empresaId, { busqueda: normalizarParametro(valorCrudo) });
    expect(resultado.total).toBe(1);
    expect(resultado.despachos[0].shipmentIdExterno).toBe("BUSCAME-ESPECIAL");
  });

  it("filtro por estado de la lista permitida", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { estado: "handling" });
    expect(resultado.total).toBe(1);
    expect(resultado.despachos[0].status).toBe("handling");
  });

  it("un ?estado= fuera de la lista permitida se ignora (nunca un error, nunca 0 resultados por un valor raro)", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { estado: "estado-que-no-existe" });
    expect(resultado.total).toBe(TOTAL_DESPACHOS);
  });

  it("un ?orden= fuera de la lista permitida se ignora y usa actualizado_desc por defecto", async () => {
    const [sinOrden, ordenInvalido] = await Promise.all([
      listarDespachosFiltrados(empresaId),
      listarDespachosFiltrados(empresaId, { orden: "orden-que-no-existe" }),
    ]);
    expect(ordenInvalido.despachos.map((d) => d.id)).toEqual(sinOrden.despachos.map((d) => d.id));
  });

  it("orden=actualizado_asc trae primero el despacho más viejo", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { orden: "actualizado_asc" });
    expect(resultado.despachos[0].shipmentIdExterno).toBe("DESP-0");
  });

  it("fecha con formato inválido o que no existe en el calendario (30 de febrero) se ignora", async () => {
    for (const fechaInvalida of ["2026-02-30", "30-01-2026", "2026/01/30", "no-es-una-fecha"]) {
      const resultado = await listarDespachosFiltrados(empresaId, { desde: fechaInvalida });
      expect(resultado.total).toBe(TOTAL_DESPACHOS);
    }
  });

  it("rango de fechas (desde/hasta, hora de Colombia) solo trae los despachos de ese día completo en Bogotá", async () => {
    // El día de Bogotá del 10 de enero va de 05:00Z del 10 (inclusive) a
    // 05:00Z del 11 (exclusivo) — entran DESP-9 (mediodía UTC del 10) Y
    // BORDE-A (04:59:59.999Z del 11, todavía antes de esa medianoche de
    // Bogotá), nunca solo el primero.
    const resultado = await listarDespachosFiltrados(empresaId, { desde: "2026-01-10", hasta: "2026-01-10" });
    expect(resultado.total).toBe(2);
    expect(resultado.despachos.map((d) => d.shipmentIdExterno).sort()).toEqual(["BORDE-A", "DESP-9"]);
  });

  it("'hasta' es un límite EXCLUSIVO: incluye hasta 1ms antes de la medianoche de Bogotá del día siguiente, nunca esa medianoche", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { desde: "2026-01-10", hasta: "2026-01-10" });
    const ids = resultado.despachos.map((d) => d.shipmentIdExterno);
    expect(ids).toContain("BORDE-A");
    expect(ids).not.toContain("BORDE-B");
  });

  it("aislamiento A/B: buscar el mismo texto nunca mezcla los despachos de la otra empresa", async () => {
    const [deA, deB] = await Promise.all([
      listarDespachosFiltrados(empresaId, { busqueda: "BUSCAME" }),
      listarDespachosFiltrados(empresaBId, { busqueda: "BUSCAME" }),
    ]);
    expect(deA.total).toBe(1);
    expect(deA.despachos[0].empresaId).toBe(empresaId);
    expect(deB.total).toBe(1);
    expect(deB.despachos[0].empresaId).toBe(empresaBId);
  });

  it("contarDespachosPendientes() da el mismo número que listarDespachosPendientes(...).length con estos mismos datos", async () => {
    const [lista, total] = await Promise.all([listarDespachosPendientes(empresaId), contarDespachosPendientes(empresaId)]);
    expect(total).toBe(lista.length);
    expect(total).toBe(TOTAL_DESPACHOS);
  });

  it("empresa vacía: total 0 y una sola página, nunca un error", async () => {
    const empresaVaciaId = randomUUID();
    await dbComoEmpresa(empresaVaciaId, (tx) =>
      tx.insert(empresas).values({ id: empresaVaciaId, nombre: "Empresa vacía despachos", nit: `TEST-DESPV-${empresaVaciaId.slice(0, 8)}` })
    );
    const resultado = await listarDespachosFiltrados(empresaVaciaId);
    expect(resultado.total).toBe(0);
    expect(resultado.totalPaginas).toBe(1);
    expect(resultado.despachos).toHaveLength(0);
    expect(await contarDespachosPendientes(empresaVaciaId)).toBe(0);
  });
});

function tarjetaDePrueba(id: string, fechaPedido: Date, extra: Partial<TarjetaDespacho> = {}): TarjetaDespacho {
  return {
    id,
    shipmentIdExterno: id,
    logisticType: "self_service",
    status: "ready_to_ship",
    substatus: null,
    slaExpectedDate: null,
    guiaVistaTs: null,
    despachadoTs: null,
    imprimible: true,
    etiquetaImpresaTs: null,
    cuentaMlId: "cuenta-de-prueba",
    cuentaNickname: "VENDEDOR_PRUEBA",
    pedidoIdExterno: "ORD-1",
    fechaPedido,
    actualizadoTs: fechaPedido,
    comprador: null,
    bodegaAsignada: null,
    items: [],
    origenDespacho: null,
    ...extra,
  };
}

// Fase 1-1 de Despachos (rama mateo/feat-despachos-fase1-1) — plazo,
// agrupación por día de VENTA (America/Bogota, corrige la Fase 1 que
// agrupaba por plazo), detección de tipo y traducción de estados:
// funciones puras, sin Postgres.
describe("plazo, agrupación por día de venta, detección de tipo y traducción de estado (Fase 1-1 de Despachos)", () => {
  // 2026-03-10, 10:00 a.m. hora de Bogotá (15:00 UTC) — fijo para que
  // ninguna prueba dependa de en qué momento real se corra.
  const AHORA = new Date("2026-03-10T15:00:00Z");

  it("esFlex: solo self_service es Flex", () => {
    expect(esFlex("self_service")).toBe(true);
    expect(esFlex("xd_drop_off")).toBe(false);
    expect(esFlex("cross_docking")).toBe(false);
    expect(esFlex("fulfillment")).toBe(false);
    expect(esFlex(null)).toBe(false);
  });

  it("esPlazoVencido: sin plazo nunca está vencido; con plazo, vencido es estrictamente antes de 'ahora'", () => {
    expect(esPlazoVencido(null, AHORA)).toBe(false);
    expect(esPlazoVencido(new Date(AHORA.getTime() - 1), AHORA)).toBe(true);
    expect(esPlazoVencido(new Date(AHORA.getTime() + 1), AHORA)).toBe(false);
    expect(esPlazoVencido(AHORA, AHORA)).toBe(false); // el instante exacto todavía no venció
  });

  it("estadoPlazo: null sin plazo; 'vencido' si ya pasó; 'por_vencer' si faltan menos de 2h; 'normal' el resto", () => {
    expect(estadoPlazo(null, AHORA)).toBeNull();
    expect(estadoPlazo(new Date(AHORA.getTime() - 1), AHORA)).toBe("vencido");
    expect(estadoPlazo(new Date(AHORA.getTime() + 60 * 60 * 1000), AHORA)).toBe("por_vencer"); // falta 1h
    expect(estadoPlazo(new Date(AHORA.getTime() + 2 * 60 * 60 * 1000), AHORA)).toBe("normal"); // exacto 2h: ya no es "por vencer"
    expect(estadoPlazo(new Date(AHORA.getTime() + 5 * 60 * 60 * 1000), AHORA)).toBe("normal");
  });

  it("formatoPlazoChip: null sin plazo, texto con '⏰ Plazo:' cuando sí hay", () => {
    expect(formatoPlazoChip(null)).toBeNull();
    const texto = formatoPlazoChip(new Date("2026-03-13T21:00:00Z")); // viernes 4pm Bogotá
    expect(texto).toMatch(/^⏰ Plazo: /);
  });

  it("etiquetaDiaVenta: hoy/ayer/antier en Bogotá, sin importar la hora exacta", () => {
    expect(etiquetaDiaVenta(new Date("2026-03-11T02:00:00Z"), AHORA)).toBe("Hoy"); // 2026-03-10, 9pm Bogotá
    expect(etiquetaDiaVenta(new Date("2026-03-09T18:00:00Z"), AHORA)).toBe("Ayer"); // 2026-03-09, 1pm Bogotá
    expect(etiquetaDiaVenta(new Date("2026-03-08T13:00:00Z"), AHORA)).toBe("Antier"); // 2026-03-08, 8am Bogotá
  });

  it("etiquetaDiaVenta: más de 2 días atrás trae día de la semana + fecha", () => {
    expect(etiquetaDiaVenta(new Date("2026-02-20T15:00:00Z"), AHORA)).toMatch(/^[A-ZÁÉÍÓÚ][a-záéíóúñ]+ 20 de febrero$/);
  });

  it("etiquetaDiaVenta: un borde de 04:59 UTC vs 05:00 UTC cae en días de Bogotá distintos (medianoche de Bogotá = 05:00 UTC)", () => {
    expect(etiquetaDiaVenta(new Date("2026-03-10T04:59:00Z"), AHORA)).toBe("Ayer"); // todavía 2026-03-09 en Bogotá
    expect(etiquetaDiaVenta(new Date("2026-03-10T05:00:00Z"), AHORA)).toBe("Hoy"); // ya 2026-03-10 en Bogotá
  });

  it("agruparDespachosPorDia: agrupa por fecha de VENTA (no por plazo), el día más nuevo primero, lo más nuevo arriba dentro de cada grupo", () => {
    // Ya vienen ordenados por fecha de venta descendente, como los
    // devuelve listarTarjetasDespacho — la prueba respeta ese orden de
    // entrada a propósito (agruparDespachosPorDia no reordena dentro
    // de un grupo, solo junta).
    const grupos = agruparDespachosPorDia(
      [
        tarjetaDePrueba("hoy-2", new Date("2026-03-10T18:00:00Z")), // más nuevo
        tarjetaDePrueba("hoy-1", new Date("2026-03-10T16:00:00Z")),
        tarjetaDePrueba("ayer-1", new Date("2026-03-09T16:00:00Z")),
        tarjetaDePrueba("viejo", new Date("2026-02-20T15:00:00Z")),
      ],
      AHORA
    );
    expect(grupos.map((g) => g.etiqueta)).toEqual(["Hoy (2)", "Ayer", "Viernes 20 de febrero"]);
    expect(grupos[0].despachos.map((d) => d.id)).toEqual(["hoy-2", "hoy-1"]);
  });

  it("agruparDespachosPorDia: una lista vacía da una lista de grupos vacía, nunca truena", () => {
    expect(agruparDespachosPorDia([], AHORA)).toEqual([]);
  });

  it("etiquetaEstadoEnvio: traduce status y substatus reales a español, uniendo los dos con '—'", () => {
    expect(etiquetaEstadoEnvio("ready_to_ship", "ready_to_print")).toBe("Listo para despachar — listo para imprimir la guía");
    expect(etiquetaEstadoEnvio("ready_to_ship", "printed")).toBe("Listo para despachar — guía impresa, todavía no se ha entregado");
    expect(etiquetaEstadoEnvio("delivered", null)).toBe("Entregado");
    expect(etiquetaEstadoEnvio("cancelled", null)).toBe("Cancelado");
  });

  it("etiquetaEstadoEnvio: null sin status; un status/substatus desconocido se muestra tal cual (sin inventar una traducción)", () => {
    expect(etiquetaEstadoEnvio(null, null)).toBeNull();
    expect(etiquetaEstadoEnvio("un_status_nuevo", null)).toBe("un status nuevo");
    expect(etiquetaEstadoEnvio("ready_to_ship", "un_substatus_nuevo")).toBe("Listo para despachar — un substatus nuevo");
  });
});

// Fase 1 de Despachos — gate "guía vista → despachado", deshacer con
// ventana de 10 minutos, y listarTarjetasDespacho (join con
// pedidos/pedido_items/cuentas_ml, exclusión de Full, filtros y
// aislamiento por empresa). Todo contra Postgres real.
describe("tarjetas de Despachos — Fase 1 (gate, marcar/deshacer, listarTarjetasDespacho)", () => {
  vi.setConfig({ testTimeout: 20_000 });

  // El backfill del plazo (punto 1 de la Fase 1-1) llama a Mercado
  // Libre por cualquier ready_to_ship sin slaExpectedDate — FLEX-1 y
  // AGENCIA-1 (abajo) nacen así a propósito. Mock fijo, nunca la red
  // real: una vez el backfill persiste el plazo en la primera
  // llamada, las siguientes ya no lo necesitan (slaExpectedDate deja
  // de ser null). beforeAll (no directo en el describe): tiene que
  // correr en la fase de EJECUCIÓN, no en la de recolección — si no,
  // el afterEach de "despachos (tarea 2.10)" (arriba) lo desharía
  // antes de que esta descripción llegue a correr.
  beforeAll(() => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "on_time", expected_date: "2026-03-15T20:00:00Z" })));
  });
  afterAll(() => vi.unstubAllGlobals());

  const empresaId = randomUUID();
  const empresaBId = randomUUID();
  const usuarioId = randomUUID();
  let cuentaId: string;
  let pedidoId: string;
  let despachoFlexId: string;
  let despachoFullId: string;
  let despachoAgenciaId: string;

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa tarjetas despachos", nit: `TEST-DESPT-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B tarjetas despachos", nit: `TEST-DESPTB-${empresaBId.slice(0, 8)}` })
    );
    // despachos_ml.despachado_por referencia usuarios.id — usuarios no
    // es una tabla de empresa (no pasa por dbComoEmpresa), por eso va
    // con el `db` crudo, igual que el resto de las pruebas que insertan
    // un usuario de prueba (ej. lib/ml/transferencia.test.ts).
    await db.insert(usuarios).values({ id: usuarioId, email: `prueba-despachos-${usuarioId.slice(0, 8)}@zilonix.test`, nombre: "Usuario de prueba Despachos" });

    // pedido_items exige una cabecera en pedidos_finanzas con el MISMO
    // (empresa_id, pedido_id) — FK compuesta pedido_items_venta_misma_
    // empresa_fk (db/schema.ts) — crearVentaDePrueba ya la crea junto
    // con la línea, a diferencia de armar pedido_items a mano.
    ({ cuentaMlId: cuentaId, pedidoId } = await crearVentaDePrueba(empresaId, { lineas: 1 }));

    [despachoFlexId, despachoFullId, despachoAgenciaId] = await dbComoEmpresa(empresaId, async (tx) => {
      const filas = await tx
        .insert(despachosMl)
        .values([
          { empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno: "FLEX-1", logisticType: "self_service", status: "ready_to_ship", imprimible: true },
          { empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno: "FULL-1", logisticType: "fulfillment", status: "ready_to_ship", imprimible: false },
          { empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno: "AGENCIA-1", logisticType: "xd_drop_off", status: "ready_to_ship", imprimible: true },
          // Bug real reportado por Mateo en staging: pedidos YA
          // ENTREGADOS (de meses atrás) aparecían en "Pendientes" con
          // "Sin plazo definido" — el único filtro era despachado_ts
          // IS NULL (columna nueva, siempre null en filas viejas).
          // Esta fila reproduce exactamente eso: delivered, sin
          // despachar nunca (nadie lo va a marcar, ya se entregó).
          { empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno: "ENTREGADO-VIEJO", logisticType: "self_service", status: "delivered", substatus: "dropped_off", imprimible: false },
          { empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno: "CANCELADO-VIEJO", logisticType: "cross_docking", status: "cancelled", imprimible: false },
        ])
        .returning({ id: despachosMl.id });
      return filas.map((f) => f.id);
    });
  });

  it("listarTarjetasDespacho: nunca incluye Full (fulfillment), sin importar el filtro de tipo", async () => {
    const todas = await listarTarjetasDespacho(empresaId);
    expect(todas.map((d) => d.shipmentIdExterno)).not.toContain("FULL-1");
  });

  it("listarTarjetasDespacho (pendientes): bug real de staging — delivered/shipped/cancelled NUNCA aparecen, solo ready_to_ship", async () => {
    const pendientes = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    const ids = pendientes.map((d) => d.shipmentIdExterno);
    expect(ids).not.toContain("ENTREGADO-VIEJO");
    expect(ids).not.toContain("CANCELADO-VIEJO");
    expect(ids.sort()).toEqual(["AGENCIA-1", "FLEX-1"]);
  });

  it("listarTarjetasDespacho: trae los items de pedido_items de la tarjeta (imagen, título, cantidad, SKU)", async () => {
    const [flex] = await listarTarjetasDespacho(empresaId, { tipo: "self_service" });
    expect(flex.items).toHaveLength(1);
    expect(flex.items[0]).toMatchObject({ itemIdExterno: "MCO1001", skuCodigo: "REF-1", cantidad: 1, titulo: "Producto 1" });
    expect(flex.cuentaNickname).toBe("VENDEDOR_PRUEBA");
    expect(flex.pedidoIdExterno).toBeTruthy();
  });

  it("listarTarjetasDespacho: filtro de tipo fuera de la lista permitida se ignora (trae todo, no 0 filas)", async () => {
    const resultado = await listarTarjetasDespacho(empresaId, { tipo: "no-existe" });
    expect(resultado.length).toBeGreaterThan(0);
  });

  it("listarTarjetasDespacho: filtro por cuenta", async () => {
    const otraCuentaId = await crearCuentaMlDePrueba(empresaId);
    const resultado = await listarTarjetasDespacho(empresaId, { cuentaId: otraCuentaId });
    expect(resultado).toHaveLength(0);
  });

  it("marcarDespachado: sin haber abierto la guía primero, tira GuiaNoVistaError y no marca nada", async () => {
    await expect(marcarDespachado(empresaId, despachoAgenciaId, usuarioId)).rejects.toThrow(GuiaNoVistaError);
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.id, despachoAgenciaId)));
    expect(fila.despachadoTs).toBeNull();
  });

  it("puedeMarcarDespachado: refleja el mismo gate que marcarDespachado (para deshabilitar el botón en la UI)", () => {
    expect(puedeMarcarDespachado(null)).toBe(false);
    expect(puedeMarcarDespachado(new Date())).toBe(true);
  });

  it("marcarGuiaVista + marcarDespachado: abrir la guía habilita marcar, y la tarjeta pasa de 'pendientes' a 'despachados'", async () => {
    await marcarGuiaVista(empresaId, despachoFlexId);
    await marcarDespachado(empresaId, despachoFlexId, usuarioId);

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.id, despachoFlexId)));
    expect(fila.despachadoTs).not.toBeNull();
    expect(fila.despachadoPor).toBe(usuarioId);

    const pendientes = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    expect(pendientes.map((d) => d.id)).not.toContain(despachoFlexId);

    const despachados = await listarTarjetasDespacho(empresaId, { pestaña: "despachados" });
    expect(despachados.map((d) => d.id)).toContain(despachoFlexId);
  });

  it("marcarGuiaVista es idempotente: abrir la guía dos veces no corre guia_vista_ts hacia adelante", async () => {
    const [antes] = await dbComoEmpresa(empresaId, (tx) => tx.select({ guiaVistaTs: despachosMl.guiaVistaTs }).from(despachosMl).where(eq(despachosMl.id, despachoFlexId)));
    await new Promise((r) => setTimeout(r, 5));
    await marcarGuiaVista(empresaId, despachoFlexId);
    const [despues] = await dbComoEmpresa(empresaId, (tx) => tx.select({ guiaVistaTs: despachosMl.guiaVistaTs }).from(despachosMl).where(eq(despachosMl.id, despachoFlexId)));
    expect(despues.guiaVistaTs?.getTime()).toBe(antes.guiaVistaTs?.getTime());
  });

  it("deshacerDespachado: dentro de la ventana de 10 minutos, vuelve a 'pendientes'", async () => {
    await deshacerDespachado(empresaId, despachoFlexId);
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.id, despachoFlexId)));
    expect(fila.despachadoTs).toBeNull();
    expect(fila.despachadoPor).toBeNull();

    const pendientes = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    expect(pendientes.map((d) => d.id)).toContain(despachoFlexId);
  });

  it("deshacerDespachado: sobre algo que ya no estaba marcado es un no-op, nunca un error", async () => {
    await expect(deshacerDespachado(empresaId, despachoFlexId)).resolves.toBeUndefined();
  });

  it("deshacerDespachado: pasada la ventana de 10 minutos, tira VentanaDeshacerVencidaError y NO deshace", async () => {
    await marcarGuiaVista(empresaId, despachoFlexId);
    await marcarDespachado(empresaId, despachoFlexId, usuarioId);
    // Simula que ya pasaron más de 10 minutos desde que se marcó.
    await dbComoEmpresa(empresaId, (tx) =>
      tx.update(despachosMl).set({ despachadoTs: new Date(Date.now() - VENTANA_DESHACER_MS - 1_000) }).where(eq(despachosMl.id, despachoFlexId))
    );
    await expect(deshacerDespachado(empresaId, despachoFlexId)).rejects.toThrow(VentanaDeshacerVencidaError);
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.id, despachoFlexId)));
    expect(fila.despachadoTs).not.toBeNull(); // sigue marcado, no se deshizo
  });

  it("marcarDespachado y deshacerDespachado sobre un id que no existe: DespachoNoEncontradoError", async () => {
    const idInexistente = randomUUID();
    await expect(marcarDespachado(empresaId, idInexistente, usuarioId)).rejects.toThrow(DespachoNoEncontradoError);
    await expect(deshacerDespachado(empresaId, idInexistente)).rejects.toThrow(DespachoNoEncontradoError);
  });

  it("aislamiento A/B: empresa B nunca ve, marca ni deshace una tarjeta de la empresa A", async () => {
    const deB = await listarTarjetasDespacho(empresaBId);
    expect(deB).toHaveLength(0);
    await expect(marcarGuiaVista(empresaBId, despachoAgenciaId)).resolves.toBeUndefined(); // UPDATE con 0 filas, nunca un error
    const [filaIntacta] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.id, despachoAgenciaId)));
    expect(filaIntacta.guiaVistaTs).toBeNull(); // la empresa A nunca se vio afectada por el intento de B
  });

  it("listarCuentasConErrorDespacho: una cuenta desconectada aparece con su motivo; una activa nunca aparece", async () => {
    const cuentaDesconectadaId = await crearCuentaMlDePrueba(empresaId);
    await dbComoEmpresa(empresaId, (tx) => tx.update(cuentasMl).set({ desconectadaTs: new Date() }).where(eq(cuentasMl.id, cuentaDesconectadaId)));

    const conError = await listarCuentasConErrorDespacho(empresaId);
    expect(conError.map((c) => c.cuentaId)).toContain(cuentaDesconectadaId);
    expect(conError.map((c) => c.cuentaId)).not.toContain(cuentaId);
    expect(conError.find((c) => c.cuentaId === cuentaDesconectadaId)?.motivo).toMatch(/reconectar/i);
  });

  it("listarCuentasConErrorDespacho: empresa sin cuentas desconectadas da una lista vacía, nunca un error", async () => {
    const empresaSinErroresId = randomUUID();
    await dbComoEmpresa(empresaSinErroresId, (tx) =>
      tx.insert(empresas).values({ id: empresaSinErroresId, nombre: "Empresa sin errores", nit: `TEST-DESPE-${empresaSinErroresId.slice(0, 8)}` })
    );
    expect(await listarCuentasConErrorDespacho(empresaSinErroresId)).toEqual([]);
  });
});

// Fase 1-1 de Despachos — "Vendido a: $precio" y "Stock: N" de la
// línea 1 de la tarjeta (issue #280, WMS de Seller), y el orden real
// por fecha de venta descendente entre VARIOS pedidos (punto 3 de la
// tarea) — todo contra Postgres real, en una empresa propia para no
// mezclarse con el fixture (fijo, un solo plazo) del describe de arriba.
describe("tarjetas de Despachos — Fase 1-1 (stock, precio y orden por fecha de venta)", () => {
  vi.setConfig({ testTimeout: 20_000 });
  beforeAll(() => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "on_time", expected_date: "2026-03-15T20:00:00Z" })));
  });
  afterAll(() => vi.unstubAllGlobals());

  const empresaId = randomUUID();
  const usuarioId = randomUUID();

  // pedido_items exige una cabecera en pedidos_finanzas con el MISMO
  // (empresa_id, pedido_id) — FK compuesta pedido_items_venta_misma_
  // empresa_fk (db/schema.ts). crearPedidoDePrueba (a diferencia de
  // crearVentaDePrueba) NO la crea — hace falta acá porque estas
  // pruebas necesitan controlar fecha/skuId/precioUnitario a mano,
  // cosa que crearVentaDePrueba(..., {lineas}) no permite.
  async function crearCabeceraFinanzas(pedidoId: string, cuentaMlId: string): Promise<void> {
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidosFinanzas).values({ empresaId, pedidoId, cuentaMlId, valorVenta: "100000.00" }));
  }

  it("items trae precioUnitario y la suma de stock_bodega.disponible SOLO entre bodegas activas", async () => {
    await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa stock despachos", nit: `TEST-DESPS-${empresaId.slice(0, 8)}` }));
    await db.insert(usuarios).values({ id: usuarioId, email: `prueba-despachos-stock-${usuarioId.slice(0, 8)}@zilonix.test`, nombre: "Usuario de prueba" });

    const { id: bodegaActivaId } = await crearBodega(empresaId, usuarioId, { nombre: "Principal", tipo: "propia" });
    const { id: bodegaInactivaId } = await crearBodega(empresaId, usuarioId, { nombre: "Vieja", tipo: "propia" });
    await dbComoEmpresa(empresaId, (tx) => tx.update(bodegas).set({ activa: false }).where(eq(bodegas.id, bodegaInactivaId)));

    const [{ id: skuId }] = await dbComoEmpresa(empresaId, (tx) => tx.insert(skus).values({ empresaId, codigo: "REF-1", nombre: "Producto 1" }).returning({ id: skus.id }));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(stockBodega).values([
        { empresaId, bodegaId: bodegaActivaId, skuId, disponible: 6 },
        { empresaId, bodegaId: bodegaInactivaId, skuId, disponible: 100 }, // nunca debe sumar — bodega inactiva
      ])
    );

    const cuentaId = await crearCuentaMlDePrueba(empresaId);
    const pedidoId = await crearPedidoDePrueba(empresaId, cuentaId);
    await crearCabeceraFinanzas(pedidoId, cuentaId);
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(pedidoItems).values({ ...lineaDePrueba(empresaId, pedidoId, 1), skuId, precioUnitario: "129000.00" })
    );
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(despachosMl).values({ empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno: "STOCK-1", logisticType: "self_service", status: "ready_to_ship", imprimible: true })
    );

    const [tarjeta] = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    expect(tarjeta.items[0].precioUnitario).toBe("129000.00");
    expect(tarjeta.items[0].stockDisponible).toBe(6); // 6 de la activa, nunca los 100 de la inactiva
  });

  it("sin sku_id resuelto, stockDisponible es null — nunca 0 inventado", async () => {
    const cuentaId = await crearCuentaMlDePrueba(empresaId);
    const pedidoId = await crearPedidoDePrueba(empresaId, cuentaId);
    await crearCabeceraFinanzas(pedidoId, cuentaId);
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidoItems).values({ ...lineaDePrueba(empresaId, pedidoId, 1), skuId: null, skuCodigo: null }));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(despachosMl).values({ empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno: "SIN-SKU-1", logisticType: "self_service", status: "ready_to_ship", imprimible: true })
    );

    const tarjetas = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    const tarjeta = tarjetas.find((t) => t.shipmentIdExterno === "SIN-SKU-1")!;
    expect(tarjeta.items[0].stockDisponible).toBeNull();
  });

  it("orden real: lo más nuevo arriba, lo más viejo abajo, por fecha de VENTA (no por cuándo se sincronizó)", async () => {
    const cuentaId = await crearCuentaMlDePrueba(empresaId);

    const pedidoViejoId = await crearPedidoDePrueba(empresaId, cuentaId);
    await crearCabeceraFinanzas(pedidoViejoId, cuentaId);
    await dbComoEmpresa(empresaId, (tx) => tx.update(pedidos).set({ fecha: new Date("2026-01-01T15:00:00Z") }).where(eq(pedidos.id, pedidoViejoId)));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(empresaId, pedidoViejoId, 1)));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(despachosMl).values({ empresaId, pedidoId: pedidoViejoId, cuentaMlId: cuentaId, shipmentIdExterno: "ORDEN-VIEJO", logisticType: "self_service", status: "ready_to_ship", imprimible: true })
    );

    const pedidoNuevoId = await crearPedidoDePrueba(empresaId, cuentaId);
    await crearCabeceraFinanzas(pedidoNuevoId, cuentaId);
    await dbComoEmpresa(empresaId, (tx) => tx.update(pedidos).set({ fecha: new Date("2026-06-01T15:00:00Z") }).where(eq(pedidos.id, pedidoNuevoId)));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(empresaId, pedidoNuevoId, 1)));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(despachosMl).values({ empresaId, pedidoId: pedidoNuevoId, cuentaMlId: cuentaId, shipmentIdExterno: "ORDEN-NUEVO", logisticType: "self_service", status: "ready_to_ship", imprimible: true })
    );

    const tarjetas = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes", cuentaId });
    const indiceViejo = tarjetas.findIndex((t) => t.shipmentIdExterno === "ORDEN-VIEJO");
    const indiceNuevo = tarjetas.findIndex((t) => t.shipmentIdExterno === "ORDEN-NUEVO");
    expect(indiceNuevo).toBeLessThan(indiceViejo); // lo más nuevo, arriba
  });
});

// Revisión de Pablo (PR #310) — el backfill del plazo (lib/ml/
// despachos.ts) nunca debe volver a llamar a Mercado Libre por un
// envío que ya intentó hace menos de 30 minutos, sin importar si ese
// intento trajo el plazo real o no. Cada test usa su propio despacho
// (id único) para no pisar el freno en memoria de otro test del
// archivo.
describe("backfill del plazo — no reintenta antes de 30 minutos (revisión de Pablo, PR #310)", () => {
  vi.setConfig({ testTimeout: 20_000 });
  const empresaId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa backfill SLA", nit: `TEST-DESPB-${empresaId.slice(0, 8)}` }));
  });

  async function despachoListoParaBackfill(shipmentIdExterno: string): Promise<string> {
    const cuentaId = await crearCuentaMlDePrueba(empresaId);
    const pedidoId = await crearPedidoDePrueba(empresaId, cuentaId);
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidosFinanzas).values({ empresaId, pedidoId, cuentaMlId: cuentaId, valorVenta: "100000.00" }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(empresaId, pedidoId, 1)));
    const [{ id: despachoId }] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(despachosMl)
        .values({ empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno, logisticType: "self_service", status: "ready_to_ship", imprimible: true })
        .returning({ id: despachosMl.id })
    );
    return despachoId;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("una respuesta sin plazo (sin expected_date) no rompe, y una segunda carga inmediata no vuelve a pegarle a ML", async () => {
    await despachoListoParaBackfill("910000001");
    const fetchMock = vi.fn(async () => respuestaJson({ status: "on_time" })); // sin expected_date
    vi.stubGlobal("fetch", fetchMock);

    const primeraCarga = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    const tarjeta1 = primeraCarga.find((t) => t.shipmentIdExterno === "910000001")!;
    expect(tarjeta1).toBeDefined(); // no rompió la lista
    expect(tarjeta1.slaExpectedDate).toBeNull();
    const llamadasTrasPrimera = fetchMock.mock.calls.length;
    expect(llamadasTrasPrimera).toBeGreaterThan(0); // sí intentó, al menos una vez

    const segundaCarga = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    const tarjeta2 = segundaCarga.find((t) => t.shipmentIdExterno === "910000001")!;
    expect(tarjeta2.slaExpectedDate).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(llamadasTrasPrimera); // ninguna llamada nueva — todavía dentro del freno de 30 min
  });

  it("una vez el plazo se guardó con éxito, una segunda carga tampoco vuelve a pegarle a ML (ya no es candidato)", async () => {
    await despachoListoParaBackfill("910000002");
    const fetchMock = vi.fn(async () => respuestaJson({ status: "on_time", expected_date: "2026-03-15T20:00:00Z" }));
    vi.stubGlobal("fetch", fetchMock);

    const primeraCarga = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    const tarjeta1 = primeraCarga.find((t) => t.shipmentIdExterno === "910000002")!;
    expect(tarjeta1.slaExpectedDate).not.toBeNull();
    const llamadasTrasPrimera = fetchMock.mock.calls.length;

    const segundaCarga = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    const tarjeta2 = segundaCarga.find((t) => t.shipmentIdExterno === "910000002")!;
    expect(tarjeta2.slaExpectedDate?.getTime()).toBe(tarjeta1.slaExpectedDate?.getTime());
    expect(fetchMock.mock.calls.length).toBe(llamadasTrasPrimera); // ninguna llamada nueva
  });
});

// Bug real reportado por Mateo en staging: pedidos del 22/23 de
// octubre, ready_to_ship con substatus "ya lo recogió el
// transportador/domiciliario" (picked_up o similar), seguían saliendo
// en Pendientes. Dos mecanismos distintos cubren los dos casos reales
// (la fila ya tiene el substatus correcto vs. todavía no) — cada test
// prueba uno.
describe("Pendientes nunca incluye un envío que ya salió de la tienda (fix mateo/fix-despachos-pendientes-recogidos)", () => {
  vi.setConfig({ testTimeout: 20_000 });
  const empresaId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa ya salio", nit: `TEST-DESPY-${empresaId.slice(0, 8)}` }));
  });

  async function despachoConEstado(shipmentIdExterno: string, status: string | null, substatus: string | null): Promise<string> {
    const cuentaId = await crearCuentaMlDePrueba(empresaId);
    const pedidoId = await crearPedidoDePrueba(empresaId, cuentaId);
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidosFinanzas).values({ empresaId, pedidoId, cuentaMlId: cuentaId, valorVenta: "100000.00" }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(empresaId, pedidoId, 1)));
    const [{ id: despachoId }] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(despachosMl)
        .values({ empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno, logisticType: "self_service", status, substatus, imprimible: status === "ready_to_ship" })
        .returning({ id: despachosMl.id })
    );
    return despachoId;
  }

  // refrescarEstadoViejo solo revisa en vivo lo que lleva más de 1h
  // sin sincronizar (UMBRAL_VIEJO_MS) — un despacho recién insertado
  // en la prueba (actualizado_ts = ahora) no califica todavía.
  async function envejecer(despachoId: string): Promise<void> {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.update(despachosMl).set({ actualizadoTs: new Date(Date.now() - 2 * 60 * 60 * 1000) }).where(eq(despachosMl.id, despachoId))
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("filtro de la consulta: la fila YA tiene substatus picked_up guardado — nunca aparece, y nunca llama a Mercado Libre por ella", async () => {
    await despachoConEstado("920000001", "ready_to_ship", "picked_up");
    const fetchMock = vi.fn(async () => {
      throw new Error("no debía llamar a Mercado Libre — el filtro de la consulta ya la descarta");
    });
    vi.stubGlobal("fetch", fetchMock);

    const pendientes = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    expect(pendientes.map((t) => t.shipmentIdExterno)).not.toContain("920000001");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filtro de la consulta: dropped_off / out_for_delivery / at_the_door también quedan afuera", async () => {
    await despachoConEstado("920000002", "ready_to_ship", "dropped_off");
    await despachoConEstado("920000003", "ready_to_ship", "out_for_delivery");
    await despachoConEstado("920000004", "ready_to_ship", "at_the_door");
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "on_time", expected_date: "2026-03-15T20:00:00Z" })));

    const pendientes = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    const ids = pendientes.map((t) => t.shipmentIdExterno);
    expect(ids).not.toContain("920000002");
    expect(ids).not.toContain("920000003");
    expect(ids).not.toContain("920000004");
  });

  it("refresco en vivo: status/substatus viejos (sin actualizar desde el import) se corrigen contra Mercado Libre y la fila sale de Pendientes en la MISMA carga", async () => {
    const despachoId = await despachoConEstado("920000005", "ready_to_ship", null); // nunca se refrescó desde que se importó
    await envejecer(despachoId);
    const fetchMock = vi.fn(async () => respuestaJson({ status: "delivered", substatus: "delivered", logistic_type: "self_service" }));
    vi.stubGlobal("fetch", fetchMock);

    const pendientes = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    expect(pendientes.map((t) => t.shipmentIdExterno)).not.toContain("920000005");

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.shipmentIdExterno, "920000005")));
    expect(fila.status).toBe("delivered");
    expect(fila.imprimible).toBe(false);
  });

  it("refresco en vivo: si Mercado Libre confirma que sigue ready_to_ship sin substatus, queda en Pendientes y no vuelve a refrescar antes de 30 minutos", async () => {
    const despachoId = await despachoConEstado("920000006", "ready_to_ship", null);
    await envejecer(despachoId);
    const fetchMock = vi.fn(async () => respuestaJson({ status: "ready_to_ship", substatus: null, logistic_type: "self_service" }));
    vi.stubGlobal("fetch", fetchMock);

    const primeraCarga = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    expect(primeraCarga.map((t) => t.shipmentIdExterno)).toContain("920000006");
    const llamadasTrasPrimera = fetchMock.mock.calls.length;
    expect(llamadasTrasPrimera).toBeGreaterThan(0);

    const segundaCarga = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    expect(segundaCarga.map((t) => t.shipmentIdExterno)).toContain("920000006");
    expect(fetchMock.mock.calls.length).toBe(llamadasTrasPrimera); // ninguna llamada nueva — freno de 30 min
  });

  it("un despacho recién sincronizado (menos de 1h) NUNCA dispara el refresco en vivo — solo lo viejo", async () => {
    const despachoId = await despachoConEstado("920000007", "ready_to_ship", null); // actualizado_ts = ahora, sin envejecer
    // Ya tiene plazo guardado para que backfillSlaFaltante (otro
    // mecanismo, sin relación con el umbral de "vieja") tampoco llame
    // — esta prueba aísla solo refrescarEstadoViejo.
    await dbComoEmpresa(empresaId, (tx) => tx.update(despachosMl).set({ slaExpectedDate: new Date("2026-03-15T20:00:00Z") }).where(eq(despachosMl.id, despachoId)));
    const fetchMock = vi.fn(async () => {
      throw new Error("no debía llamar a Mercado Libre — todavía no es 'vieja'");
    });
    vi.stubGlobal("fetch", fetchMock);

    const pendientes = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    expect(pendientes.map((t) => t.shipmentIdExterno)).toContain("920000007");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Reportado por Mateo (diagnóstico de la rama
// mateo/feat-despachos-pestana-impresion): confirmar que una cuenta
// con el token vencido (CuentaDesconectadaError al refrescar su
// propio despacho viejo) nunca borra ni oculta las filas de OTRA
// cuenta de la misma empresa — cada candidato de refrescarEstadoViejo
// se procesa en su propio try/catch, independiente de los demás.
describe("una cuenta con token vencido nunca oculta las filas de otra cuenta (fix mateo/feat-despachos-pestana-impresion)", () => {
  vi.setConfig({ testTimeout: 20_000 });
  const empresaId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa cuenta vencida", nit: `TEST-DESPV2-${empresaId.slice(0, 8)}` }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("ZILONIX desconectada con una fila vieja no afecta la fila fresca de otra cuenta conectada", async () => {
    const cuentaDesconectadaId = await crearCuentaMlDePrueba(empresaId);
    await dbComoEmpresa(empresaId, (tx) => tx.update(cuentasMl).set({ desconectadaTs: new Date() }).where(eq(cuentasMl.id, cuentaDesconectadaId)));
    const pedidoVencidoId = await crearPedidoDePrueba(empresaId, cuentaDesconectadaId);
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidosFinanzas).values({ empresaId, pedidoId: pedidoVencidoId, cuentaMlId: cuentaDesconectadaId, valorVenta: "100000.00" }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(empresaId, pedidoVencidoId, 1)));
    const [{ id: despachoVencidoId }] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(despachosMl)
        .values({ empresaId, pedidoId: pedidoVencidoId, cuentaMlId: cuentaDesconectadaId, shipmentIdExterno: "930000001", logisticType: "self_service", status: "ready_to_ship", imprimible: true })
        .returning({ id: despachosMl.id })
    );
    // "Vieja" (más de 1h sin sincronizar) — así refrescarEstadoViejo
    // SÍ la toma como candidata y de verdad intenta renovar el token
    // (CuentaDesconectadaError real, no simulada).
    await dbComoEmpresa(empresaId, (tx) => tx.update(despachosMl).set({ actualizadoTs: new Date(Date.now() - 2 * 60 * 60 * 1000) }).where(eq(despachosMl.id, despachoVencidoId)));

    const cuentaOkId = await crearCuentaMlDePrueba(empresaId);
    const pedidoOkId = await crearPedidoDePrueba(empresaId, cuentaOkId);
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidosFinanzas).values({ empresaId, pedidoId: pedidoOkId, cuentaMlId: cuentaOkId, valorVenta: "100000.00" }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(empresaId, pedidoOkId, 1)));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(despachosMl).values({ empresaId, pedidoId: pedidoOkId, cuentaMlId: cuentaOkId, shipmentIdExterno: "930000002", logisticType: "self_service", status: "ready_to_ship", imprimible: true })
    );

    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "ready_to_ship", substatus: null, logistic_type: "self_service" })));

    const pendientes = await listarTarjetasDespacho(empresaId, { pestaña: "pendientes" });
    const ids = pendientes.map((t) => t.shipmentIdExterno);
    expect(ids).toContain("930000001"); // la de la cuenta vencida sigue ahí — CuentaDesconectadaError no la borra, solo no la pudo refrescar
    expect(ids).toContain("930000002"); // y la de la otra cuenta, intacta

    const conError = await listarCuentasConErrorDespacho(empresaId);
    expect(conError.map((c) => c.cuentaId)).toContain(cuentaDesconectadaId);
    expect(conError.map((c) => c.cuentaId)).not.toContain(cuentaOkId);
  });
});

// Issue "Despachados (15 días)" — reportado por Mateo: un envío que la
// transportadora ya recogió, pero que nadie marcó despachado en
// Seller, desaparecía por completo (Pendientes lo excluye por
// status/substatus, y la vieja "Despachados hoy" solo miraba
// despachado_ts). Ahora entra con su propia etiqueta, ventana de
// DIAS_VENTANA_DESPACHADOS días.
describe("pestaña Despachados — 15 días, dos orígenes (fix mateo/feat-despachados-15-dias)", () => {
  vi.setConfig({ testTimeout: 20_000 });
  const empresaId = randomUUID();
  const empresaBId = randomUUID();
  const usuarioId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa despachados 15 días", nit: `TEST-DESP15-${empresaId.slice(0, 8)}` }));
    await dbComoEmpresa(empresaBId, (tx) => tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B despachados 15 días", nit: `TEST-DESP15B-${empresaBId.slice(0, 8)}` }));
    await db.insert(usuarios).values({ id: usuarioId, email: `prueba-despachados15-${usuarioId.slice(0, 8)}@zilonix.test`, nombre: "Usuario de prueba" });
    // Defensa de más: con despachado_ts ya puesto en los fixtures que
    // lo necesitan, ni refrescarEstadoViejo ni backfillSlaFaltante
    // deberían tocar la red para ninguna prueba de este describe — un
    // mock fijo, nunca la red real, por si algún fixture cambia.
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ status: "ready_to_ship", substatus: null, logistic_type: "self_service" })));
  });
  afterAll(() => vi.unstubAllGlobals());

  // despachadoTs/status/substatus/actualizadoTs todos explícitos, para
  // controlar exactamente en qué rama (marcado_en_seller vs.
  // recogido_transportadora) y dentro o fuera de la ventana cae cada
  // despacho de prueba.
  async function crearDespacho(
    empresaIdDeLaPrueba: string,
    shipmentIdExterno: string,
    datos: { status: string | null; substatus: string | null; despachadoTs: Date | null; actualizadoTs: Date }
  ): Promise<string> {
    const cuentaId = await crearCuentaMlDePrueba(empresaIdDeLaPrueba);
    const pedidoId = await crearPedidoDePrueba(empresaIdDeLaPrueba, cuentaId);
    await dbComoEmpresa(empresaIdDeLaPrueba, (tx) => tx.insert(pedidosFinanzas).values({ empresaId: empresaIdDeLaPrueba, pedidoId, cuentaMlId: cuentaId, valorVenta: "100000.00" }));
    await dbComoEmpresa(empresaIdDeLaPrueba, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(empresaIdDeLaPrueba, pedidoId, 1)));
    const [{ id: despachoId }] = await dbComoEmpresa(empresaIdDeLaPrueba, (tx) =>
      tx
        .insert(despachosMl)
        .values({
          empresaId: empresaIdDeLaPrueba,
          pedidoId,
          cuentaMlId: cuentaId,
          shipmentIdExterno,
          logisticType: "self_service",
          status: datos.status,
          substatus: datos.substatus,
          imprimible: false,
          despachadoTs: datos.despachadoTs,
          despachadoPor: datos.despachadoTs ? usuarioId : null,
        })
        .returning({ id: despachosMl.id })
    );
    // actualizado_ts no se puede fijar en el insert inicial (tiene
    // default now() en el esquema) — se corrige con un update aparte,
    // igual que ya hacen las demás pruebas de este archivo.
    await dbComoEmpresa(empresaIdDeLaPrueba, (tx) => tx.update(despachosMl).set({ actualizadoTs: datos.actualizadoTs }).where(eq(despachosMl.id, despachoId)));
    return despachoId;
  }

  const AHORA = Date.now();
  const haceNDias = (n: number) => new Date(AHORA - n * 24 * 60 * 60 * 1000);

  it("un envío picked_up que nadie marcó en Seller aparece como 'Recogido por la transportadora'", async () => {
    const id = await crearDespacho(empresaId, "940000001", { status: "shipped", substatus: "picked_up", despachadoTs: null, actualizadoTs: haceNDias(3) });

    const despachados = await listarTarjetasDespacho(empresaId, { pestaña: "despachados" });
    const tarjeta = despachados.find((t) => t.id === id);
    expect(tarjeta).toBeDefined();
    expect(tarjeta?.origenDespacho).toBe("recogido_transportadora");
  });

  it("un envío marcado despachado en Seller aparece como 'Marcado en Seller'", async () => {
    const id = await crearDespacho(empresaId, "940000002", { status: "ready_to_ship", substatus: null, despachadoTs: haceNDias(2), actualizadoTs: haceNDias(2) });

    const despachados = await listarTarjetasDespacho(empresaId, { pestaña: "despachados" });
    const tarjeta = despachados.find((t) => t.id === id);
    expect(tarjeta).toBeDefined();
    expect(tarjeta?.origenDespacho).toBe("marcado_en_seller");
  });

  it("uno de hace 16 días no aparece (fuera de la ventana de 15 días), marcado o recogido", async () => {
    const idMarcadoViejo = await crearDespacho(empresaId, "940000003", { status: "shipped", substatus: null, despachadoTs: haceNDias(16), actualizadoTs: haceNDias(16) });
    const idRecogidoViejo = await crearDespacho(empresaId, "940000004", { status: "delivered", substatus: null, despachadoTs: null, actualizadoTs: haceNDias(16) });

    const despachados = await listarTarjetasDespacho(empresaId, { pestaña: "despachados" });
    const ids = despachados.map((t) => t.id);
    expect(ids).not.toContain(idMarcadoViejo);
    expect(ids).not.toContain(idRecogidoViejo);
  });

  it("uno de hace exactamente 14 días (dentro de los 15) sí aparece — el borde no se corta de más", async () => {
    const id = await crearDespacho(empresaId, "940000005", { status: "delivered", substatus: null, despachadoTs: null, actualizadoTs: haceNDias(14) });

    const despachados = await listarTarjetasDespacho(empresaId, { pestaña: "despachados" });
    expect(despachados.map((t) => t.id)).toContain(id);
  });

  it("aislamiento A/B: empresa B nunca ve los despachados de empresa A", async () => {
    const idB = await crearDespacho(empresaBId, "940000006", { status: "shipped", substatus: "picked_up", despachadoTs: null, actualizadoTs: haceNDias(1) });

    const despachadosA = await listarTarjetasDespacho(empresaId, { pestaña: "despachados" });
    expect(despachadosA.map((t) => t.id)).not.toContain(idB);

    const despachadosB = await listarTarjetasDespacho(empresaBId, { pestaña: "despachados" });
    expect(despachadosB.map((t) => t.id)).toEqual([idB]); // solo la suya, nada de empresa A
  });

  it("un pedido Full (fulfillment) nunca aparece en Despachados, aunque esté delivered", async () => {
    const cuentaId = await crearCuentaMlDePrueba(empresaId);
    const pedidoId = await crearPedidoDePrueba(empresaId, cuentaId);
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidosFinanzas).values({ empresaId, pedidoId, cuentaMlId: cuentaId, valorVenta: "100000.00" }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(empresaId, pedidoId, 1)));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(despachosMl).values({ empresaId, pedidoId, cuentaMlId: cuentaId, shipmentIdExterno: "940000007", logisticType: "fulfillment", status: "delivered", imprimible: false })
    );

    const despachados = await listarTarjetasDespacho(empresaId, { pestaña: "despachados" });
    expect(despachados.map((t) => t.shipmentIdExterno)).not.toContain("940000007");
  });
});
