// Optimización, Fase 1 — ventas de los últimos días por publicación,
// de lo que Seller ya guarda (pedidos + pedido_items), sin llamar a
// Mercado Libre. Mismo criterio de venta que Finanzas
// (lib/finanzas/tablero.ts): estado fuera de ESTADOS_QUE_NO_SON_VENTA y
// sin "cancelada" en pedidos_finanzas.
//
// Ojo: pedido_items solo existe para las ventas que ya tienen su foto de
// Finanzas. Una venta todavía sin sincronizar no suma acá.

import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidoItems, pedidos, pedidosFinanzas } from "@/db/schema";
import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";

export type VentasItem = { ventas: number; unidades: number };

export async function ventasRecientesPorItem(
  empresaId: string,
  cuentaMlId: string,
  itemIds: string[],
  desde: Date
): Promise<Map<string, VentasItem>> {
  if (itemIds.length === 0) return new Map();
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        itemId: pedidoItems.itemIdExterno,
        ventas: sql<number>`count(distinct ${pedidos.id})`.mapWith(Number),
        unidades: sql<number>`coalesce(sum(${pedidoItems.cantidad}), 0)`.mapWith(Number),
      })
      .from(pedidoItems)
      .innerJoin(pedidos, and(eq(pedidos.id, pedidoItems.pedidoId), eq(pedidos.empresaId, pedidoItems.empresaId)))
      .leftJoin(
        pedidosFinanzas,
        and(eq(pedidosFinanzas.empresaId, empresaId), eq(pedidosFinanzas.empresaId, pedidos.empresaId), eq(pedidosFinanzas.pedidoId, pedidos.id))
      )
      .where(
        and(
          eq(pedidoItems.empresaId, empresaId),
          eq(pedidos.cuentaMlId, cuentaMlId),
          inArray(pedidoItems.itemIdExterno, itemIds),
          gte(pedidos.fecha, desde),
          notInArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA),
          sql`coalesce(${pedidosFinanzas.cancelada}, false) = false`
        )
      )
      .groupBy(pedidoItems.itemIdExterno)
  );
  return new Map(filas.map((f) => [f.itemId, { ventas: f.ventas, unidades: f.unidades }]));
}
