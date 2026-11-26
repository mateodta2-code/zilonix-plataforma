// Optimización — datos del resumen global de la tienda: las ventas de la
// cuenta (de lo que Seller ya sincronizó, sin llamar a Mercado Libre) y
// las visitas de toda la tienda (Mercado Libre, /users/{id}/items_visits).
// Se leen los dos períodos (actual y anterior) de una vez.

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidoItems, pedidos, pedidosFinanzas } from "@/db/schema";
import { limitesDiaBogota } from "@/lib/filtros-listado";
import { visitasCuentaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";
import type { PeriodoLista } from "./periodoLista";
import { resumirTienda, type PeriodoTienda, type ResumenTienda, type VentaTienda } from "./resumenTienda";

// `cuentaId`: para que los enlaces del resumen (Análisis, Rendimiento) conserven la cuenta.
export type DatosResumenTienda = { cuentaId: string; periodo: PeriodoTienda; actual: ResumenTienda; anterior: ResumenTienda };

export async function leerResumenTienda(
  empresaId: string,
  cuenta: { id: string; cuentaIdExterna: string },
  periodoLista: PeriodoLista
): Promise<DatosResumenTienda | null> {
  const periodo: PeriodoTienda = {
    desde: periodoLista.desde,
    hasta: periodoLista.hasta,
    anteriorDesde: periodoLista.anteriorDesde,
    anteriorHasta: periodoLista.anteriorHasta,
  };
  const inicio = limitesDiaBogota(periodo.anteriorDesde)?.inicio;
  const fin = limitesDiaBogota(periodo.hasta)?.finExclusivo;
  if (!inicio || !fin) return null;

  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
  const [filas, visitasActual, visitasAnterior] = await Promise.all([
    dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({
          fecha: pedidos.fecha,
          total: pedidos.total,
          estado: pedidos.estado,
          cancelada: pedidosFinanzas.cancelada,
          reembolsos: pedidosFinanzas.reembolsos,
          // null = la venta todavía no tiene sus líneas.
          unidades: sql<number | null>`sum(${pedidoItems.cantidad})`.mapWith((v) => (v === null ? null : Number(v))),
        })
        .from(pedidos)
        .leftJoin(pedidosFinanzas, and(eq(pedidosFinanzas.empresaId, pedidos.empresaId), eq(pedidosFinanzas.pedidoId, pedidos.id)))
        .leftJoin(pedidoItems, and(eq(pedidoItems.empresaId, pedidos.empresaId), eq(pedidoItems.pedidoId, pedidos.id)))
        .where(and(eq(pedidos.empresaId, empresaId), eq(pedidos.cuentaMlId, cuenta.id), gte(pedidos.fecha, inicio), lt(pedidos.fecha, fin)))
        .groupBy(pedidos.id, pedidosFinanzas.cancelada, pedidosFinanzas.reembolsos)
    ),
    visitasCuentaMl(cuenta.cuentaIdExterna, token, periodo.desde, restarDiasIso(periodo.hasta, -1)),
    visitasCuentaMl(cuenta.cuentaIdExterna, token, periodo.anteriorDesde, restarDiasIso(periodo.anteriorHasta, -1)),
  ]);

  const ventas: VentaTienda[] = filas.map((f) => ({
    dia: hoyBogota(f.fecha),
    total: String(f.total),
    estado: f.estado,
    cancelada: f.cancelada,
    reembolsos: f.reembolsos === null ? null : String(f.reembolsos),
    unidades: f.unidades,
  }));
  return {
    cuentaId: cuenta.id,
    periodo,
    actual: resumirTienda(ventas, periodo.desde, periodo.hasta, visitasActual),
    anterior: resumirTienda(ventas, periodo.anteriorDesde, periodo.anteriorHasta, visitasAnterior),
  };
}
