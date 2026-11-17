// Módulo Optimización — carga de datos (red + base). Los cálculos puros
// viven en lib/ml/optimizacion.ts. Toda llamada a Mercado Libre pasa por
// lib/ml/cliente.ts.
//
// Orden de carga (Parte 1): primero la LISTA BASE (items/search +
// multiget); las métricas (visitas, ventas 7d, promoción, calidad,
// competencia) se piden después SOLO para la página visible (máx. 50),
// con concurrencia limitada y reintento 429. Si una métrica falla, esa
// celda queda en null ("No disponible") y la fila sigue.

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidoItems, pedidos, pedidosFinanzas } from "@/db/schema";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import {
  buscarOrdenesVendedorMl,
  leerCalidadItemMl,
  leerItemsListadoMl,
  leerPrecioPromocionMl,
  leerPriceToWinMl,
  leerVisitasItemMl,
  LimiteMercadoLibreError,
  listarItemsVendedorMl,
  MAX_IDS_MULTIGET_ML,
  PATRON_ID_PRODUCTO_O_ITEM,
  type ItemListadoMl,
  type PrecioPromocionMl,
} from "@/lib/ml/cliente";
import {
  interpretarCompetencia,
  lineasDeOrdenesMl,
  rangoUltimosDias,
  resumirCalidad,
  TAMANO_PAGINA_OPTIMIZACION,
  ventasPorItemEnRango,
  type CalidadItem,
  type CompetenciaItem,
  type FiltroOptimizacion,
} from "@/lib/ml/optimizacion";
import { msDeReintento429 } from "@/lib/ml/reintento-429";

const CONCURRENCIA_METRICAS = 4;
const REINTENTOS_429 = 2;
const ESPERA_BASE_429_MS = 1_000;
// Tope del respaldo por /orders/search: 20 páginas × 50 = 1.000 órdenes
// de la ventana; más que eso se corta y las ventas quedan parciales.
const MAX_PAGINAS_ORDENES = 20;

export const DIAS_METRICAS = 7;

export type CuentaOptimizacion = { id: string; cuentaIdExterna: string };

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Reintento corto de la LECTURA ante 429 (respeta Retry-After). Mismo
// criterio que Promociones: un presupuesto de tiempo propio, pensado
// para algo que corre al abrir una página.
export async function conReintento429<T>(tarea: () => Promise<T>): Promise<T> {
  for (let intento = 0; ; intento++) {
    try {
      return await tarea();
    } catch (error) {
      if (error instanceof LimiteMercadoLibreError && intento < REINTENTOS_429) {
        await esperar(msDeReintento429(ESPERA_BASE_429_MS * (intento + 1), error.retryAfterMs));
        continue;
      }
      throw error;
    }
  }
}

// ---------- lista base ----------

export type ListaBase = { filas: ItemListadoMl[]; total: number };

function normalizarIdBuscado(q: string): string | null {
  const limpio = q.trim().toUpperCase().replace(/-/g, "");
  return PATRON_ID_PRODUCTO_O_ITEM.test(limpio) ? limpio : null;
}

type PaginaIds = { ids: string[]; total: number };

async function paginaPorEstado(
  cuenta: CuentaOptimizacion,
  token: string,
  estado: "active" | "paused",
  offset: number,
  limite: number,
  q: string
): Promise<PaginaIds> {
  const base = { estado, offset, limite };
  if (!q) return conReintento429(() => listarItemsVendedorMl(cuenta.cuentaIdExterna, token, base));
  // Con texto: primero por SKU (seller_sku); si no hay coincidencias, por
  // título (q).
  const porSku = await conReintento429(() => listarItemsVendedorMl(cuenta.cuentaIdExterna, token, { ...base, sku: q }));
  if (porSku.total > 0) return porSku;
  return conReintento429(() => listarItemsVendedorMl(cuenta.cuentaIdExterna, token, { ...base, titulo: q }));
}

// "Todas" = activas y luego pausadas, como UNA sola lista paginada.
async function idsDeLaPagina(cuenta: CuentaOptimizacion, token: string, filtro: FiltroOptimizacion): Promise<PaginaIds> {
  const limite = TAMANO_PAGINA_OPTIMIZACION;
  const offset = (filtro.pagina - 1) * limite;
  if (filtro.estado !== "todas") return paginaPorEstado(cuenta, token, filtro.estado, offset, limite, filtro.q);

  const [activas, conteoPausadas] = await Promise.all([
    paginaPorEstado(cuenta, token, "active", offset, limite, filtro.q),
    paginaPorEstado(cuenta, token, "paused", 0, 1, filtro.q),
  ]);
  const ids = [...activas.ids];
  if (ids.length < limite) {
    const desdePausadas = Math.max(0, offset - activas.total);
    const pausadas = await paginaPorEstado(cuenta, token, "paused", desdePausadas, limite - ids.length, filtro.q);
    ids.push(...pausadas.ids);
  }
  return { ids, total: activas.total + conteoPausadas.total };
}

export async function cargarListaBase(cuenta: CuentaOptimizacion, token: string, filtro: FiltroOptimizacion): Promise<ListaBase> {
  const idDirecto = filtro.q ? normalizarIdBuscado(filtro.q) : null;
  const { ids, total } = idDirecto ? { ids: [idDirecto], total: 1 } : await idsDeLaPagina(cuenta, token, filtro);

  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_MULTIGET_ML) lotes.push(ids.slice(i, i + MAX_IDS_MULTIGET_ML));
  const detalles = (await conConcurrenciaLimitada(lotes, 3, (lote) => conReintento429(() => leerItemsListadoMl(lote, token)))).flat();

  const porId = new Map(detalles.map((d) => [d.itemId, d]));
  // Se conserva el orden de ML y se descarta lo que no sea de ESTA cuenta
  // (el multiget acepta ids de cualquier vendedor: así una búsqueda por
  // id ajeno nunca muestra la publicación de otro).
  let filas = ids.map((id) => porId.get(id)).filter((d): d is ItemListadoMl => d != null && d.vendedorId === cuenta.cuentaIdExterna);
  if (idDirecto && filtro.estado !== "todas") filas = filas.filter((f) => f.status === filtro.estado);
  return { filas, total: idDirecto ? filas.length : total };
}

// ---------- ventas por ítem (base primero, ML de respaldo) ----------

// ¿Esta cuenta ya tiene ventas sincronizadas por Finanzas
// (lib/ml/trabajador.ts + lib/ml/ventas-finanzas.ts)?
export async function cuentaTieneVentasSincronizadas(empresaId: string, cuentaId: string): Promise<boolean> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx.select({ id: pedidosFinanzas.id }).from(pedidosFinanzas).where(eq(pedidosFinanzas.cuentaMlId, cuentaId)).limit(1)
  );
  return filas.length > 0;
}

// Unidades vendidas por item_id_externo en [desde, hasta], sin las
// órdenes canceladas. Rango cualquiera (la página de detalle de la
// Parte 2 la reutiliza).
export async function consultarVentasPorItemDeBase(empresaId: string, cuentaId: string, desde: Date, hasta: Date): Promise<Record<string, number>> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ itemId: pedidoItems.itemIdExterno, unidades: sql<number>`coalesce(sum(${pedidoItems.cantidad}), 0)::int` })
      .from(pedidoItems)
      .innerJoin(pedidosFinanzas, and(eq(pedidosFinanzas.empresaId, pedidoItems.empresaId), eq(pedidosFinanzas.pedidoId, pedidoItems.pedidoId)))
      .innerJoin(pedidos, eq(pedidos.id, pedidosFinanzas.pedidoId))
      .where(
        and(
          eq(pedidosFinanzas.cuentaMlId, cuentaId),
          eq(pedidosFinanzas.cancelada, false),
          gte(pedidos.fecha, desde),
          lte(pedidos.fecha, hasta)
        )
      )
      .groupBy(pedidoItems.itemIdExterno)
  );
  const resultado: Record<string, number> = {};
  for (const fila of filas) resultado[fila.itemId] = Number(fila.unidades);
  return resultado;
}

async function ventasPorItemDeMl(cuenta: CuentaOptimizacion, token: string, desde: Date, hasta: Date): Promise<Record<string, number>> {
  const lineas = [];
  for (let pagina = 0; pagina < MAX_PAGINAS_ORDENES; pagina++) {
    const { ordenes, total } = await conReintento429(() => buscarOrdenesVendedorMl(cuenta.cuentaIdExterna, token, { desde, hasta }, pagina * 50, 50));
    lineas.push(...lineasDeOrdenesMl(ordenes));
    if ((pagina + 1) * 50 >= total || ordenes.length === 0) break;
  }
  return ventasPorItemEnRango(lineas, desde, hasta);
}

// Una sola consulta para toda la cuenta (nunca una por publicación).
export async function cargarVentasPorItem(
  empresaId: string,
  cuenta: CuentaOptimizacion,
  token: string,
  rango: { desde: Date; hasta: Date } = rangoUltimosDias(DIAS_METRICAS)
): Promise<Record<string, number>> {
  if (await cuentaTieneVentasSincronizadas(empresaId, cuenta.id)) return consultarVentasPorItemDeBase(empresaId, cuenta.id, rango.desde, rango.hasta);
  return ventasPorItemDeMl(cuenta, token, rango.desde, rango.hasta);
}

// ---------- métricas por ítem (solo la página visible) ----------

export type MapaMetrica<T> = Map<string, T | null>;

// Pide `leer` para cada ítem con concurrencia limitada. Un fallo en un
// ítem deja ESE valor en null; nunca tumba a los demás.
async function porItem<T>(ids: string[], leer: (id: string) => Promise<T | null>): Promise<MapaMetrica<T>> {
  const resultados = await conConcurrenciaLimitada(ids, CONCURRENCIA_METRICAS, async (id) => {
    try {
      return await conReintento429(() => leer(id));
    } catch {
      return null;
    }
  });
  return new Map(ids.map((id, i) => [id, resultados[i]]));
}

export function cargarVisitas(ids: string[], token: string): Promise<MapaMetrica<number>> {
  return porItem(ids, (id) => leerVisitasItemMl(id, token, DIAS_METRICAS));
}

export function cargarPreciosPromocion(ids: string[], token: string): Promise<MapaMetrica<PrecioPromocionMl>> {
  return porItem(ids, (id) => leerPrecioPromocionMl(id, token));
}

export function cargarCalidad(ids: string[], token: string): Promise<MapaMetrica<CalidadItem>> {
  return porItem(ids, async (id) => resumirCalidad(await leerCalidadItemMl(id, token)));
}

// price_to_win SOLO para ítems de catálogo (para los demás da 4xx: ni se
// llama). El siteId sale de la cuenta.
export function cargarCompetencia(filas: readonly ItemListadoMl[], siteId: string, token: string): Promise<MapaMetrica<CompetenciaItem>> {
  const porId = new Map(filas.map((f) => [f.itemId, f]));
  return porItem(
    filas.map((f) => f.itemId),
    async (id) => {
      const esCatalogo = porId.get(id)?.esCatalogo === true;
      if (!esCatalogo) return interpretarCompetencia(false, null);
      return interpretarCompetencia(true, await leerPriceToWinMl(id, siteId, token));
    }
  );
}

export function cargarVentasDeFilas(empresaId: string, cuenta: CuentaOptimizacion, token: string): Promise<Record<string, number> | null> {
  return cargarVentasPorItem(empresaId, cuenta, token).catch(() => null);
}
