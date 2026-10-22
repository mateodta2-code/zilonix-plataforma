import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl, empresas, pedidos } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import {
  contarDespachosPendientes,
  EtiquetaNoImprimibleError,
  listarDespachosFiltrados,
  listarDespachosPendientes,
  marcarEtiquetasImpresas,
  obtenerEtiquetasPdf,
  sincronizarDespacho,
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

  it("página fuera de [1, 10000] (0, negativa, decimal, > 10000) se trata como 1", async () => {
    for (const paginaInvalida of [0, -5, 1.5, 10_001]) {
      const resultado = await listarDespachosFiltrados(empresaId, { pagina: paginaInvalida });
      expect(resultado.pagina).toBe(1);
    }
  });

  it("una página dentro de [1, 10000] pero mayor que el total real se recorta al total de páginas (nunca una página vacía)", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { pagina: 9999 });
    expect(resultado.pagina).toBe(resultado.totalPaginas);
    expect(resultado.despachos.length).toBeGreaterThan(0);
  });

  it("búsqueda por número de envío usa ilike (parcial, sin importar mayúsculas)", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { busqueda: "buscame" });
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

  it("rango de fechas (desde/hasta, hora de Colombia) solo trae los despachos de esos días", async () => {
    const resultado = await listarDespachosFiltrados(empresaId, { desde: "2026-01-10", hasta: "2026-01-10" });
    expect(resultado.total).toBe(1); // solo el día 10 (i=9)
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
