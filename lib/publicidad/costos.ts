// Issue #256 — la ÚNICA lectura de costos de Publicidad. Los costos son
// de Finanzas (tabla maestra costos_sku, #127): Publicidad los lee y
// nunca los escribe (decisión del equipo, 27-oct). Si Finanzas cambia
// de fuente, se cambia solo este archivo.

import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db/index";
import { costosSku, terceros } from "@/db/schema";
import { packingEfectivo } from "@/lib/costos-sku";
import type { CostoSkuPublicidad } from "@/lib/publicidad/ganancia";

export { skuDePublicacion, type CostoSkuPublicidad } from "@/lib/publicidad/ganancia";

// Costos de los SKU pedidos, por SKU normalizado. Un SKU que no está en
// la maestra no aparece en el mapa ("Sin costo"). Corre dentro de la
// transacción de dbComoEmpresa del llamador (RLS por empresa) y además
// filtra por empresa_id.
export async function leerCostosPorSku(tx: typeof db, empresaId: string, skus: Iterable<string>): Promise<Map<string, CostoSkuPublicidad>> {
  const buscados = [...new Set(skus)];
  if (buscados.length === 0) return new Map();
  const filas = await tx
    .select({
      skuCodigo: costosSku.skuCodigo,
      costo: costosSku.costo,
      empaque: costosSku.empaque,
      envioAgencia: costosSku.envioAgencia,
      empaqueProveedor: terceros.empaque,
    })
    .from(costosSku)
    .leftJoin(terceros, and(eq(terceros.id, costosSku.terceroId), eq(terceros.empresaId, costosSku.empresaId)))
    .where(and(eq(costosSku.empresaId, empresaId), inArray(costosSku.skuCodigo, buscados)));
  return new Map(
    filas.map((fila) => {
      const packing = packingEfectivo(fila.empaque, fila.empaqueProveedor);
      return [
        fila.skuCodigo,
        {
          costo: fila.costo,
          empaque: packing.sinDato ? null : packing.valor,
          envioAgencia: fila.envioAgencia,
        },
      ];
    }),
  );
}
