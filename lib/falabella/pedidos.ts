import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidosFalabella } from "@/db/schema";
import { llamarFalabella } from "@/lib/falabella/cliente";
import { obtenerCredenciales } from "@/lib/falabella/cuentas";

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

async function obtenerOrdenes(credenciales: { userId: string; apiKey: string; sellerId: string }, desde: Date): Promise<OrdenFalabella[]> {
  const cuerpo = await llamarFalabella<{ Orders?: { Order: OrdenFalabella | OrdenFalabella[] } }>({
    ...credenciales,
    action: "GetOrders",
    version: "2.0",
    parametros: {
      CreatedAfter: desde.toISOString(),
      Limit: "1000",
      Offset: "0",
    },
  });
  const orden = cuerpo?.Orders?.Order;
  if (!orden) return [];
  return Array.isArray(orden) ? orden : [orden];
}

async function obtenerItemsOrden(credenciales: { userId: string; apiKey: string; sellerId: string }, orderId: string): Promise<ItemOrdenFalabella[]> {
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

// Importa los pedidos de una cuenta desde una fecha dada — mismo criterio
// idempotente que la importación de Mercado Libre: se puede volver a
// correr para el mismo rango sin duplicar nada (ON CONFLICT por
// (empresa_id, pedido_id_externo)).
export async function importarPedidos(empresaId: string, cuentaFalabellaId: string, desde: Date): Promise<{ importados: number }> {
  const credenciales = await obtenerCredenciales(empresaId, cuentaFalabellaId);
  const ordenes = await obtenerOrdenes(credenciales, desde);

  let importados = 0;
  await dbComoEmpresa(empresaId, async (tx) => {
    for (const orden of ordenes) {
      const items = await obtenerItemsOrden(credenciales, orden.OrderId);
      const moneda = items[0]?.Currency ?? "COP";
      await tx
        .insert(pedidosFalabella)
        .values({
          empresaId,
          cuentaFalabellaId,
          pedidoIdExterno: orden.OrderId,
          fecha: new Date(orden.CreatedAt),
          total: orden.GrandTotal ?? orden.Price,
          moneda,
          estado: estadoDeOrden(orden),
          items,
        })
        .onConflictDoUpdate({
          target: [pedidosFalabella.empresaId, pedidosFalabella.pedidoIdExterno],
          set: {
            estado: estadoDeOrden(orden),
            total: orden.GrandTotal ?? orden.Price,
            items,
          },
        });
      importados++;
    }
  });
  return { importados };
}

export async function listarPedidos(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidosFalabella).orderBy(pedidosFalabella.fecha));
}
