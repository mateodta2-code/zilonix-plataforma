// Inicio (Sharel y el equipo, 13-nov) — los mismos indicadores para
// cualquier tramo: «Hoy» (arriba), el mes en curso (meta) y el rango del
// filtro (abajo). Reusa las lecturas del tablero y de Finanzas → Ventas
// (una sola fórmula, mismas cifras que en Finanzas):
// - Ventas: cantidad de pedidos del tramo (criterio de leerTableroMes:
//   sin canceladas ni inválidas), con o sin foto financiera.
// - Recaudo: pedidos_finanzas.valor_venta de las ventas sincronizadas.
// - Ticket promedio: recaudo ÷ ventas sincronizadas, por moneda.
// - Utilidad (antes de publicidad) y margen: listarVentasUtilidad; el
//   margen es utilidad ÷ recaudo de las ventas CON costo («% util»).
// - Publicidad: costo de nivel campaña (como /panel/publicidad), con el
//   IVA de configuracion_finanzas.iva_publicidad si está configurado.
// - Utilidad después de publicidad: utilidad − publicidad (con IVA).
//   Sin filas de publicidad en el tramo se resta $0 y se dice.
// Rango máximo: 31 días (tope de listarVentasUtilidad).

import { and, eq, gte, lt, notInArray, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidos, pedidosFinanzas } from "@/db/schema";
import { leerConfiguracionFinanzas } from "@/lib/configuracion-finanzas";
import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import { limitesDiaBogota } from "@/lib/filtros-listado";
import { requierePermiso } from "@/lib/permisos";
import {
  leerPorCuentaTramo,
  leerPublicidadTramo,
  leerUtilidadTramo,
  promedioDiario,
  type FilaCuentaTablero,
  type PublicidadMes,
  type Tramo,
  type UtilidadMes,
} from "./tablero";
import { aCentavos, desdeCentavos } from "./utilidad-venta";
import { RANGO_MAXIMO_DIAS } from "./ventas-pantalla";

const DIA_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Tramos
// ---------------------------------------------------------------------------

function hoyBogota(ahora: Date): string {
  return new Date(ahora.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Días de Bogotá AAAA-MM-DD, «hasta» incluido. Máximo 31 días.
export function tramoDeFechas(desde: string, hasta: string): { tramo: Tramo } | { error: string } {
  const d = limitesDiaBogota(desde);
  const h = limitesDiaBogota(hasta);
  if (!d || !h) return { error: "Las fechas tienen que ir como AAAA-MM-DD y ser días reales." };
  if (h.finExclusivo <= d.inicio) return { error: "La fecha «hasta» no puede ser anterior a «desde»." };
  const dias = Math.round((h.finExclusivo.getTime() - d.inicio.getTime()) / DIA_MS);
  if (dias > RANGO_MAXIMO_DIAS) return { error: `El rango puede tener como máximo ${RANGO_MAXIMO_DIAS} días (pediste ${dias}).` };
  return { tramo: { inicio: d.inicio, finExclusivo: h.finExclusivo, desdeTexto: desde, hastaTexto: hasta, dias } };
}

export function tramoDeHoy(ahora: Date): Tramo {
  const hoy = hoyBogota(ahora);
  const r = tramoDeFechas(hoy, hoy);
  if ("error" in r) throw new Error(r.error);
  return r.tramo;
}

// ---------------------------------------------------------------------------
// Parte pura
// ---------------------------------------------------------------------------

// Costo × (1 + IVA/100), redondeado al centavo. IVA "19.00" = 19 %.
export function conIva(costo: string, iva: string | null): string {
  if (iva === null) return desdeCentavos(aCentavos(costo));
  const base = aCentavos(costo);
  const puntos = aCentavos(iva); // 19.00 → 1900 (centésimas de punto)
  const total = BigInt(10000) + puntos;
  const multiplicado = base * total;
  const redondeado = (multiplicado * BigInt(2) + BigInt(10000)) / BigInt(20000);
  return desdeCentavos(redondeado);
}

export function restar(a: string, b: string): string {
  return desdeCentavos(aCentavos(a) - aCentavos(b));
}

// Recaudo ÷ ventas sincronizadas; null sin ventas sincronizadas.
export function ticketPromedio(recaudo: string, ventasSincronizadas: number): string | null {
  return ventasSincronizadas > 0 ? promedioDiario(recaudo, ventasSincronizadas) : null;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type RecaudoMonedaTramo = { moneda: string; monto: string; ventasSincronizadas: number; ticketPromedio: string | null };

export type PublicidadTramo = {
  // null = ninguna fila de métricas de campaña en el tramo.
  costo: string | null;
  // IVA configurado (ej. "19.00"); null = sin configurar (no se suma).
  iva: string | null;
  // Lo que se resta de la utilidad: costo con IVA, o "0.00" sin datos.
  descontado: string;
  porCuenta: PublicidadMes["porCuenta"];
  // Para las barras y el comparativo (mismo formato del tablero).
  mes: PublicidadMes;
};

export type Indicadores = {
  tramo: { desde: string; hasta: string; dias: number };
  ventas: number;
  sinSincronizar: number;
  recaudo: RecaudoMonedaTramo[];
  utilidad: UtilidadMes;
  margen: string | null;
  publicidad: PublicidadTramo;
  // Utilidad − publicidad. null si la utilidad es «—» (sin costos o
  // varias monedas).
  utilidadDespues: string | null;
  porCuenta: FilaCuentaTablero[];
};

async function leerVentasTramo(empresaId: string, tramo: Tramo) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        moneda: pedidos.moneda,
        ventas: sql<number>`count(*)`.mapWith(Number),
        sincronizadas: sql<number>`count(${pedidosFinanzas.pedidoId})`.mapWith(Number),
        recaudo: sql<string>`coalesce(sum(${pedidosFinanzas.valorVenta}), 0)::text`,
      })
      .from(pedidos)
      .leftJoin(
        pedidosFinanzas,
        and(eq(pedidosFinanzas.empresaId, empresaId), eq(pedidosFinanzas.empresaId, pedidos.empresaId), eq(pedidosFinanzas.pedidoId, pedidos.id))
      )
      .where(
        and(
          eq(pedidos.empresaId, empresaId),
          gte(pedidos.fecha, tramo.inicio),
          lt(pedidos.fecha, tramo.finExclusivo),
          notInArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA),
          sql`coalesce(${pedidosFinanzas.cancelada}, false) = false`
        )
      )
      .groupBy(pedidos.moneda)
  );
}

export async function leerIndicadores(empresaId: string, usuarioId: string, tramo: Tramo): Promise<Indicadores> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const filas = (await leerVentasTramo(empresaId, tramo)).sort((a, b) => a.moneda.localeCompare(b.moneda));
  const ventas = filas.reduce((s, f) => s + f.ventas, 0);
  const sincronizadas = filas.reduce((s, f) => s + f.sincronizadas, 0);
  const recaudo = filas
    .filter((f) => f.sincronizadas > 0)
    .map((f) => {
      const monto = desdeCentavos(aCentavos(f.recaudo));
      return { moneda: f.moneda, monto, ventasSincronizadas: f.sincronizadas, ticketPromedio: ticketPromedio(monto, f.sincronizadas) };
    });

  const { resumen: utilidad, margen } = await leerUtilidadTramo(
    empresaId,
    usuarioId,
    tramo,
    filas.map((f) => f.moneda)
  );
  const pub = await leerPublicidadTramo(empresaId, usuarioId, tramo);
  const config = await leerConfiguracionFinanzas(empresaId);
  const iva = config?.ivaPublicidad ?? null;
  const costo = pub.totalPorMoneda ? pub.totalPorMoneda[0].monto : null;
  const descontado = costo === null ? "0.00" : conIva(costo, iva);
  const porCuenta = await leerPorCuentaTramo(empresaId, usuarioId, tramo, pub);

  return {
    tramo: { desde: tramo.desdeTexto, hasta: tramo.hastaTexto, dias: tramo.dias },
    ventas,
    sinSincronizar: ventas - sincronizadas,
    recaudo,
    utilidad,
    margen,
    publicidad: { costo, iva, descontado, porCuenta: pub.porCuenta, mes: pub },
    utilidadDespues: utilidad.utilidad === null ? null : restar(utilidad.utilidad, descontado),
    porCuenta,
  };
}
