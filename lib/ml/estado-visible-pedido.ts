import type { EstadoChip } from "@/components/marco/Chip";

// Issue #166 — un solo mapa para el estado que se ve en /panel/pedidos:
// combina pedidos.estado (order.status de Mercado Libre) con el status
// del despacho más reciente (despachos_ml.status). Archivo puro, sin
// base, para probarlo sin Postgres. Colores confirmados por Mateo
// (24-oct-2026).
//
// De los estados del pedido, solo "paid" está confirmado en datos reales
// hoy (ver ESTADOS_PEDIDO_FILTRO en lib/ml/pedidos.ts). Los del envío son
// los de la API de ML: pending, handling, ready_to_ship, shipped,
// delivered, not_delivered y cancelled. Cualquier otro valor se muestra
// tal cual y en neutro: nunca se esconde ni queda vacío.
export type EstadoVisible = { etiqueta: string; color: EstadoChip };

// La primera regla que aplica gana. La cancelación del pedido va antes
// que el envío: un pedido cancelado con un envío "delivered" viejo sigue
// siendo una venta cancelada.
export function estadoVisiblePedido(estadoPedido: string, estadoEnvio: string | null): EstadoVisible {
  if (estadoPedido === "cancelled") return { etiqueta: "Cancelada", color: "peligro" };
  if (estadoPedido === "invalid") return { etiqueta: "Inválida", color: "peligro" };
  if (estadoEnvio === "not_delivered") return { etiqueta: "No entregada", color: "peligro" };
  if (estadoEnvio === "delivered") return { etiqueta: "Entregada", color: "exito" };
  if (estadoEnvio === "shipped") return { etiqueta: "Enviada", color: "neutro" };
  // Pagada con el envío sin salir (null, pending, handling,
  // ready_to_ship) o con el envío cancelado.
  if (estadoPedido === "paid") return { etiqueta: "Pagada", color: "aviso" };
  if (estadoPedido === "payment_required") return { etiqueta: "Pago pendiente", color: "neutro" };
  if (estadoPedido === "payment_in_process") return { etiqueta: "Pago en proceso", color: "neutro" };
  if (estadoPedido === "confirmed") return { etiqueta: "Confirmada", color: "neutro" };
  return { etiqueta: estadoPedido, color: "neutro" };
}
