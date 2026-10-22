// Tarea "Investigación ML" — primer módulo que necesita hablar con el
// catálogo PÚBLICO de Mercado Libre (no con los pedidos/despachos de
// una cuenta propia), así que es también el primero en existir de
// lib/ml/cliente.ts: a partir de ahora, toda llamada nueva a la API de
// Mercado Libre pasa por acá (regla de CLAUDE.md) — nunca un fetch
// suelto en otro archivo de lib/ml/.
//
// Cada forma de respuesta de acá está confirmada contra el código real
// que ya corre en producción en zilonix-os-web (lib/busqueda-productos.js
// y lib/mercadolibre-publicar.js) — no inventada. Documentado puntual
// donde corresponde.

const BASE_URL = "https://api.mercadolibre.com";

// Colombia, único país en alcance de esta tarea (Parte 1). Si algún
// día se opera en otro país, esto pasa a depender del site_id de la
// empresa, no antes — igual que DOMINIO_AUTORIZACION en lib/ml/oauth.ts.
export const SITE_ID = "MCO";

async function pedir<T>(url: string, token: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as T };
}

function fotoDe(pictures: unknown): string | null {
  const primera = Array.isArray(pictures) ? pictures[0] : null;
  if (typeof primera === "string") return primera;
  if (primera && typeof primera === "object" && typeof (primera as { url?: unknown }).url === "string") {
    return (primera as { url: string }).url;
  }
  return null;
}

export type ProductoCatalogoMl = { id: string; nombre: string | null; foto: string | null };

// Fuente 1 de candidatos — relevancia de TEXTO real sobre el catálogo
// de Mercado Libre. Confirmado en producción (zilonix-os-web): no
// ordena por ventas/popularidad, solo por coincidencia de texto en el
// nombre — por eso se combina con obtenerMejoresProductosCategoria.
// status=active filtra en el servidor los productos con al menos una
// oferta vigente.
export async function buscarProductosCatalogo(termino: string, token: string, offset = 0, limite = 20): Promise<ProductoCatalogoMl[]> {
  const url = `${BASE_URL}/products/search?site_id=${SITE_ID}&q=${encodeURIComponent(termino)}&status=active&limit=${limite}&offset=${offset}`;
  const resp = await pedir<{ results?: unknown[] }>(url, token);
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`Mercado Libre respondió ${resp.status} al buscar "${termino}" en el catálogo.`);
  }
  const resultados = Array.isArray(resp.data.results) ? resp.data.results : [];
  return resultados.map((r) => {
    const item = r as { id?: unknown; name?: unknown; pictures?: unknown };
    return {
      id: String(item.id ?? ""),
      nombre: typeof item.name === "string" ? item.name : null,
      foto: fotoDe(item.pictures),
    };
  }).filter((p) => p.id);
}

export type CategoriaMl = { categoryId: string };

// Fuente 2 — a qué categoría pertenece el término (domain_discovery),
// para después pedir los más vendidos reales de esa categoría.
// Devuelve null (nunca lanza) cuando Mercado Libre no encuentra
// ninguna categoría: en Investigación esto es solo un enriquecimiento
// — la fuente 1 (texto) ya alcanza para mostrar algo.
export async function resolverCategoria(termino: string, token: string): Promise<CategoriaMl | null> {
  const url = `${BASE_URL}/sites/${SITE_ID}/domain_discovery/search?q=${encodeURIComponent(termino)}&limit=1`;
  const resp = await pedir<unknown>(url, token);
  if (!resp.ok) return null;
  const primero = Array.isArray(resp.data) ? (resp.data[0] as { category_id?: unknown } | undefined) : undefined;
  const categoryId = primero && typeof primero.category_id === "string" ? primero.category_id : null;
  return categoryId ? { categoryId } : null;
}

// Los más vendidos REALES de una categoría (highlights BEST_SELLER) —
// complementa la búsqueda por texto con productos que el texto solo no
// encuentra (confirmado en producción con el caso real documentado en
// zilonix-os-web/lib/busqueda-productos.js). Solo da ids.
export async function obtenerMejoresProductosCategoria(categoryId: string, token: string): Promise<string[]> {
  const url = `${BASE_URL}/highlights/${SITE_ID}/category/${categoryId}`;
  const resp = await pedir<{ content?: unknown[] }>(url, token);
  if (!resp.ok) return [];
  const contenido = Array.isArray(resp.data.content) ? resp.data.content : [];
  return contenido.map((c) => (c as { id?: unknown }).id).filter((id): id is string => typeof id === "string");
}

// Nombre + foto de un product_id de catálogo — solo se usa para
// completar los candidatos que vinieron de obtenerMejoresProductosCategoria
// (que no trae esos datos), nunca para los que ya vinieron de
// buscarProductosCatalogo.
export async function obtenerProducto(productId: string, token: string): Promise<ProductoCatalogoMl | null> {
  const url = `${BASE_URL}/products/${productId}`;
  const resp = await pedir<{ name?: unknown; pictures?: unknown }>(url, token);
  if (!resp.ok) return null;
  return { id: productId, nombre: typeof resp.data.name === "string" ? resp.data.name : null, foto: fotoDe(resp.data.pictures) };
}

export type OfertaMl = {
  itemId: string;
  precio: number;
  monedaId: string;
  sellerId: string | null;
  esFull: boolean;
  // null = Mercado Libre no mandó este campo en esta oferta puntual —
  // nunca se interpreta como "no tiene envío gratis" (eso sería
  // inventar un dato que no vino). Sin precedente confirmado contra
  // producción de zilonix-os-web para este campo puntual (ese código
  // nunca lo leyó) — se lee de forma defensiva y el panel solo muestra
  // el % cuando al menos una oferta real sí trajo el dato.
  esEnvioGratis: boolean | null;
};

// Ofertas reales (publicaciones activas) de un producto de catálogo.
// Confirmado en producción: muchos productos de catálogo dan 404 acá —
// no es un bloqueo, es que ese producto puntual no tiene NINGUNA oferta
// real asociada (el vendedor publicó sin enlazarlo al catálogo). Se
// devuelve [] en vez de lanzar: la lógica de negocio decide qué hacer
// con "sin ofertas", no este cliente.
export async function obtenerOfertasProducto(productId: string, token: string): Promise<OfertaMl[]> {
  const url = `${BASE_URL}/products/${productId}/items`;
  const resp = await pedir<unknown>(url, token);
  if (!resp.ok) return [];
  const data = resp.data as { results?: unknown[] } | unknown[];
  const lista = Array.isArray(data) ? data : Array.isArray((data as { results?: unknown[] }).results) ? (data as { results: unknown[] }).results : [];
  return lista
    .map((raw) => {
      const item = raw as { item_id?: unknown; id?: unknown; price?: unknown; currency_id?: unknown; seller_id?: unknown; shipping?: { logistic_type?: unknown; free_shipping?: unknown } };
      const itemId = item.item_id ?? item.id;
      if (typeof itemId !== "string" && typeof itemId !== "number") return null;
      const precio = Number(item.price);
      if (!Number.isFinite(precio) || precio <= 0) return null;
      const envioGratis = typeof item.shipping?.free_shipping === "boolean" ? item.shipping.free_shipping : null;
      return {
        itemId: String(itemId),
        precio,
        monedaId: typeof item.currency_id === "string" ? item.currency_id : "COP",
        sellerId: item.seller_id != null ? String(item.seller_id) : null,
        esFull: item.shipping?.logistic_type === "fulfillment",
        esEnvioGratis: envioGratis,
      };
    })
    .filter((o): o is OfertaMl => o !== null);
}

export type VendedorMl = { nickname: string | null; esPlatinum: boolean };

export async function obtenerVendedor(sellerId: string, token: string): Promise<VendedorMl | null> {
  const url = `${BASE_URL}/users/${sellerId}`;
  const resp = await pedir<{ nickname?: unknown; seller_reputation?: { power_seller_status?: unknown } }>(url, token);
  if (!resp.ok) return null;
  return {
    nickname: typeof resp.data.nickname === "string" ? resp.data.nickname : null,
    esPlatinum: resp.data.seller_reputation?.power_seller_status === "platinum",
  };
}

// Link real de la publicación — confirmado en producción (zilonix-os-web):
// articulo.mercadolibre.com.co/MCO-{numero} redirige a la ficha exacta,
// sin pasar por /items/{id} (que da 403 para publicaciones ajenas).
export function linkPublicacion(itemId: string): string | null {
  const conGuion = itemId.replace(/^([A-Z]+)(\d+)$/, "$1-$2");
  return conGuion ? `https://articulo.mercadolibre.com.co/${conGuion}` : null;
}
