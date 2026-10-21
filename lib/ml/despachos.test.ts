import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl, empresas, pedidos } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { EtiquetaNoImprimibleError, listarDespachosPendientes, marcarEtiquetasImpresas, obtenerEtiquetasPdf, sincronizarDespacho } from "./despachos";

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
