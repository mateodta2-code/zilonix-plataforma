import { asc, desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidoEventos, pedidos } from "@/db/schema";

export type PasoPedido = (typeof pedidoEventos.$inferInsert)["paso"];

// Tarea 2.7 — los 8 pasos del plan maestro, en orden fijo. La pantalla
// de detalle siempre los muestra en este orden, tengan evento o no —
// nunca reordenados ni con pasos sueltos.
export const PASOS_PEDIDO: PasoPedido[] = [
  "venta",
  "pago",
  "factura",
  "empaque",
  "despacho",
  "entrega",
  "novedades",
  "dinero_conciliado",
];

// Siempre actor "sistema" — todo lo que llena un evento de pedido hoy
// viene de confirmar el dato real contra la API de Mercado Libre
// (tarea 2.5/2.7), nunca de una persona a mano todavía.
export async function registrarEventoPedido(
  empresaId: string,
  pedidoId: string,
  paso: PasoPedido,
  ts: Date,
  detalle?: string
): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(pedidoEventos)
      .values({ empresaId, pedidoId, paso, ts, actorTipo: "sistema", detalle })
      .onConflictDoNothing({ target: [pedidoEventos.pedidoId, pedidoEventos.paso] })
  );
}

export async function listarPedidos(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.empresaId, empresaId)).orderBy(desc(pedidos.fecha)));
}

export type EventoPedido = { paso: PasoPedido; ts: Date; actorTipo: "persona" | "sistema"; detalle: string | null };

// Tarea 2.7 — "ves venta, pago, despacho y entrega con fecha, hora y
// quién". "Quién" para un evento de sistema siempre es "Sistema /
// integración ML" (mismo criterio de la tarea 1.9 — nunca se le
// atribuye a una persona lo que confirmó la API sola). Las pantallas
// nunca reciben el usuarioId crudo, solo lo ya resuelto acá.
export async function obtenerPedidoConEventos(empresaId: string, pedidoId: string) {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [pedido] = await tx.select().from(pedidos).where(eq(pedidos.id, pedidoId));
    if (!pedido) return null;
    const eventos = await tx
      .select({ paso: pedidoEventos.paso, ts: pedidoEventos.ts, actorTipo: pedidoEventos.actorTipo, detalle: pedidoEventos.detalle })
      .from(pedidoEventos)
      .where(eq(pedidoEventos.pedidoId, pedidoId))
      .orderBy(asc(pedidoEventos.ts));
    return { pedido, eventos: eventos as EventoPedido[] };
  });
}
