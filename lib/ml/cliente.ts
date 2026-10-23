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

// Corrección de Pablo (PR #112): los id de producto/ítem y de
// categoría de Mercado Libre Colombia siempre son "MCO" + dígitos; el
// id de vendedor (user_id) es solo dígitos. Cualquier otra cosa no
// puede venir de verdad de la API — se descarta ANTES de armar la URL,
// nunca se pega texto sin validar a un fetch.
const PATRON_ID_PRODUCTO_O_ITEM = /^MCO\d+$/;
const PATRON_ID_CATEGORIA = /^MCO\d+$/;
const PATRON_ID_VENDEDOR = /^\d+$/;

// Tiempo máximo real por llamada — sin esto, una llamada colgada a
// Mercado Libre (red lenta, el proveedor caído) dejaba la búsqueda
// cargando para siempre; con el AbortSignal, a los 8s se corta y se
// trata como una respuesta no-ok (nunca una excepción no capturada).
const TIMEOUT_MS = 8_000;

export class LimiteMercadoLibreError extends Error {
  constructor() {
    super("Mercado Libre está limitando las consultas, intenta en un minuto.");
    this.name = "LimiteMercadoLibreError";
  }
}

async function pedir<T>(url: string, token: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    // Tiempo agotado (AbortError) o falla de red — se trata igual que
    // una respuesta no-ok, nunca se deja sin resolver.
    return { ok: false, status: 0 };
  }
  // 429 corta TODA la búsqueda, no solo esta llamada puntual — se
  // lanza en vez de devolver {ok:false}, para que ninguna de las
  // funciones de abajo lo trague en silencio como "sin datos".
  if (res.status === 429) throw new LimiteMercadoLibreError();
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
    if (resp.status === 0) throw new Error(`Mercado Libre no respondió a tiempo al buscar "${termino}" en el catálogo.`);
    throw new Error(`Mercado Libre respondió ${resp.status} al buscar "${termino}" en el catálogo.`);
  }
  const resultados = Array.isArray(resp.data.results) ? resp.data.results : [];
  return resultados
    .map((r) => {
      const item = r as { id?: unknown; name?: unknown; pictures?: unknown };
      return {
        id: typeof item.id === "string" ? item.id : "",
        nombre: typeof item.name === "string" ? item.name : null,
        foto: fotoDe(item.pictures),
      };
    })
    .filter((p) => PATRON_ID_PRODUCTO_O_ITEM.test(p.id));
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
  return categoryId && PATRON_ID_CATEGORIA.test(categoryId) ? { categoryId } : null;
}

// Los más vendidos REALES de una categoría (highlights BEST_SELLER) —
// complementa la búsqueda por texto con productos que el texto solo no
// encuentra (confirmado en producción con el caso real documentado en
// zilonix-os-web/lib/busqueda-productos.js). Solo da ids.
export async function obtenerMejoresProductosCategoria(categoryId: string, token: string): Promise<string[]> {
  if (!PATRON_ID_CATEGORIA.test(categoryId)) return [];
  const url = `${BASE_URL}/highlights/${SITE_ID}/category/${encodeURIComponent(categoryId)}`;
  const resp = await pedir<{ content?: unknown[] }>(url, token);
  if (!resp.ok) return [];
  const contenido = Array.isArray(resp.data.content) ? resp.data.content : [];
  return contenido
    .map((c) => (c as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string" && PATRON_ID_PRODUCTO_O_ITEM.test(id));
}

// Nombre + foto de un product_id de catálogo — solo se usa para
// completar los candidatos que vinieron de obtenerMejoresProductosCategoria
// (que no trae esos datos), nunca para los que ya vinieron de
// buscarProductosCatalogo.
export async function obtenerProducto(productId: string, token: string): Promise<ProductoCatalogoMl | null> {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(productId)) return null;
  const url = `${BASE_URL}/products/${encodeURIComponent(productId)}`;
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
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(productId)) return [];
  const url = `${BASE_URL}/products/${encodeURIComponent(productId)}/items`;
  const resp = await pedir<unknown>(url, token);
  if (!resp.ok) return [];
  const data = resp.data as { results?: unknown[] } | unknown[];
  const lista = Array.isArray(data) ? data : Array.isArray((data as { results?: unknown[] }).results) ? (data as { results: unknown[] }).results : [];
  return lista
    .map((raw) => {
      const item = raw as { item_id?: unknown; id?: unknown; price?: unknown; currency_id?: unknown; seller_id?: unknown; shipping?: { logistic_type?: unknown; free_shipping?: unknown } };
      const itemIdCrudo = item.item_id ?? item.id;
      const itemId = typeof itemIdCrudo === "string" || typeof itemIdCrudo === "number" ? String(itemIdCrudo) : "";
      if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
      const precio = Number(item.price);
      if (!Number.isFinite(precio) || precio <= 0) return null;
      const sellerIdCrudo = item.seller_id != null ? String(item.seller_id) : null;
      const envioGratis = typeof item.shipping?.free_shipping === "boolean" ? item.shipping.free_shipping : null;
      return {
        itemId,
        precio,
        monedaId: typeof item.currency_id === "string" ? item.currency_id : "COP",
        sellerId: sellerIdCrudo && PATRON_ID_VENDEDOR.test(sellerIdCrudo) ? sellerIdCrudo : null,
        esFull: item.shipping?.logistic_type === "fulfillment",
        esEnvioGratis: envioGratis,
      };
    })
    .filter((o): o is OfertaMl => o !== null);
}

export type VendedorMl = { nickname: string | null; esPlatinum: boolean };

export async function obtenerVendedor(sellerId: string, token: string): Promise<VendedorMl | null> {
  if (!PATRON_ID_VENDEDOR.test(sellerId)) return null;
  const url = `${BASE_URL}/users/${encodeURIComponent(sellerId)}`;
  const resp = await pedir<{ nickname?: unknown; seller_reputation?: { power_seller_status?: unknown } }>(url, token);
  if (!resp.ok) return null;
  return {
    nickname: typeof resp.data.nickname === "string" ? resp.data.nickname : null,
    esPlatinum: resp.data.seller_reputation?.power_seller_status === "platinum",
  };
}

// Z-FIN-00 (issue #122) — lectura cruda para el diagnóstico de acceso
// de scripts/finanzas/verificar-acceso-ml.ts. A diferencia de pedir():
// (1) solo GET, nunca otro método — el script es de solo lectura y
// esto lo garantiza en la puerta misma, no en quien la llama; (2) un
// 429 NO lanza: se devuelve como status, porque lo que se quiere es
// justamente contarlos y medir cuánto aguanta la app con 21 cuentas;
// (3) mide el tiempo de cada llamada. La ruta tiene que ser relativa a
// BASE_URL y sin caracteres raros — nunca una URL completa ni texto sin
// validar, igual que los ids de arriba.
const PATRON_RUTA_LECTURA = /^\/[A-Za-z0-9_\-/]+(\?[A-Za-z0-9_\-.,=&%:[\]]*)?$/;

export type LecturaMedida = { status: number; ms: number; data: unknown };

export async function leerParaDiagnostico(ruta: string, token: string, apiVersion?: "1" | "2"): Promise<LecturaMedida> {
  if (!PATRON_RUTA_LECTURA.test(ruta) || ruta.includes("..")) {
    throw new Error("Ruta de diagnóstico inválida (no se llama a Mercado Libre).");
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  // Product Ads exige este encabezado (1 para /advertising/advertisers,
  // 2 para campañas) — documentación oficial "Product Ads para Catálogo
  // y User Products (lectura)".
  if (apiVersion) headers["Api-Version"] = apiVersion;
  const inicio = Date.now();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${ruta}`, { method: "GET", headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { status: 0, ms: Date.now() - inicio, data: null };
  }
  const data = res.ok ? await res.json().catch(() => null) : null;
  return { status: res.status, ms: Date.now() - inicio, data };
}

// Link real de la publicación — confirmado en producción (zilonix-os-web):
// articulo.mercadolibre.com.co/MCO-{numero} redirige a la ficha exacta,
// sin pasar por /items/{id} (que da 403 para publicaciones ajenas).
export function linkPublicacion(itemId: string): string | null {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
  return `https://articulo.mercadolibre.com.co/${itemId.replace(/^MCO(\d+)$/, "MCO-$1")}`;
}
