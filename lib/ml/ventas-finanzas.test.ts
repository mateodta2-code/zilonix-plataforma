import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, pedidoItems, pedidos, pedidosFinanzas } from "@/db/schema";
import { crearDosEmpresas } from "@/db/test-utils/aislamiento";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { guardarCostoSku } from "@/lib/costos-sku";
import { sincronizarVentasCuenta } from "./ventas-finanzas";

// Issue #130 (Z-FIN-08) — sincronización por cuenta con la API de ML
// simulada (fetch mockeado). La prueba contra ML real va en staging.

vi.setConfig({ testTimeout: 20_000 });

function json(data: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers(), json: async () => data, text: async () => JSON.stringify(data) } as Response;
}

const sinEspera = async () => {};

function orden(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    date_created: "2026-10-20T10:00:00.000-05:00",
    status: "paid",
    total_amount: 80000,
    currency_id: "COP",
    shipping: { id: 5000 + id },
    payments: [{ status: "approved", date_approved: "2026-10-23T10:00:00.000-05:00", transaction_amount: 80000, marketplace_fee: 9600 }],
    order_items: [{ item: { id: `MCO${id}`, title: `Producto ${id}`, seller_sku: "SYNC-1" }, quantity: 1, unit_price: 80000 }],
    ...extra,
  };
}

describe("sincronizarVentasCuenta (issue #130)", () => {
  let empresaId: string;
  let usuarioId: string;
  let cuentaMlId: string;

  beforeAll(async () => {
    ({ empresaAId: empresaId, usuarioAId: usuarioId } = await crearDosEmpresas());
    cuentaMlId = await crearCuentaMlDePrueba(empresaId);
    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: "SYNC-1", datos: { costo: "30000", empaque: "2000", envioAgencia: "2000" } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("busca por fecha de actualización, guarda y congela, con miniatura y reintento ante un 429", async () => {
    let busquedas = 0;
    let items429 = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/orders/search") {
        busquedas += 1;
        return json({ results: busquedas === 1 ? [orden(101)] : [] });
      }
      if (u.pathname === "/shipments/5101") return json({ logistic_type: "fulfillment", status_history: { date_shipped: "2026-10-24T09:00:00.000-05:00" } });
      if (u.pathname === "/shipments/5101/costs") return json({ senders: [{ cost: 0 }] });
      if (u.pathname === "/items") {
        // El primer pedido de miniaturas topa el límite; el reintento entra.
        if (items429++ === 0) return json({}, 429);
        return json([{ code: 200, body: { id: "MCO101", secure_thumbnail: "https://http2.mlstatic.com/D_101.jpg" } }]);
      }
      throw new Error(`fetch no esperado: ${u.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await sincronizarVentasCuenta(empresaId, cuentaMlId, "123456", { desde: new Date("2026-10-20T00:00:00Z") }, sinEspera);
    expect(resultado).toEqual({ leidas: 1, guardadas: 1, congeladas: 1, fallidas: 0, cortadaPorLimite: false });

    // Pago aprobado tarde: entra porque se busca por última actualización.
    const busqueda = new URL(fetchMock.mock.calls[0][0] as string);
    expect(busqueda.searchParams.get("order.date_last_updated.from")).toBe("2026-10-20T00:00:00.000Z");

    const [cabecera] = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(pedidosFinanzas).innerJoin(pedidos, eq(pedidos.id, pedidosFinanzas.pedidoId)).where(eq(pedidos.pedidoIdExterno, "101"))
    );
    expect(cabecera.pedidos_finanzas).toMatchObject({ formaEntrega: "full_ml", empaqueCongelado: "2000.00", envioAgenciaCongelado: "0.00", comisionMl: "9600.00" });
    const [linea] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, cabecera.pedidos.id)));
    expect(linea).toMatchObject({ imagenUrl: "https://http2.mlstatic.com/D_101.jpg", costoCongelado: "30000.00", titulo: "Producto 101" });

    // Sin token en la URL ni en las cabeceras de log: el token va solo en Authorization.
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes("access"))).toBe(true);
  });

  it("sin foto en ML la venta se guarda igual con imagen vacía, y un error en una venta no corta las demás", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        if (u.pathname === "/orders/search") {
          return json({
            results: u.searchParams.get("offset") === "0" ? [orden(201, { shipping: null }), orden(202, { shipping: null, date_created: "no-es-fecha" })] : [],
          });
        }
        if (u.pathname === "/items") return json([{ code: 200, body: { id: "MCO201" } }]);
        throw new Error(`fetch no esperado: ${u.pathname}`);
      })
    );
    const resultado = await sincronizarVentasCuenta(empresaId, cuentaMlId, "123456", { desde: new Date("2026-10-20T00:00:00Z") }, sinEspera);
    expect(resultado).toMatchObject({ leidas: 2, guardadas: 1, fallidas: 1 });
    const [fila] = await dbComoEmpresa(empresaId, (tx) =>
      tx.select({ imagen: pedidoItems.imagenUrl }).from(pedidoItems).innerJoin(pedidos, eq(pedidos.id, pedidoItems.pedidoId)).where(eq(pedidos.pedidoIdExterno, "201"))
    );
    expect(fila.imagen).toBeNull();
  });

  it("429 persistente corta la cuenta sin perder lo hecho y deja constancia en auditoria", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 429)));
    const esperas: number[] = [];
    const resultado = await sincronizarVentasCuenta(empresaId, cuentaMlId, "123456", { desde: new Date("2026-10-20T00:00:00Z") }, async (ms) => {
      esperas.push(ms);
    });
    expect(resultado).toMatchObject({ leidas: 0, cortadaPorLimite: true });
    // Espera creciente entre reintentos.
    expect(esperas).toEqual([1000, 2000, 4000, 8000]);

    const filas = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(auditoria).where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.accion, "sincronizar_ventas")))
    );
    expect(filas.some((f) => f.actorTipo === "sistema" && f.usuarioId === null && f.detalle?.includes("cortada por el límite"))).toBe(true);
  });
});
