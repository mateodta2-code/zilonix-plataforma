import { and, asc, eq, ilike } from "drizzle-orm";
import { dbComoBodega } from "@/db/bodega-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { empresas, stockBodega3pl } from "@/db/schema";

export type FilaStockBodega = { empresaId: string; empresaNombre: string; sku: string; cantidad: number };

// % y _ del buscador se escapan: se busca el texto tal cual, nunca un patrón.
function patron(busqueda: string): string {
  return `%${busqueda.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// Stock de la bodega activa por empresa y SKU (solo lectura).
export async function listarStockBodega(bodegaId: string, filtro: { busqueda?: string; empresaId?: string } = {}, limite = 500): Promise<FilaStockBodega[]> {
  return dbComoBodega(bodegaId, (tx) => {
    const condiciones = [eq(stockBodega3pl.bodegaId, bodegaId)];
    if (filtro.empresaId) condiciones.push(eq(stockBodega3pl.empresaId, filtro.empresaId));
    if (filtro.busqueda?.trim()) condiciones.push(ilike(stockBodega3pl.sku, patron(filtro.busqueda)));
    return tx
      .select({ empresaId: stockBodega3pl.empresaId, empresaNombre: empresas.nombre, sku: stockBodega3pl.sku, cantidad: stockBodega3pl.cantidad })
      .from(stockBodega3pl)
      .innerJoin(empresas, eq(empresas.id, stockBodega3pl.empresaId))
      .where(and(...condiciones))
      .orderBy(asc(empresas.nombre), asc(stockBodega3pl.sku))
      .limit(limite);
  });
}

// Lo que ve el vendedor en /panel/bodegas: solo SU stock, de cualquier
// bodega que lo atienda (RLS por empresa; sin nombres de otras empresas).
export async function listarStockDeEmpresa(empresaId: string, busqueda?: string, limite = 500): Promise<{ bodegaId: string; sku: string; cantidad: number }[]> {
  return dbComoEmpresa(empresaId, (tx) => {
    const condiciones = [eq(stockBodega3pl.empresaId, empresaId)];
    if (busqueda?.trim()) condiciones.push(ilike(stockBodega3pl.sku, patron(busqueda)));
    return tx
      .select({ bodegaId: stockBodega3pl.bodegaId, sku: stockBodega3pl.sku, cantidad: stockBodega3pl.cantidad })
      .from(stockBodega3pl)
      .where(and(...condiciones))
      .orderBy(asc(stockBodega3pl.sku))
      .limit(limite);
  });
}
