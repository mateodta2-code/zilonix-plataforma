import { count, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidosFalabella } from "@/db/schema";
import { llamarFalabella } from "@/lib/falabella/cliente";
import { obtenerCredenciales } from "@/lib/falabella/cuentas";
import { parsearFechaFalabella } from "@/lib/falabella/fechas";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";

// GetOrders v2.0 / GetOrderItems v1.0 — confirmado contra
// developers.falabella.com/docs/orders/getordersv2 y
// .../docs/orders/getorderitems (15/11).
//
// INCÓGNITA REAL, pendiente de confirmar contra una cuenta real antes de
// dar este archivo por cerrado: la tabla de parámetros de filtro de
// GetOrders queda colapsada ("Ver 11 más") en la documentación pública
// sin credenciales — no se pudo leer el nombre exacto de cada uno.
// `CreatedAfter`/`CreatedBefore` y `Offset`/`Limit` abajo son los nombres
// que usa toda la familia de API "Seller Center" de la que Falabella es
// un despliegue más (el mismo origen de Lazada/Linio/Daraz comparte este
// contrato) — es la hipótesis mejor fundada, NO una confirmación directa
// de la página de Falabella. Primer uso real: si Falabella responde un
// ErrorResponse rechazando alguno de estos nombres, el mensaje de error
// de Falabella dice cuál — se ajusta ahí, no se insiste a ciegas.
type OrdenFalabella = {
  OrderId: string;
  CreatedAt: string;
  Price: string;
  GrandTotal?: string;
  Statuses?: { Status: string | string[] };
};

type ItemOrdenFalabella = {
  OrderItemId: string;
  Sku: string;
  Name: string;
  ItemPrice: string;
  PaidPrice: string;
  Status: string;
  Currency: string;
};

function estadoDeOrden(orden: OrdenFalabella): string {
  const statuses = orden.Statuses?.Status;
  if (!statuses) return "desconocido";
  return Array.isArray(statuses) ? statuses[0] : statuses;
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

  await dbComoEmpresa(empresaId, async (tx) => {
    for (const orden of ordenes) {
      const items = itemsPorOrden.get(orden.OrderId) ?? [];
      const moneda = items[0]?.Currency ?? "COP";
      const estado = estadoDeOrden(orden);
      const total = orden.GrandTotal ?? orden.Price;
      await tx
        .insert(pedidosFalabella)
        .values({
          empresaId,
          cuentaFalabellaId,
          pedidoIdExterno: orden.OrderId,
          fecha: parsearFechaFalabella(orden.CreatedAt),
          total,
          moneda,
          estado,
          items,
        })
        .onConflictDoUpdate({
          target: [pedidosFalabella.empresaId, pedidosFalabella.pedidoIdExterno],
          set: { estado, total, items },
        });
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
