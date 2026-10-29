import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas, kardexMovimientos, kitComponentes, skus, stockBodega, usuarios } from "@/db/schema";
import { stockDerivadoKit } from "@/lib/inventario/calculos";
import { escaparComodinesLike, normalizarTextoBusqueda } from "@/lib/filtros-listado";

// Issue #280 — lecturas del inventario (nunca escriben: eso es solo
// lib/inventario/movimientos.ts).

type Tx = typeof db;

// Disponible que cuenta para ML, por SKU: suma de las bodegas activas
// marcadas "suma al publicado" (Full queda afuera por defecto). Para un
// kit, cuántos se pueden armar con ese mismo disponible de sus
// componentes. Es el número ANTES de restar el colchón (buffer_ml).
export async function disponiblePublicadoTx(tx: Tx, empresaId: string, skuIds: string[]): Promise<Map<string, number>> {
  const resultado = new Map<string, number>();
  if (skuIds.length === 0) return resultado;
  const info = await tx.select({ id: skus.id, esKit: skus.esKit }).from(skus).where(inArray(skus.id, skuIds));
  const kitIds = info.filter((s) => s.esKit).map((s) => s.id);
  const componentes = kitIds.length
    ? await tx
        .select({ kitId: kitComponentes.skuKitId, skuId: kitComponentes.skuComponenteId, cantidad: kitComponentes.cantidad })
        .from(kitComponentes)
        .where(inArray(kitComponentes.skuKitId, kitIds))
    : [];
  const simples = [...new Set([...info.filter((s) => !s.esKit).map((s) => s.id), ...componentes.map((c) => c.skuId)])];
  const sumas = simples.length
    ? await tx
        .select({ skuId: stockBodega.skuId, total: sql<number>`coalesce(sum(${stockBodega.disponible}), 0)::int` })
        .from(stockBodega)
        .innerJoin(bodegas, and(eq(bodegas.empresaId, stockBodega.empresaId), eq(bodegas.id, stockBodega.bodegaId)))
        .where(and(eq(stockBodega.empresaId, empresaId), inArray(stockBodega.skuId, simples), eq(bodegas.activa, true), eq(bodegas.sumaAlPublicado, true)))
        .groupBy(stockBodega.skuId)
    : [];
  const porSku = new Map(sumas.map((s) => [s.skuId, Number(s.total)]));
  for (const s of info) {
    resultado.set(
      s.id,
      s.esKit
        ? stockDerivadoKit(
            componentes.filter((c) => c.kitId === s.id),
            porSku
          )
        : (porSku.get(s.id) ?? 0)
    );
  }
  return resultado;
}

export async function disponiblePublicado(empresaId: string, skuIds: string[]): Promise<Map<string, number>> {
  return dbComoEmpresa(empresaId, (tx) => disponiblePublicadoTx(tx, empresaId, skuIds));
}

export type SaldoEnBodega = { bodegaId: string; disponible: number; reservado: number; enTransito: number };
export type FilaInventario = {
  skuId: string;
  codigo: string;
  nombre: string;
  esKit: boolean;
  porBodega: SaldoEnBodega[];
  totalDisponible: number;
  totalReservado: number;
  // Lo que cuenta para ML (sin restar el colchón).
  publicable: number;
};

export const TAMANO_PAGINA_INVENTARIO = 50;

// Una fila por SKU (los kits también, con su stock derivado), con el
// saldo de cada bodega. Búsqueda por código o nombre, mismo criterio
// que /panel/sku.
export async function listarInventario(
  empresaId: string,
  filtro: { busqueda?: string; pagina?: number } = {}
): Promise<{ filas: FilaInventario[]; total: number; pagina: number; totalPaginas: number }> {
  const busqueda = normalizarTextoBusqueda(filtro.busqueda);
  return dbComoEmpresa(empresaId, async (tx) => {
    const condiciones: SQL[] = [eq(skus.empresaId, empresaId)];
    if (busqueda) {
      const patron = `%${escaparComodinesLike(busqueda)}%`;
      condiciones.push(or(ilike(skus.codigo, patron), ilike(skus.nombre, patron))!);
    }
    const where = and(...condiciones);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(skus).where(where);
    const totalPaginas = Math.max(1, Math.ceil(Number(total) / TAMANO_PAGINA_INVENTARIO));
    const pagina = Math.min(Math.max(1, Math.trunc(filtro.pagina ?? 1) || 1), totalPaginas);
    const pageSkus = await tx
      .select({ id: skus.id, codigo: skus.codigo, nombre: skus.nombre, esKit: skus.esKit })
      .from(skus)
      .where(where)
      .orderBy(asc(skus.codigo))
      .limit(TAMANO_PAGINA_INVENTARIO)
      .offset((pagina - 1) * TAMANO_PAGINA_INVENTARIO);
    const ids = pageSkus.map((s) => s.id);
    const saldos = ids.length
      ? await tx
          .select({
            skuId: stockBodega.skuId,
            bodegaId: stockBodega.bodegaId,
            disponible: stockBodega.disponible,
            reservado: stockBodega.reservado,
            enTransito: stockBodega.enTransito,
          })
          .from(stockBodega)
          .where(and(eq(stockBodega.empresaId, empresaId), inArray(stockBodega.skuId, ids)))
      : [];
    const publicable = await disponiblePublicadoTx(tx, empresaId, ids);
    const filas = pageSkus.map((s) => {
      const porBodega = saldos.filter((x) => x.skuId === s.id).map(({ skuId: _skuId, ...resto }) => resto);
      return {
        skuId: s.id,
        codigo: s.codigo,
        nombre: s.nombre,
        esKit: s.esKit,
        porBodega,
        totalDisponible: porBodega.reduce((n, b) => n + b.disponible, 0),
        totalReservado: porBodega.reduce((n, b) => n + b.reservado, 0),
        publicable: publicable.get(s.id) ?? 0,
      };
    });
    return { filas, total: Number(total), pagina, totalPaginas };
  });
}

export type FilaKardex = {
  id: string;
  ts: Date;
  tipo: (typeof kardexMovimientos.$inferSelect)["tipo"];
  origen: (typeof kardexMovimientos.$inferSelect)["origen"];
  skuCodigo: string;
  bodegaNombre: string;
  deltaDisponible: number;
  deltaReservado: number;
  saldoDisponible: number;
  saldoReservado: number;
  actorTipo: "persona" | "sistema";
  actorNombre: string | null;
  referenciaId: string | null;
  nota: string | null;
};

export const TAMANO_PAGINA_KARDEX = 50;

export async function listarKardex(
  empresaId: string,
  filtro: { skuId?: string; bodegaId?: string; pagina?: number } = {}
): Promise<{ filas: FilaKardex[]; pagina: number; hayMas: boolean }> {
  const pagina = Math.max(1, Math.trunc(filtro.pagina ?? 1) || 1);
  return dbComoEmpresa(empresaId, async (tx) => {
    const condiciones: SQL[] = [eq(kardexMovimientos.empresaId, empresaId)];
    if (filtro.skuId) condiciones.push(eq(kardexMovimientos.skuId, filtro.skuId));
    if (filtro.bodegaId) condiciones.push(eq(kardexMovimientos.bodegaId, filtro.bodegaId));
    // Se pide una fila de más para saber si hay página siguiente sin
    // contar toda la tabla (el kardex solo crece).
    const filas = await tx
      .select({
        id: kardexMovimientos.id,
        ts: kardexMovimientos.ts,
        tipo: kardexMovimientos.tipo,
        origen: kardexMovimientos.origen,
        skuCodigo: skus.codigo,
        bodegaNombre: bodegas.nombre,
        deltaDisponible: kardexMovimientos.deltaDisponible,
        deltaReservado: kardexMovimientos.deltaReservado,
        saldoDisponible: kardexMovimientos.saldoDisponible,
        saldoReservado: kardexMovimientos.saldoReservado,
        actorTipo: kardexMovimientos.actorTipo,
        actorNombre: usuarios.nombre,
        referenciaId: kardexMovimientos.referenciaId,
        nota: kardexMovimientos.nota,
      })
      .from(kardexMovimientos)
      .innerJoin(skus, and(eq(skus.empresaId, kardexMovimientos.empresaId), eq(skus.id, kardexMovimientos.skuId)))
      .innerJoin(bodegas, and(eq(bodegas.empresaId, kardexMovimientos.empresaId), eq(bodegas.id, kardexMovimientos.bodegaId)))
      .leftJoin(usuarios, eq(usuarios.id, kardexMovimientos.usuarioId))
      .where(and(...condiciones))
      .orderBy(desc(kardexMovimientos.ts), desc(kardexMovimientos.linea))
      .limit(TAMANO_PAGINA_KARDEX + 1)
      .offset((pagina - 1) * TAMANO_PAGINA_KARDEX);
    return { filas: filas.slice(0, TAMANO_PAGINA_KARDEX), pagina, hayMas: filas.length > TAMANO_PAGINA_KARDEX };
  });
}

// SKU simples (no kits) para los selectores de las pantallas de
// movimientos: un kit no se ajusta ni se recibe, se mueven sus partes.
export async function listarSkusConStock(empresaId: string): Promise<{ id: string; codigo: string; nombre: string }[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: skus.id, codigo: skus.codigo, nombre: skus.nombre })
      .from(skus)
      .where(and(eq(skus.empresaId, empresaId), eq(skus.esKit, false)))
      .orderBy(asc(skus.codigo))
  );
}
