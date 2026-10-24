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
//
// Tarea 2.11, punto 3 — mismos patrones, reusados tal cual (nunca
// reinventados) para validar itemId/categoryId (publicar.ts, clip.ts,
// estado-item.ts) y cuentaIdExterna (clip.ts) antes de que lleguen a
// las funciones de ESCRITURA de abajo — ej. "MCO1/../users/me" no
// cumple ninguno de los dos y nunca llega a armar una URL.
export const PATRON_ID_PRODUCTO_O_ITEM = /^MCO\d+$/;
export const PATRON_ID_CATEGORIA = /^MCO\d+$/;
export const PATRON_ID_VENDEDOR = /^\d+$/;

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

// Tarea 2.11, punto 3 — "si no cumple, error claro y nunca se llama a
// ML". Una sola función para los 3 patrones de arriba: lanza ANTES de
// que el llamador arme ninguna URL, nunca deja pasar el id a fetch.
function exigirId(valor: string, patron: RegExp, etiqueta: string): string {
  if (!patron.test(valor)) {
    throw new Error(`${etiqueta} inválido — no se llamó a Mercado Libre.`);
  }
  return valor;
}

// token opcional: GET /categories/{id} y GET /categories/{id}/attributes
// son endpoints PÚBLICOS de Mercado Libre (sin Authorization) — antes
// de esta tarea vivían como fetch sueltos en lib/ml/publicar.ts; ahora
// pasan por acá también, sin forzar un token que no existe para ellos.
async function pedir<T>(url: string, token?: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(TIMEOUT_MS) });
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

// Tarea 2.11, punto 2 — helper de ESCRITURA (POST/PUT), JSON o
// multipart (FormData), mismo AbortSignal.timeout/LimiteMercadoLibreError/
// BASE_URL que pedir() — una sola fuente de verdad para TODA llamada a
// Mercado Libre, de lectura o de escritura. Devuelve el texto crudo
// además del JSON ya parseado (cuando se puede) porque varios
// llamadores necesitan el texto crudo tal cual para armar su propio
// mensaje de error con el detalle real que mandó Mercado Libre.
async function escribir<T>(
  url: string,
  token: string,
  method: "POST" | "PUT",
  body: Record<string, unknown> | FormData
): Promise<{ ok: boolean; status: number; data: T | null; textoCrudo: string }> {
  const esFormData = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: esFormData ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: esFormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0, data: null, textoCrudo: "" };
  }
  if (res.status === 429) throw new LimiteMercadoLibreError();
  const textoCrudo = await res.text().catch(() => "");
  let data: T | null = null;
  try {
    data = JSON.parse(textoCrudo) as T;
  } catch {
    // Respuesta no-JSON — textoCrudo ya queda disponible para el llamador.
  }
  return { ok: res.ok, status: res.status, data, textoCrudo };
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

// Link real de la publicación — confirmado en producción (zilonix-os-web):
// articulo.mercadolibre.com.co/MCO-{numero} redirige a la ficha exacta,
// sin pasar por /items/{id} (que da 403 para publicaciones ajenas).
export function linkPublicacion(itemId: string): string | null {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
  return `https://articulo.mercadolibre.com.co/${itemId.replace(/^MCO(\d+)$/, "MCO-$1")}`;
}

// ---------- Tarea 2.11 ("Publicar producto y clip") ----------
//
// Hasta esta tarea, lib/ml/publicar.ts, lib/ml/clip.ts y
// lib/ml/estado-item.ts tenían su propio fetch suelto contra
// api.mercadolibre.com — regla de CLAUDE.md incumplida desde antes de
// que cliente.ts existiera. Se centralizan acá, con el mismo
// AbortSignal.timeout/LimiteMercadoLibreError/BASE_URL que ya usaba
// pedir() para lectura, y el nuevo escribir() (arriba) para POST/PUT —
// cada función de abajo valida su propio id con exigirId() ANTES de
// construir la URL.

export type CategoriaDetalleMl = { categoryId: string; categoryName: string; maxPicturesPerItem: number | null };

// GET /categories/{id} — público (sin token). Usado por
// leerCategoriaPorId (lanza si falla) y obtenerLimiteFotos (tolera
// cualquier falla, 12 de respaldo) — cada uno decide su propio manejo
// de error, acá solo se trae el dato.
export async function leerCategoriaMl(categoryId: string): Promise<CategoriaDetalleMl> {
  exigirId(categoryId, PATRON_ID_CATEGORIA, "categoryId");
  const url = `${BASE_URL}/categories/${encodeURIComponent(categoryId)}`;
  const resp = await pedir<{ id?: unknown; name?: unknown; max_pictures_per_item?: unknown }>(url);
  if (!resp.ok) throw new Error(`No se pudo leer la categoría ${categoryId} (HTTP ${resp.status}).`);
  return {
    categoryId: typeof resp.data.id === "string" ? resp.data.id : categoryId,
    categoryName: typeof resp.data.name === "string" ? resp.data.name : categoryId,
    maxPicturesPerItem: typeof resp.data.max_pictures_per_item === "number" ? resp.data.max_pictures_per_item : null,
  };
}

// GET /categories/{id}/attributes — público (sin token). Devuelve la
// lista cruda (publicar.ts la castea a su propio DefinicionAtributoMl
// — ese tipo vive en lib/ml/publicar-tipos.ts, cliente.ts no depende
// de tipos específicos de un módulo que lo importa a él).
export async function leerAtributosCategoriaMl(categoryId: string): Promise<unknown[]> {
  exigirId(categoryId, PATRON_ID_CATEGORIA, "categoryId");
  const url = `${BASE_URL}/categories/${encodeURIComponent(categoryId)}/attributes`;
  const resp = await pedir<unknown[]>(url);
  if (!resp.ok) throw new Error(`No se pudieron leer los atributos de la categoría ${categoryId}.`);
  return Array.isArray(resp.data) ? resp.data : [];
}

// GET /sites/{siteId}/search — búsqueda pública de texto, respaldo de
// resolverCategoria cuando domain_discovery no encuentra nada.
export async function buscarEnSitioMl(siteId: string, query: string, token: string, limite = 10): Promise<{ categoryId: string }[]> {
  const url = `${BASE_URL}/sites/${encodeURIComponent(siteId)}/search?q=${encodeURIComponent(query)}&limit=${limite}`;
  const resp = await pedir<{ results?: unknown[] }>(url, token);
  if (!resp.ok) return [];
  const resultados = Array.isArray(resp.data.results) ? resp.data.results : [];
  return resultados
    .map((r) => (r as { category_id?: unknown }).category_id)
    .filter((id): id is string => typeof id === "string")
    .map((categoryId) => ({ categoryId }));
}

export type ResultadoDomainDiscoveryMl = { categoryId: string; categoryName: string; domainName: string | null };

// GET /sites/{siteId}/domain_discovery/search — devuelve {ok,status,
// resultados} en vez de lanzar/null: publicar.ts (resolverCategoria)
// necesita distinguir "no-ok (reintentable)" de "ok pero sin
// resultados (cae al respaldo por búsqueda, SIN reintentar)" — esa
// lógica de reintento/respaldo se queda en publicar.ts tal cual ya
// estaba, esto solo reemplaza su fetch directo.
export async function domainDiscoveryMl(
  siteId: string,
  query: string,
  token: string,
  limite = 1
): Promise<{ ok: boolean; status: number; resultados: ResultadoDomainDiscoveryMl[] }> {
  const url = `${BASE_URL}/sites/${encodeURIComponent(siteId)}/domain_discovery/search?q=${encodeURIComponent(query)}&limit=${limite}`;
  const resp = await pedir<unknown>(url, token);
  if (!resp.ok) return { ok: false, status: resp.status, resultados: [] };
  const lista = Array.isArray(resp.data) ? resp.data : [];
  const resultados = lista
    .map((c) => {
      const item = c as { category_id?: unknown; category_name?: unknown; domain_name?: unknown };
      return {
        categoryId: typeof item.category_id === "string" ? item.category_id : "",
        categoryName: typeof item.category_name === "string" ? item.category_name : "",
        domainName: typeof item.domain_name === "string" ? item.domain_name : null,
      };
    })
    .filter((c) => c.categoryId);
  return { ok: true, status: 200, resultados };
}

// GET /users/{cuentaIdExterna} — datos de la CUENTA conectada (el
// site_id que publicar.ts necesita para armar la publicación).
// Distinto de obtenerVendedor (mismo endpoint, pero esa función es de
// Investigación: busca a un VENDEDOR ajeno por su seller_id y no
// necesita site_id — se mantienen separadas, cada una con su propia
// forma de respuesta y semántica de tolerancia a fallos).
export async function leerCuentaMl(cuentaIdExterna: string, token: string): Promise<{ siteId: string }> {
  exigirId(cuentaIdExterna, PATRON_ID_VENDEDOR, "cuentaIdExterna");
  const url = `${BASE_URL}/users/${encodeURIComponent(cuentaIdExterna)}`;
  const resp = await pedir<{ site_id?: unknown }>(url, token);
  if (!resp.ok) throw new Error(`No se pudo leer la cuenta en Mercado Libre (HTTP ${resp.status}).`);
  return { siteId: typeof resp.data.site_id === "string" ? resp.data.site_id : "" };
}

export type RespuestaEscrituraMl = { ok: boolean; status: number; data: Record<string, unknown> | null; textoCrudo: string };

// POST /items — crear una publicación. Sin id que validar (todavía no
// existe ninguno — el category_id del body ya se validó en
// leerCategoriaMl/domainDiscoveryMl, antes de llegar hasta acá).
export async function crearItemMl(token: string, body: Record<string, unknown>): Promise<RespuestaEscrituraMl> {
  return escribir<Record<string, unknown>>(`${BASE_URL}/items`, token, "POST", body);
}

// PUT /items/{id} — el mismo endpoint sirve para pausar/activar
// (estado-item.ts), asignar picture_ids por variante y pausar en modo
// prueba (publicar.ts) — una sola función, el body cambia según quién
// llama.
export async function actualizarItemMl(itemId: string, token: string, cambios: Record<string, unknown>): Promise<RespuestaEscrituraMl> {
  exigirId(itemId, PATRON_ID_PRODUCTO_O_ITEM, "itemId");
  return escribir<Record<string, unknown>>(`${BASE_URL}/items/${encodeURIComponent(itemId)}`, token, "PUT", cambios);
}

// POST /items/{id}/description — endpoint SEPARADO del body de /items
// (confirmado: la descripción nunca va en el POST de creación).
export async function agregarDescripcionItemMl(itemId: string, token: string, texto: string): Promise<{ ok: boolean; status: number }> {
  exigirId(itemId, PATRON_ID_PRODUCTO_O_ITEM, "itemId");
  const r = await escribir(`${BASE_URL}/items/${encodeURIComponent(itemId)}/description`, token, "POST", { plain_text: texto });
  return { ok: r.ok, status: r.status };
}

// GET /users/{cuentaIdExterna}/items/search?seller_sku= — búsqueda
// real por SKU (hallazgo §16.4 del reporte de investigación: el
// sistema actual descarga el catálogo COMPLETO de la cuenta para
// encontrar un SKU — acá se usa el endpoint real de búsqueda).
export async function buscarItemsPorSkuMl(cuentaIdExterna: string, sku: string, token: string): Promise<string[]> {
  exigirId(cuentaIdExterna, PATRON_ID_VENDEDOR, "cuentaIdExterna");
  const url = `${BASE_URL}/users/${encodeURIComponent(cuentaIdExterna)}/items/search?seller_sku=${encodeURIComponent(sku)}`;
  const resp = await pedir<{ results?: unknown[] }>(url, token);
  if (!resp.ok) throw new Error(`No se pudo buscar el SKU en Mercado Libre (HTTP ${resp.status}).`);
  return Array.isArray(resp.data.results) ? resp.data.results.filter((r): r is string => typeof r === "string") : [];
}

// GET /items/{id}?attributes=id,title,thumbnail — detalle mínimo de
// una publicación ya encontrada (por sku o por itemId directo). null
// si Mercado Libre no puede traerlo — el llamador decide el respaldo
// (ej. clip.ts cae al propio itemId como título).
export async function leerItemBasicoMl(itemId: string, token: string): Promise<{ title: string | null; thumbnail: string | null } | null> {
  exigirId(itemId, PATRON_ID_PRODUCTO_O_ITEM, "itemId");
  const url = `${BASE_URL}/items/${encodeURIComponent(itemId)}?attributes=id,title,thumbnail`;
  const resp = await pedir<{ title?: unknown; thumbnail?: unknown }>(url, token);
  if (!resp.ok) return null;
  return {
    title: typeof resp.data.title === "string" ? resp.data.title : null,
    thumbnail: typeof resp.data.thumbnail === "string" ? resp.data.thumbnail : null,
  };
}

// POST /marketplace/items/{id}/clips/upload — multipart/form-data,
// contrato real documentado por Mercado Libre ("Working with Clips").
export async function subirClipMl(itemId: string, token: string, form: FormData): Promise<{ ok: boolean; status: number; textoCrudo: string }> {
  exigirId(itemId, PATRON_ID_PRODUCTO_O_ITEM, "itemId");
  const r = await escribir(`${BASE_URL}/marketplace/items/${encodeURIComponent(itemId)}/clips/upload`, token, "POST", form);
  return { ok: r.ok, status: r.status, textoCrudo: r.textoCrudo };
}
