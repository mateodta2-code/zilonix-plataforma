import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { buscarItemsPorSkuMl, leerItemBasicoMl } from "@/lib/ml/cliente";

// Antes vivía en lib/ml/clip.ts junto al módulo de Clip, que se retiró
// por completo (pedido de Mateo). Esta búsqueda se conserva porque la
// usa "Importar por SKU propio" (app/panel/publicar/importadores/).

export type ItemEncontradoPorSku = { itemId: string; titulo: string; thumbnail: string | null };

// Mejora deliberada sobre el sistema actual (hallazgo §16.4 del reporte
// de investigación: "buscar-item-por-sku descarga el catálogo COMPLETO
// de la cuenta para encontrar un SKU" — costoso, sin motivo documentado
// para no usar la búsqueda real por seller_sku). Acá se usa el
// endpoint real GET /users/{id}/items/search?seller_sku= directamente.
export async function buscarItemPorSku(empresaId: string, cuenta: { id: string; cuentaIdExterna: string }, sku: string): Promise<ItemEncontradoPorSku | null> {
  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
  // Tarea 2.11, punto 2/3: fetch directo movido a lib/ml/cliente.ts —
  // buscarItemsPorSkuMl valida cuenta.cuentaIdExterna (/^\d+$/) antes
  // de armar la URL. El itemId que vuelve DE Mercado Libre (nunca de
  // nuestro propio formulario) también se valida — leerItemBasicoMl lo
  // exige antes de armar la segunda URL, no se confía en que el
  // primer endpoint haya devuelto algo bien formado.
  const resultados = await buscarItemsPorSkuMl(cuenta.cuentaIdExterna, sku, token);
  const itemId = resultados[0];
  if (!itemId) return null;

  const detalle = await leerItemBasicoMl(itemId, token);
  if (!detalle) return { itemId, titulo: itemId, thumbnail: null };
  return { itemId, titulo: detalle.title ?? itemId, thumbnail: detalle.thumbnail ?? null };
}
