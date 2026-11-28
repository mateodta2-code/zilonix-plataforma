import { normalizarParametro } from "@/lib/filtros-listado";
import { esUuid } from "./gastos";

// Issue #422 (fase 5 de Finanzas) — cuentas por pagar: lo que la
// empresa debe y aún no ha pagado. Tres orígenes, cada uno con su propia
// fuente (nada se duplica): gastos externos pendientes, órdenes de compra
// sin fecha de pago y, desde el 28-nov, lo que las ventas despachadas le
// deben a los terceros habituales de empaque, agencia y Flex
// (por-pagar-ventas.ts). Este archivo es la parte pura (filtros y
// etiquetas); la consulta vive en por-pagar-db.ts.

export const ORIGENES_POR_PAGAR = ["gasto", "orden", "ventas"] as const;
export type OrigenPorPagar = (typeof ORIGENES_POR_PAGAR)[number];

export const ETIQUETA_ORIGEN_POR_PAGAR: Record<OrigenPorPagar, string> = {
  gasto: "Gasto",
  orden: "Orden de compra",
  ventas: "Ventas (empaque y envío)",
};

// vencido: la fecha de vencimiento ya pasó. por_vencer: vence de hoy a
// 7 días. al_dia: vence después, o no tiene fecha (una orden de compra
// no guarda vencimiento; un gasto sin vencimiento nunca está vencido,
// igual que en /panel/finanzas/gastos).
export const ESTADOS_POR_PAGAR = ["vencido", "por_vencer", "al_dia"] as const;
export type EstadoPorPagar = (typeof ESTADOS_POR_PAGAR)[number];

export const ETIQUETA_ESTADO_POR_PAGAR: Record<EstadoPorPagar, string> = {
  vencido: "Vencido",
  por_vencer: "Por vencer",
  al_dia: "Al día",
};

export const DIAS_POR_VENCER = 7;

// Proveedor del filtro: un tercero (t:<uuid>) o un beneficiario escrito
// a mano en el gasto (b:<nombre>). Nunca se arma SQL con esto: viaja
// como parámetro.
export type ProveedorFiltro = { tipo: "tercero"; id: string } | { tipo: "beneficiario"; nombre: string };

export type FiltrosPorPagar = {
  origen: OrigenPorPagar | null;
  estado: EstadoPorPagar | null;
  proveedor: ProveedorFiltro | null;
};

export function leerProveedor(valor: string | null): ProveedorFiltro | null {
  if (!valor) return null;
  if (valor.startsWith("t:")) {
    const id = valor.slice(2);
    return esUuid(id) ? { tipo: "tercero", id } : null;
  }
  if (valor.startsWith("b:")) {
    const nombre = valor.slice(2).trim();
    return nombre.length > 0 && nombre.length <= 200 ? { tipo: "beneficiario", nombre } : null;
  }
  return null;
}

// Lista blanca: lo que no se reconoce se ignora.
export function leerFiltrosPorPagar(params: Record<string, string | string[] | undefined>): FiltrosPorPagar {
  const origenTexto = normalizarParametro(params.origen);
  const estadoTexto = normalizarParametro(params.estado);
  return {
    origen: ORIGENES_POR_PAGAR.find((o) => o === origenTexto) ?? null,
    estado: ESTADOS_POR_PAGAR.find((e) => e === estadoTexto) ?? null,
    proveedor: leerProveedor(normalizarParametro(params.proveedor) ?? null),
  };
}

// Días entre dos "AAAA-MM-DD" (hoy − vencimiento). Positivo = vencido.
export function diasDeVencido(vence: string | null, hoy: string): number | null {
  if (!vence) return null;
  const dias = Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${vence}T00:00:00Z`)) / 86_400_000);
  return dias > 0 ? dias : 0;
}
