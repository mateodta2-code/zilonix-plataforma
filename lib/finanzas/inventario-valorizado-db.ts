import { and, eq, inArray, max } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas, costosSku, cuentasMl, kardexMovimientos, ordenCompraItems, ordenesCompra, publicaciones, skus, stockBodega, terceros } from "@/db/schema";
import { codigosParaMaestra, type MaestraSku } from "./combo-sku";
import {
  monedaDeEmpresa,
  totalEnCamino,
  totalizarInventario,
  valorizarEnCamino,
  valorizarStock,
  type LineaEnCamino,
  type LineaValorizada,
  type TotalesInventario,
} from "./inventario-valorizado";
import { normalizarSkuCodigo } from "@/lib/sku-normalizar";

// Issue #422 — lectura del inventario valorizado. Solo lee, siempre con
// dbComoEmpresa (RLS): las filas de otra empresa no existen para esta
// consulta. Bodegas y Full salen de stock_bodega (el WMS); Falabella
// todavía no tiene stock en la plataforma.

export type BodegaFull = { id: string; nombre: string; ultimoMovimiento: Date | null };
export type Tienda = { id: string; nombre: string };

export type InventarioValorizado = {
  moneda: string;
  lineas: LineaValorizada[];
  totales: TotalesInventario;
  enCamino: { lineas: LineaEnCamino[]; total: string; lineasSinCosto: number };
  // Para mostrar que el stock de Full es cargado a mano.
  bodegasFull: BodegaFull[];
  tiendas: Tienda[];
  // skuId → cuentas de ML donde está publicado (filtro de tienda).
  tiendasPorSku: Map<string, Set<string>>;
};

function codigoSeguro(codigo: string): string | null {
  try {
    return normalizarSkuCodigo(codigo);
  } catch {
    return null;
  }
}

export async function leerInventarioValorizado(empresaId: string): Promise<InventarioValorizado> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const saldos = await tx
      .select({
        skuId: stockBodega.skuId,
        codigo: skus.codigo,
        nombre: skus.nombre,
        bodegaId: stockBodega.bodegaId,
        bodegaNombre: bodegas.nombre,
        tipoBodega: bodegas.tipo,
        disponible: stockBodega.disponible,
        reservado: stockBodega.reservado,
      })
      .from(stockBodega)
      .innerJoin(bodegas, and(eq(bodegas.empresaId, stockBodega.empresaId), eq(bodegas.id, stockBodega.bodegaId)))
      .innerJoin(skus, and(eq(skus.empresaId, stockBodega.empresaId), eq(skus.id, stockBodega.skuId)))
      .where(eq(stockBodega.empresaId, empresaId));

    const pendientes = await tx
      .select({
        ordenNumero: ordenesCompra.numero,
        skuId: ordenCompraItems.skuId,
        codigo: skus.codigo,
        nombre: skus.nombre,
        cantidadPedida: ordenCompraItems.cantidadPedida,
        cantidadRecibida: ordenCompraItems.cantidadRecibida,
        costoOrden: ordenCompraItems.costoUnitario,
      })
      .from(ordenCompraItems)
      .innerJoin(ordenesCompra, and(eq(ordenesCompra.empresaId, ordenCompraItems.empresaId), eq(ordenesCompra.id, ordenCompraItems.ordenCompraId)))
      .innerJoin(skus, and(eq(skus.empresaId, ordenCompraItems.empresaId), eq(skus.id, ordenCompraItems.skuId)))
      .where(and(eq(ordenCompraItems.empresaId, empresaId), inArray(ordenesCompra.estado, ["abierta", "parcial"])));

    const codigos = codigosParaMaestra(
      [...saldos, ...pendientes].map((s) => codigoSeguro(s.codigo)).filter((c): c is string => c !== null)
    );
    const filasMaestra = codigos.length
      ? await tx
          .select({
            skuCodigo: costosSku.skuCodigo,
            costo: costosSku.costo,
            empaque: costosSku.empaque,
            envioAgencia: costosSku.envioAgencia,
            empaqueProveedor: terceros.empaque,
          })
          .from(costosSku)
          .leftJoin(terceros, and(eq(terceros.id, costosSku.terceroId), eq(terceros.empresaId, costosSku.empresaId)))
          .where(and(eq(costosSku.empresaId, empresaId), inArray(costosSku.skuCodigo, codigos)))
      : [];
    const maestra = new Map<string, MaestraSku>(filasMaestra.map(({ skuCodigo, ...resto }) => [skuCodigo, resto]));

    const full = await tx
      .select({ id: bodegas.id, nombre: bodegas.nombre, ultimoMovimiento: max(kardexMovimientos.ts) })
      .from(bodegas)
      .leftJoin(kardexMovimientos, and(eq(kardexMovimientos.empresaId, bodegas.empresaId), eq(kardexMovimientos.bodegaId, bodegas.id)))
      .where(and(eq(bodegas.empresaId, empresaId), eq(bodegas.tipo, "fulfillment_ml")))
      .groupBy(bodegas.id, bodegas.nombre)
      .orderBy(bodegas.nombre);

    const cuentas = await tx
      .select({ id: cuentasMl.id, nombre: cuentasMl.nickname, moneda: cuentasMl.moneda })
      .from(cuentasMl)
      .where(eq(cuentasMl.empresaId, empresaId))
      .orderBy(cuentasMl.nickname);

    const skuIds = [...new Set(saldos.map((s) => s.skuId))];
    const publicadas = skuIds.length
      ? await tx
          .selectDistinct({ skuId: publicaciones.skuId, cuentaMlId: publicaciones.cuentaMlId })
          .from(publicaciones)
          .where(and(eq(publicaciones.empresaId, empresaId), inArray(publicaciones.skuId, skuIds)))
      : [];
    const tiendasPorSku = new Map<string, Set<string>>();
    for (const p of publicadas) {
      if (!p.skuId) continue;
      const set = tiendasPorSku.get(p.skuId) ?? new Set<string>();
      set.add(p.cuentaMlId);
      tiendasPorSku.set(p.skuId, set);
    }

    const lineas = valorizarStock(saldos, maestra);
    const lineasEnCamino = valorizarEnCamino(pendientes, maestra);
    return {
      moneda: monedaDeEmpresa(cuentas.map((c) => c.moneda)),
      lineas,
      totales: totalizarInventario(lineas),
      enCamino: { lineas: lineasEnCamino, ...totalEnCamino(lineasEnCamino) },
      bodegasFull: full.map((f) => ({ id: f.id, nombre: f.nombre, ultimoMovimiento: f.ultimoMovimiento ?? null })),
      tiendas: cuentas.map(({ id, nombre }) => ({ id, nombre })),
      tiendasPorSku,
    };
  });
}
