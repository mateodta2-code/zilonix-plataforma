// Ventas de Mercado Libre que NO suman a la utilidad y van a la pestaña
// «Canceladas y devoluciones» de Finanzas → Ventas (pedido de Sharel,
// 2026-11-28). Archivo puro: sin base ni reloj.
//
// Antes las canceladas (cancelled/invalid o reembolso total) salían de
// la consulta y no quedaba registro, y las de reembolso parcial seguían
// sumando con la marca «con devolución · revisar». Decisiones de Sharel:
// - Reembolso PARCIAL: la venta entera sale de la utilidad.
// - Reclamo de devolución en Productos → Devoluciones (no anulado): sale
//   desde el reclamo, aunque Mercado Libre todavía no reembolse.
//
// Los montos de la pestaña son los que guardó la última sincronización
// (pedidos_finanzas), sin calcular una «pérdida»: qué cobra o devuelve
// Mercado Libre en una cancelación o devolución (comisión, flete) no se
// ha confirmado con datos reales, y aquí no se adivina.

import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import { aCentavos, desdeCentavos } from "./utilidad-venta";

// En orden de prioridad: el primero que aplica es el motivo.
export const MOTIVOS_FUERA_DE_UTILIDAD = ["cancelada", "reembolso_total", "reembolso_parcial", "reclamo_devolucion"] as const;
export type MotivoFueraDeUtilidad = (typeof MOTIVOS_FUERA_DE_UTILIDAD)[number];

export const ETIQUETA_MOTIVO: Record<MotivoFueraDeUtilidad, string> = {
  cancelada: "Cancelada",
  reembolso_total: "Reembolso total",
  reembolso_parcial: "Reembolso parcial",
  reclamo_devolucion: "Reclamo de devolución",
};

const CERO = BigInt(0);

export function motivoFueraDeUtilidad(venta: {
  estado: string;
  // pedidos_finanzas.cancelada: cancelled en ML o reembolso total.
  cancelada: boolean;
  reembolsos: string;
  // Hay una devolución no anulada en Productos → Devoluciones.
  tieneReclamo: boolean;
}): MotivoFueraDeUtilidad | null {
  if (ESTADOS_QUE_NO_SON_VENTA.includes(venta.estado)) return "cancelada";
  if (venta.cancelada) return "reembolso_total";
  if (aCentavos(venta.reembolsos) > CERO) return "reembolso_parcial";
  if (venta.tieneReclamo) return "reclamo_devolucion";
  return null;
}

export type VentaFueraDeUtilidad = {
  pedidoId: string;
  pedidoIdExterno: string;
  fechaCreacion: Date;
  cuenta: string;
  // pedidos.estado de Mercado Libre, tal cual.
  estado: string;
  motivo: MotivoFueraDeUtilidad;
  productos: { titulo: string; sku: string | null; cantidad: number }[];
  valorVenta: string;
  reembolsos: string;
  // null = Mercado Libre no lo trajo.
  comisionMl: string | null;
  fleteMl: string | null;
};

export type TotalesFueraDeUtilidad = {
  ventas: number;
  porMotivo: Record<MotivoFueraDeUtilidad, number>;
  valorVenta: string;
  reembolsos: string;
};

export function totalizarFueraDeUtilidad(ventas: VentaFueraDeUtilidad[]): TotalesFueraDeUtilidad {
  const porMotivo = Object.fromEntries(MOTIVOS_FUERA_DE_UTILIDAD.map((m) => [m, 0])) as Record<MotivoFueraDeUtilidad, number>;
  let valor = CERO;
  let reembolsos = CERO;
  for (const v of ventas) {
    porMotivo[v.motivo] += 1;
    valor += aCentavos(v.valorVenta);
    reembolsos += aCentavos(v.reembolsos);
  }
  return { ventas: ventas.length, porMotivo, valorVenta: desdeCentavos(valor), reembolsos: desdeCentavos(reembolsos) };
}

// Más nueva primero; mismo día, por número de orden.
export function ordenarFueraDeUtilidad(ventas: VentaFueraDeUtilidad[]): VentaFueraDeUtilidad[] {
  return [...ventas].sort((a, b) => b.fechaCreacion.getTime() - a.fechaCreacion.getTime() || a.pedidoIdExterno.localeCompare(b.pedidoIdExterno));
}
