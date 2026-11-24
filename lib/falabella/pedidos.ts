import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasFalabella, pedidosFalabella } from "@/db/schema";
import { llamarFalabella } from "@/lib/falabella/cliente";
import { obtenerCredenciales } from "@/lib/falabella/cuentas";
import { parsearFechaFalabella } from "@/lib/falabella/fechas";
import { parsearMontoFalabella } from "@/lib/falabella/montos";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";

// GetOrders v2.0 / GetOrderItems v1.0 — confirmado contra
// developers.falabella.com/docs/orders/getordersv2 y
// .../docs/orders/getorderitems (15/11).
//
// Parámetros de GetOrders: `CreatedAfter`, `Limit` y `Offset` ya se
// confirmaron con una cuenta real en staging (15/11, issue #422) —
// GetOrders v2 y GetOrderItems respondieron bien con estos nombres.
// `CreatedBefore` sigue sin usarse ni confirmarse.
//
// Los montos llegan como texto con coma de miles ("78,000.00"): se
// normalizan con parsearMontoFalabella antes de guardar (issue #422).
type OrdenFalabella = {
  OrderId: string;
  // El número que ve el comprador y el que usa el Reporte de transacciones.
  OrderNumber?: string | number;
  CreatedAt: string;
  Price: string | number;
  GrandTotal?: string | number;
  Statuses?: { Status: string | string[] };
};

type ItemOrdenFalabella = {
  OrderItemId: string;
  Sku: string;
  Name: string;
  ItemPrice: string | number;
  PaidPrice: string | number;
  Status: string;
  Currency: string;
};

function estadoDeOrden(orden: OrdenFalabella): string {
  const statuses = orden.Statuses?.Status;
  if (!statuses) return "desconocido";
  return Array.isArray(statuses) ? statuses[0] : statuses;
}

// Error al guardar un pedido puntual: lleva el OrderId para el log (nunca
// datos del comprador).
export class PedidoFalabellaError extends Error {
  constructor(
    public readonly orderId: string,
    causa: unknown
  ) {
    super(`No se pudo guardar el pedido de Falabella ${orderId}: ${causa instanceof Error ? causa.message : String(causa)}`, { cause: causa });
    this.name = "PedidoFalabellaError";
  }
}

type Credenciales = { userId: string; apiKey: string; sellerId: string };

// Revisión del PR #415: antes se traía UNA sola página de 1000. Ahora se
// pagina con Offset hasta que una página vuelve incompleta (o se llega a
// TotalCount si Falabella lo manda). Tope duro de páginas para que un
// error de paginación nunca se vuelva un bucle infinito contra la API.
const TAMANO_PAGINA = 100;
const MAX_PAGINAS = 100;

// Tope = MAX_PAGINAS × TAMANO_PAGINA = 10.000 órdenes por sincronización.
export const TOPE_ORDENES = MAX_PAGINAS * TAMANO_PAGINA;

async function obtenerOrdenes(credenciales: Credenciales, desde: Date): Promise<{ ordenes: OrdenFalabella[]; truncado: boolean }> {
  const todas: OrdenFalabella[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const cuerpo = await llamarFalabella<{ TotalCount?: string | number; Orders?: { Order: OrdenFalabella | OrdenFalabella[] } }>({
      ...credenciales,
      action: "GetOrders",
      version: "2.0",
      parametros: {
        CreatedAfter: desde.toISOString(),
        Limit: String(TAMANO_PAGINA),
        Offset: String(pagina * TAMANO_PAGINA),
      },
    });
    const orden = cuerpo?.Orders?.Order;
    const lote = !orden ? [] : Array.isArray(orden) ? orden : [orden];
    todas.push(...lote);
    const total = Number(cuerpo?.TotalCount);
    if (lote.length < TAMANO_PAGINA) return { ordenes: todas, truncado: false };
    if (Number.isFinite(total) && total > 0 && todas.length >= total) return { ordenes: todas, truncado: false };
  }
  // Revisión del PR #415: si se llegó al tope y la última página vino
  // llena, puede haber más órdenes — se avisa en pantalla, nunca se corta
  // en silencio.
  return { ordenes: todas, truncado: true };
}

async function obtenerItemsOrden(credenciales: Credenciales, orderId: string): Promise<ItemOrdenFalabella[]> {
  const cuerpo = await llamarFalabella<{ OrderItems?: { OrderItem: ItemOrdenFalabella | ItemOrdenFalabella[] } }>({
    ...credenciales,
    action: "GetOrderItems",
    version: "1.0",
    parametros: { OrderId: orderId },
  });
  const item = cuerpo?.OrderItems?.OrderItem;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

// GetOrderItems es una llamada por orden: se hacen de a pocas en
// paralelo (no 1000 en fila, ni 1000 a la vez contra Falabella).
const CONCURRENCIA_ITEMS = 5;

async function itemsDeTodas(credenciales: Credenciales, ordenes: OrdenFalabella[]): Promise<Map<string, ItemOrdenFalabella[]>> {
  const items = await conConcurrenciaLimitada(ordenes, CONCURRENCIA_ITEMS, (orden) => obtenerItemsOrden(credenciales, orden.OrderId));
  return new Map(ordenes.map((orden, i) => [orden.OrderId, items[i]]));
}

// Importa los pedidos de una cuenta desde una fecha dada — mismo criterio
// idempotente que la importación de Mercado Libre: se puede volver a
// correr para el mismo rango sin duplicar nada (ON CONFLICT por
// (empresa_id, pedido_id_externo)).
//
// Revisión del PR #415 (bloqueante 2): antes las llamadas a Falabella
// (un GetOrderItems por orden) se hacían DENTRO de dbComoEmpresa, así que
// un Falabella lento dejaba la transacción y la conexión del pool
// abiertas. Ahora todo lo de red va primero, por fuera; la transacción
// solo hace los upsert.
export async function importarPedidos(
  empresaId: string,
  cuentaFalabellaId: string,
  desde: Date
): Promise<{ importados: number; truncado: boolean }> {
  const credenciales = await obtenerCredenciales(empresaId, cuentaFalabellaId);
  const { ordenes, truncado } = await obtenerOrdenes(credenciales, desde);
  const itemsPorOrden = await itemsDeTodas(credenciales, ordenes);

  // Issue #422: los montos se normalizan ANTES de abrir la transacción —
  // un formato no reconocido corta acá, con campo y OrderId, sin haber
  // tocado la base.
  const filas = ordenes.map((orden) => {
    const orderId = orden.OrderId;
    const items = (itemsPorOrden.get(orderId) ?? []).map((item) => ({
      ...item,
      ItemPrice: parsearMontoFalabella(item.ItemPrice, { campo: "ItemPrice", orderId }),
      PaidPrice: parsearMontoFalabella(item.PaidPrice, { campo: "PaidPrice", orderId }),
    }));
    const campoTotal = orden.GrandTotal != null ? "GrandTotal" : "Price";
    const numeroOrden = orden.OrderNumber != null && String(orden.OrderNumber).trim() !== "" ? String(orden.OrderNumber).trim() : null;
    return {
      orderId,
      numeroOrden,
      fecha: parsearFechaFalabella(orden.CreatedAt),
      total: parsearMontoFalabella(orden.GrandTotal ?? orden.Price, { campo: campoTotal, orderId }),
      moneda: items[0]?.Currency ?? "COP",
      estado: estadoDeOrden(orden),
      items,
    };
  });

  await dbComoEmpresa(empresaId, async (tx) => {
    for (const { orderId, numeroOrden, fecha, total, moneda, estado, items } of filas) {
      try {
        await tx
          .insert(pedidosFalabella)
          .values({
            empresaId,
            cuentaFalabellaId,
            pedidoIdExterno: orderId,
            numeroOrden,
            fecha,
            total,
            moneda,
            estado,
            items,
          })
          .onConflictDoUpdate({
            target: [pedidosFalabella.empresaId, pedidosFalabella.pedidoIdExterno],
            // Issue #422: incluye numeroOrden para que re-sincronizar llene
            // las órdenes importadas antes de existir la columna. Con
            // coalesce (revisión de Pablo en #482): si una sync posterior
            // no trae OrderNumber, se conserva el que ya estaba.
            // costo_manual y flete_manual NUNCA van acá: los escribe solo
            // la persona desde Finanzas y resincronizar no puede borrarlos.
            set: { estado, total, items, numeroOrden: sql`coalesce(excluded.numero_orden, ${pedidosFalabella.numeroOrden})` },
          });
      } catch (error) {
        // Issue #422: sin el OrderId, el log solo decía "invalid input
        // syntax" y no había cómo saber qué pedido revisar.
        throw new PedidoFalabellaError(orderId, error);
      }
    }
  });
  return { importados: ordenes.length, truncado };
}

export async function listarPedidos(empresaId: string, cuentaFalabellaId?: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select()
      .from(pedidosFalabella)
      .where(cuentaFalabellaId ? eq(pedidosFalabella.cuentaFalabellaId, cuentaFalabellaId) : undefined)
      .orderBy(pedidosFalabella.fecha)
  );
}

// Issue #422 — lo que pinta /panel/pedidos: los pedidos de un rango
// [desde, hastaExclusivo) (el mismo filtro de mes del detalle de Mercado
// Libre), el más nuevo primero, con el nickname de su cuenta. Lee con
// dbComoEmpresa: RLS deja ver solo los pedidos y cuentas de ESTA empresa.
// Tope de filas para que un rango enorme no cargue miles de JSONB de una
// vez; si se llega, la pantalla lo avisa (nunca corta en silencio).
export const TOPE_PEDIDOS_PANTALLA = 500;

export async function listarPedidosParaPantalla(
  empresaId: string,
  rango: { desde: Date; hastaExclusivo: Date }
): Promise<{
  pedidos: {
    id: string;
    pedidoIdExterno: string;
    fecha: Date;
    total: string;
    moneda: string;
    estado: string;
    items: unknown;
    cuenta: string;
  }[];
  truncado: boolean;
}> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: pedidosFalabella.id,
        pedidoIdExterno: pedidosFalabella.pedidoIdExterno,
        fecha: pedidosFalabella.fecha,
        total: pedidosFalabella.total,
        moneda: pedidosFalabella.moneda,
        estado: pedidosFalabella.estado,
        items: pedidosFalabella.items,
        cuenta: cuentasFalabella.nickname,
      })
      .from(pedidosFalabella)
      .innerJoin(cuentasFalabella, eq(cuentasFalabella.id, pedidosFalabella.cuentaFalabellaId))
      .where(and(gte(pedidosFalabella.fecha, rango.desde), lt(pedidosFalabella.fecha, rango.hastaExclusivo)))
      .orderBy(desc(pedidosFalabella.fecha), desc(pedidosFalabella.pedidoIdExterno))
      .limit(TOPE_PEDIDOS_PANTALLA + 1)
  );
  return { pedidos: filas.slice(0, TOPE_PEDIDOS_PANTALLA), truncado: filas.length > TOPE_PEDIDOS_PANTALLA };
}

// Revisión del PR #415: la pantalla solo necesita cuántos pedidos tiene
// cada cuenta — antes cargaba todas las filas con su JSONB `items`.
export async function contarPedidosPorCuenta(empresaId: string): Promise<Map<string, number>> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ cuentaId: pedidosFalabella.cuentaFalabellaId, cantidad: count() })
      .from(pedidosFalabella)
      .groupBy(pedidosFalabella.cuentaFalabellaId)
  );
  return new Map(filas.map((f) => [f.cuentaId, Number(f.cantidad)]));
}
