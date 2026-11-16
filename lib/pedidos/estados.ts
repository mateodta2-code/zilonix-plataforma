import type { EstadoChip } from "@/components/marco/Chip";

// Issue #422 — Pedidos informativo: un solo estado en español para
// Mercado Libre y Falabella. Las tablas de traducción viven acá y son
// las MISMAS que usa el filtro de estado en SQL (lib/pedidos/listado.ts),
// así lo que se ve y lo que se filtra nunca se separan.
//
// Ningún valor está adivinado:
// - Envío de ML (despachos_ml.status): IDs oficiales de
//   /shipment_statuses, ya confirmados en lib/ml/despachos.ts
//   (ESTADO_ENVIO_LABELS).
// - Orden de ML (pedidos.estado): "paid" y "cancelled" son los que ya
//   usa el código en producción (lib/ml/pedidos.ts, lib/estados-venta.ts).
//   ML no garantiza el casing ("PAID"/"paid"): se compara en minúscula.
// - Falabella (pedidos_falabella.estado): el primer Statuses.Status de
//   GetOrders, tal como lo guarda lib/falabella/pedidos.ts.
// Un valor que no esté en estas tablas se muestra tal cual, en gris —
// nunca se le inventa una traducción.

export const ESTADOS_UNIFICADOS = [
  { valor: "pendiente", etiqueta: "Pendiente", color: "aviso" },
  { valor: "listo", etiqueta: "Listo para enviar", color: "advertencia" },
  { valor: "enviado", etiqueta: "Enviado", color: "neutro" },
  { valor: "entregado", etiqueta: "Entregado", color: "exito" },
  { valor: "cancelado", etiqueta: "Cancelado", color: "peligro" },
] as const satisfies readonly { valor: string; etiqueta: string; color: EstadoChip }[];

export type EstadoUnificado = (typeof ESTADOS_UNIFICADOS)[number]["valor"];

// Estado del envío de ML → estado unificado.
export const ESTADOS_ENVIO_ML: Record<string, EstadoUnificado> = {
  pending: "pendiente",
  handling: "pendiente",
  ready_to_ship: "listo",
  shipped: "enviado",
  delivered: "entregado",
  cancelled: "cancelado",
};

// Estado de la orden de ML, solo cuando no hay envío con status.
export const ESTADOS_ORDEN_ML: Record<string, EstadoUnificado> = {
  paid: "pendiente",
  cancelled: "cancelado",
};

// Falabella escribe "canceled" (una l); se acepta también la variante de
// ML por si llega así.
export const ESTADOS_FALABELLA: Record<string, EstadoUnificado> = {
  pending: "pendiente",
  ready_to_ship: "listo",
  shipped: "enviado",
  delivered: "entregado",
  canceled: "cancelado",
  cancelled: "cancelado",
};

export type EstadoMostrado = { valor: EstadoUnificado | null; etiqueta: string; color: EstadoChip };

function mostrar(valor: EstadoUnificado): EstadoMostrado {
  const e = ESTADOS_UNIFICADOS.find((x) => x.valor === valor)!;
  return { valor: e.valor, etiqueta: e.etiqueta, color: e.color };
}

function desconocido(crudo: string | null | undefined): EstadoMostrado {
  const texto = crudo?.trim();
  return { valor: null, etiqueta: texto ? texto : "—", color: "neutro" };
}

// ML: una orden cancelada manda sobre el envío (el envío puede quedar
// en un status viejo); si no, el envío; si no hay envío, la orden.
export function estadoPedidoMl(estadoOrden: string, estadoEnvio: string | null): EstadoMostrado {
  const orden = estadoOrden.trim().toLowerCase();
  if (ESTADOS_ORDEN_ML[orden] === "cancelado") return mostrar("cancelado");
  const envio = estadoEnvio?.trim().toLowerCase();
  if (envio && ESTADOS_ENVIO_ML[envio]) return mostrar(ESTADOS_ENVIO_ML[envio]);
  if (envio) return desconocido(estadoEnvio);
  return ESTADOS_ORDEN_ML[orden] ? mostrar(ESTADOS_ORDEN_ML[orden]) : desconocido(estadoOrden);
}

export function estadoPedidoFalabella(estado: string): EstadoMostrado {
  const clave = estado.trim().toLowerCase();
  return ESTADOS_FALABELLA[clave] ? mostrar(ESTADOS_FALABELLA[clave]) : desconocido(estado);
}

// Lista blanca del filtro ?estado=.
export function parsearEstadoUnificado(valor: string | undefined): EstadoUnificado | null {
  return ESTADOS_UNIFICADOS.some((e) => e.valor === valor) ? (valor as EstadoUnificado) : null;
}

// Claves crudas que corresponden a un estado unificado (para el WHERE).
export function crudosDe(tabla: Record<string, EstadoUnificado>, estado: EstadoUnificado): string[] {
  return Object.entries(tabla)
    .filter(([, v]) => v === estado)
    .map(([k]) => k);
}
