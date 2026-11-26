// Optimización · Rendimiento — datos de la base de Seller (sin llamar a
// Mercado Libre ni a la API de Ads): ventas e ingresos por publicación
// (pedidos + pedido_items + pedidos_finanzas, mismo criterio de venta que
// Finanzas y resumenTiendaDatos.ts) y clics/impresiones de Ads
// (publicidad_metricas_diarias, nivel «anuncio»).
//
// Ads: el mismo ítem puede estar en varios ad groups (la fila es única por
// ad group y día), así que se SUMAN todas sus filas del período:
//   select entidad_id_ml, sum(clicks), sum(impresiones)
//   from publicidad_metricas_diarias
//   where nivel = 'anuncio' and cuenta_ml_id = $1 and fecha between $desde and $hasta
//   group by entidad_id_ml

import { and, between, eq, gte, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidoItems, pedidos, pedidosFinanzas, publicaciones, publicidadMetricasDiarias } from "@/db/schema";
import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import { limitesDiaBogota } from "@/lib/filtros-listado";
import type { PeriodoLista } from "./periodoLista";

export type FilaRendimientoBase = {
  itemId: string;
  titulo: string | null;
  foto: string | null;
  sku: string | null;
  ingresos: number;
  ventas: number;
  unidades: number;
  // null = la cuenta no tiene Product Ads («Sin Ads»).
  clics: number | null;
  impresiones: number | null;
};

export type DatosRendimientoBase = {
  filas: FilaRendimientoBase[];
  // Ventas canceladas del período, excluidas de los ingresos.
  canceladas: number;
  tieneAds: boolean;
};

const CONDICION_NO_VENTA = (empresaId: string) =>
  or(inArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA), sql`coalesce(${pedidosFinanzas.cancelada}, false) = true`) ?? sql`false`;

export async function leerRendimientoBase(empresaId: string, cuentaMlId: string, periodo: PeriodoLista): Promise<DatosRendimientoBase> {
  const inicio = limitesDiaBogota(periodo.desde)?.inicio;
  const fin = limitesDiaBogota(periodo.hasta)?.finExclusivo;
  if (!inicio || !fin) return { filas: [], canceladas: 0, tieneAds: false };

  const unirFinanzas = and(eq(pedidosFinanzas.empresaId, pedidos.empresaId), eq(pedidosFinanzas.pedidoId, pedidos.id));
  const enPeriodo = and(eq(pedidos.empresaId, empresaId), eq(pedidos.cuentaMlId, cuentaMlId), gte(pedidos.fecha, inicio), lt(pedidos.fecha, fin));

  const [ventas, canceladas, ads, anunciosExisten] = await Promise.all([
    dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({
          itemId: pedidoItems.itemIdExterno,
          // Ingresos = cantidad × precio unitario.
          ingresos: sql<string>`coalesce(sum(${pedidoItems.cantidad} * ${pedidoItems.precioUnitario}), 0)`,
          ventas: sql<number>`count(distinct ${pedidos.id})`.mapWith(Number),
          unidades: sql<number>`coalesce(sum(${pedidoItems.cantidad}), 0)`.mapWith(Number),
          titulo: sql<string | null>`max(${pedidoItems.titulo})`,
          foto: sql<string | null>`max(${pedidoItems.imagenUrl})`,
          sku: sql<string | null>`max(${pedidoItems.skuCodigo})`,
        })
        .from(pedidoItems)
        .innerJoin(pedidos, and(eq(pedidos.id, pedidoItems.pedidoId), eq(pedidos.empresaId, pedidoItems.empresaId)))
        .leftJoin(pedidosFinanzas, unirFinanzas)
        .where(and(eq(pedidoItems.empresaId, empresaId), enPeriodo, notInArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA), sql`coalesce(${pedidosFinanzas.cancelada}, false) = false`))
        .groupBy(pedidoItems.itemIdExterno)
    ),
    dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({ n: sql<number>`count(distinct ${pedidos.id})`.mapWith(Number) })
        .from(pedidoItems)
        .innerJoin(pedidos, and(eq(pedidos.id, pedidoItems.pedidoId), eq(pedidos.empresaId, pedidoItems.empresaId)))
        .leftJoin(pedidosFinanzas, unirFinanzas)
        .where(and(eq(pedidoItems.empresaId, empresaId), enPeriodo, CONDICION_NO_VENTA(empresaId)))
    ),
    dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({
          itemId: publicidadMetricasDiarias.entidadIdMl,
          clics: sql<number>`coalesce(sum(${publicidadMetricasDiarias.clicks}), 0)`.mapWith(Number),
          impresiones: sql<number>`coalesce(sum(${publicidadMetricasDiarias.impresiones}), 0)`.mapWith(Number),
        })
        .from(publicidadMetricasDiarias)
        .where(
          and(
            eq(publicidadMetricasDiarias.empresaId, empresaId),
            eq(publicidadMetricasDiarias.cuentaMlId, cuentaMlId),
            eq(publicidadMetricasDiarias.nivel, "anuncio"),
            between(publicidadMetricasDiarias.fecha, periodo.desde, periodo.hasta)
          )
        )
        .groupBy(publicidadMetricasDiarias.entidadIdMl)
    ),
    // «Sin Ads» = la cuenta nunca sincronizó anuncios (ni en este período).
    dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({ id: publicidadMetricasDiarias.id })
        .from(publicidadMetricasDiarias)
        .where(and(eq(publicidadMetricasDiarias.empresaId, empresaId), eq(publicidadMetricasDiarias.cuentaMlId, cuentaMlId), eq(publicidadMetricasDiarias.nivel, "anuncio")))
        .limit(1)
    ),
  ]);

  const tieneAds = anunciosExisten.length > 0;
  const porItem = new Map<string, FilaRendimientoBase>();
  for (const v of ventas) {
    porItem.set(v.itemId, {
      itemId: v.itemId,
      titulo: v.titulo,
      foto: v.foto,
      sku: v.sku,
      ingresos: Number(v.ingresos),
      ventas: v.ventas,
      unidades: v.unidades,
      clics: tieneAds ? 0 : null,
      impresiones: tieneAds ? 0 : null,
    });
  }
  // Publicaciones con Ads pero sin ventas: entran como «Sin ventas».
  for (const a of ads) {
    const fila = porItem.get(a.itemId);
    if (fila) {
      fila.clics = a.clics;
      fila.impresiones = a.impresiones;
    } else {
      porItem.set(a.itemId, { itemId: a.itemId, titulo: null, foto: null, sku: null, ingresos: 0, ventas: 0, unidades: 0, clics: a.clics, impresiones: a.impresiones });
    }
  }

  // Título de `publicaciones` (lo que ya importó Seller); el de la línea del
  // pedido queda de respaldo.
  const sinTitulo = [...porItem.keys()];
  if (sinTitulo.length > 0) {
    const titulos = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({ id: publicaciones.publicacionIdExterno, titulo: publicaciones.titulo })
        .from(publicaciones)
        .where(and(eq(publicaciones.empresaId, empresaId), eq(publicaciones.cuentaMlId, cuentaMlId), inArray(publicaciones.publicacionIdExterno, sinTitulo)))
    );
    for (const t of titulos) {
      const fila = porItem.get(t.id);
      if (fila) fila.titulo = t.titulo;
    }
  }

  return { filas: [...porItem.values()], canceladas: canceladas[0]?.n ?? 0, tieneAds };
}
