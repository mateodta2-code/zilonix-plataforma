import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { costosSku, pedidoItems, pedidos, terceros } from "@/db/schema";
import { normalizarSkuCodigo } from "@/lib/sku-normalizar";

// Issue #280 — la "ficha" de cada fila de /panel/inventario (estilo
// Zilonix OS): foto, costo, venta y proveedor. Solo lectura, sin
// migración y sin llamar a Mercado Libre.
//
// FOTO: `skus` no tiene columna de imagen; mientras no la tenga (tarea
// futura con migración), sale de la venta más reciente del SKU
// (pedido_items.imagen_url, la miniatura de ML).
export type FichaProducto = {
  fotoUrl: string | null;
  // numeric de Postgres: llega como string y nunca pasa por Number()
  // (pierde centavos). "0.00" es un costo real, no "sin dato".
  costo: string | null;
  precioVenta: string | null;
  proveedorNombre: string | null;
};

export type FilaCostoFicha = { skuCodigo: string; costo: string | null; precioVenta: string | null; proveedorNombre: string | null };
export type FilaFotoFicha = { skuCodigo: string | null; imagenUrl: string | null };

// Código normalizado igual que la maestra (upper(btrim)); un código
// inválido (vacío) se salta en vez de romper la página.
function codigoNormalizado(codigo: string): string | null {
  try {
    return normalizarSkuCodigo(codigo);
  } catch {
    return null;
  }
}

// Paso puro "filas de la base → Map por skuId", para probarlo sin base.
// Todo SKU del lote sale en el Map, aunque no tenga ningún dato.
export function armarFichas(lote: { id: string; codigo: string }[], costos: FilaCostoFicha[], fotos: FilaFotoFicha[]): Map<string, FichaProducto> {
  const costoPorCodigo = new Map(costos.map((c) => [c.skuCodigo, c]));
  const fotoPorCodigo = new Map<string, string>();
  for (const f of fotos) {
    if (f.skuCodigo && f.imagenUrl && !fotoPorCodigo.has(f.skuCodigo)) fotoPorCodigo.set(f.skuCodigo, f.imagenUrl);
  }
  const fichas = new Map<string, FichaProducto>();
  for (const s of lote) {
    const codigo = codigoNormalizado(s.codigo);
    const c = codigo ? costoPorCodigo.get(codigo) : undefined;
    fichas.set(s.id, {
      fotoUrl: (codigo && fotoPorCodigo.get(codigo)) ?? null,
      costo: c?.costo ?? null,
      precioVenta: c?.precioVenta ?? null,
      proveedorNombre: c?.proveedorNombre ?? null,
    });
  }
  return fichas;
}

// Solo los SKU de la página (nunca toda la empresa): 2 consultas como
// máximo por carga. empresaId explícito en cada tabla, también en los
// joins, además de RLS.
export async function leerFichasProducto(empresaId: string, lote: { id: string; codigo: string }[]): Promise<Map<string, FichaProducto>> {
  if (lote.length === 0) return new Map();
  const codigos = [...new Set(lote.map((s) => codigoNormalizado(s.codigo)).filter((c): c is string => c !== null))];
  if (codigos.length === 0) return armarFichas(lote, [], []);

  const { costos, fotos } = await dbComoEmpresa(empresaId, async (tx) => {
    const costos = await tx
      .select({ skuCodigo: costosSku.skuCodigo, costo: costosSku.costo, precioVenta: costosSku.precioVenta, proveedorNombre: terceros.nombre })
      .from(costosSku)
      .leftJoin(terceros, and(eq(terceros.id, costosSku.terceroId), eq(terceros.empresaId, empresaId)))
      .where(and(eq(costosSku.empresaId, empresaId), inArray(costosSku.skuCodigo, codigos)));
    // pedido_items.pedido_id = pedidos.id (FK vía pedidos_finanzas):
    // una foto por código, la de la venta más reciente.
    const fotos = await tx
      .selectDistinctOn([pedidoItems.skuCodigo], { skuCodigo: pedidoItems.skuCodigo, imagenUrl: pedidoItems.imagenUrl })
      .from(pedidoItems)
      .innerJoin(pedidos, and(eq(pedidos.id, pedidoItems.pedidoId), eq(pedidos.empresaId, empresaId)))
      .where(and(eq(pedidoItems.empresaId, empresaId), inArray(pedidoItems.skuCodigo, codigos), isNotNull(pedidoItems.imagenUrl)))
      .orderBy(pedidoItems.skuCodigo, desc(pedidos.fecha));
    return { costos, fotos };
  });
  return armarFichas(lote, costos, fotos);
}
