// Optimización — resumen global de la tienda (una cuenta de Mercado
// Libre), como el «Resumen de desempeño» de Métricas de negocio de
// Mercado Libre: ventas brutas, unidades, precios promedio, visitas,
// conversión, canceladas y devueltas, contra el período anterior.
//
// Puro: recibe las ventas ya leídas de Seller y las visitas de Mercado
// Libre. Mismo criterio de venta que Finanzas: estado fuera de
// ESTADOS_QUE_NO_SON_VENTA y sin «cancelada» en pedidos_finanzas; lo
// demás cuenta como cancelada. Devuelta = venta con reembolsos > 0.
// Un dato que no se puede saber queda en null, nunca en 0 inventado.

import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import { aCentavos, desdeCentavos, porcentaje } from "@/lib/finanzas/utilidad-venta";
import { restarDiasIso } from "@/lib/publicidad/plan";

export type VentaTienda = {
  dia: string; // YYYY-MM-DD de Bogotá
  total: string;
  estado: string;
  cancelada: boolean | null;
  reembolsos: string | null;
  // null = la venta todavía no tiene sus líneas (sin foto de Finanzas).
  unidades: number | null;
};

export type ResumenTienda = {
  ventasBrutas: string;
  ventas: number;
  unidades: number;
  // false = alguna venta todavía no tiene sus líneas: las unidades (y el
  // precio por unidad) se quedan cortas.
  unidadesCompletas: boolean;
  precioPorUnidad: string | null;
  precioPorVenta: string | null;
  visitas: number | null;
  conversion: string | null;
  canceladas: number;
  valorCanceladas: string;
  devueltas: number;
  valorDevueltas: string;
};

export type PeriodoTienda = { desde: string; hasta: string; anteriorDesde: string; anteriorHasta: string };

const CERO = BigInt(0);

// Los últimos `dias` días de Bogotá contando hoy, y los `dias` de antes.
export function periodoTienda(dias: number, hoy: string): PeriodoTienda {
  return {
    desde: restarDiasIso(hoy, dias - 1),
    hasta: hoy,
    anteriorDesde: restarDiasIso(hoy, dias * 2 - 1),
    anteriorHasta: restarDiasIso(hoy, dias),
  };
}

function esVenta(v: VentaTienda): boolean {
  return !ESTADOS_QUE_NO_SON_VENTA.includes(v.estado) && v.cancelada !== true;
}

export function resumirTienda(ventas: VentaTienda[], desde: string, hasta: string, visitas: number | null): ResumenTienda {
  let brutas = CERO;
  let cantidad = 0;
  let unidades = 0;
  let unidadesCompletas = true;
  let canceladas = 0;
  let valorCanceladas = CERO;
  let devueltas = 0;
  let valorDevueltas = CERO;
  for (const v of ventas) {
    if (v.dia < desde || v.dia > hasta) continue;
    if (!esVenta(v)) {
      canceladas += 1;
      valorCanceladas += aCentavos(v.total);
      continue;
    }
    cantidad += 1;
    brutas += aCentavos(v.total);
    if (v.unidades === null) unidadesCompletas = false;
    else unidades += v.unidades;
    const reembolso = v.reembolsos === null ? CERO : aCentavos(v.reembolsos);
    if (reembolso > CERO) {
      devueltas += 1;
      valorDevueltas += reembolso;
    }
  }
  return {
    ventasBrutas: desdeCentavos(brutas),
    ventas: cantidad,
    unidades,
    unidadesCompletas,
    precioPorUnidad: unidades > 0 && unidadesCompletas ? desdeCentavos(brutas / BigInt(unidades)) : null,
    precioPorVenta: cantidad > 0 ? desdeCentavos(brutas / BigInt(cantidad)) : null,
    visitas,
    conversion: visitas !== null && visitas > 0 ? porcentaje(BigInt(cantidad), BigInt(visitas)) : null,
    canceladas,
    valorCanceladas: desdeCentavos(valorCanceladas),
    devueltas,
    valorDevueltas: desdeCentavos(valorDevueltas),
  };
}
