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

// Issue #147 — bug real en vivo: un 401/403/5xx de Mercado Libre caía
// en el "throw new Error(...)" genérico de cada función auxiliar, que
// la página nunca atrapaba (solo atrapaba TerminoInvalidoError/
// LimiteBusquedasError/SinCuentaMlError/LimiteMercadoLibreError) — salía
// "Application error" sin ningún mensaje útil, en vez de un aviso claro
// o un link para reconectar la cuenta. 3 errores tipados, una sola
// fuente de verdad acá (pedir()), para que page.tsx los pueda atrapar
// sin adivinar por el texto del mensaje:
// - 401: el token ya no es válido (venció de verdad, no solo "está por
//   vencer" — eso ya lo resuelve obtenerAccessTokenVigente antes de
//   llegar acá) — hay que reconectar la cuenta.
// - 403: la APP (no la cuenta) no tiene permiso para ESTE endpoint —
//   pasa real en producción con /products/{id}/items (ofertas) en
//   cuentas sin cierto scope. No es "reconectar", es un permiso de la
//   integración.
// - 5xx o tiempo agotado: Mercado Libre no está disponible ahora mismo
//   — transitorio, nada que el usuario pueda arreglar.
export class MlNoAutorizadoError extends Error {
  constructor() {
    super("La conexión con esta cuenta de Mercado Libre ya no es válida — hay que reconectarla.");
    this.name = "MlNoAutorizadoError";
  }
}

export class MlSinPermisoAppError extends Error {
  readonly endpoint: string;
  constructor(endpoint: string) {
    super("Mercado Libre no le da permiso a esta aplicación para esta consulta.");
    this.name = "MlSinPermisoAppError";
    this.endpoint = endpoint;
  }
}

export class MlNoDisponibleError extends Error {
  constructor() {
    super("Mercado Libre no respondió a tiempo — intenta de nuevo en un momento.");
    this.name = "MlNoDisponibleError";
  }
}

// Solo para el log — nunca el término/query completo (puede llevar lo
// que la persona escribió) ni el token, que NUNCA se imprime acá.
function endpointSinQuery(url: string): string {
  return url.split("?")[0].replace(BASE_URL, "");
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pedir<T>(url: string, token: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const endpoint = endpointSinQuery(url);
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    // Tiempo agotado (AbortError) o falla de red.
    console.warn(`[lib/ml/cliente] ${endpoint} — tiempo agotado o falla de red`);
    throw new MlNoDisponibleError();
  }
  // 429 corta TODA la búsqueda, no solo esta llamada puntual — se
  // lanza en vez de devolver {ok:false}, para que ninguna de las
  // funciones de abajo lo trague en silencio como "sin datos".
  if (res.status === 429) throw new LimiteMercadoLibreError();
  if (res.status === 401) {
    console.warn(`[lib/ml/cliente] ${endpoint} — 401`);
    throw new MlNoAutorizadoError();
  }
  if (res.status === 403) {
    console.warn(`[lib/ml/cliente] ${endpoint} — 403`);
    throw new MlSinPermisoAppError(endpoint);
  }
  if (res.status >= 500) {
    console.warn(`[lib/ml/cliente] ${endpoint} — ${res.status}`);
    throw new MlNoDisponibleError();
  }
  // 404 y cualquier otro 4xx siguen como {ok:false} — "vacío" es una
  // respuesta legítima (ej. un producto sin ofertas), no un fallo.
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
// Fuente 1, la búsqueda PRINCIPAL — a propósito NO atrapa
// MlNoAutorizadoError/MlSinPermisoAppError/MlNoDisponibleError: un
// 401/403/5xx acá significa que la búsqueda entera no tiene cómo
// avanzar (es la primera llamada real de toda la cadena), así que sube
// tal cual hasta la página — nunca "no se encontró nada", que sería
// engañoso.
export async function buscarProductosCatalogo(termino: string, token: string, offset = 0, limite = 20): Promise<ProductoCatalogoMl[]> {
  const url = `${BASE_URL}/products/search?site_id=${SITE_ID}&q=${encodeURIComponent(termino)}&status=active&limit=${limite}&offset=${offset}`;
  const resp = await pedir<{ results?: unknown[] }>(url, token);
  if (!resp.ok) {
    if (resp.status === 404) return [];
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
//
// Issue #147 — 3 intentos con 800ms*intento de espera ante 403/5xx
// (mismo criterio ya confirmado en producción en zilonix-os-web,
// lib/mercadolibre-publicar.js, resolverCategoria): un 403/5xx puntual
// en ESTE endpoint no debería tirar abajo todo el enriquecimiento por
// categoría si el segundo o tercer intento sí responde. 401 (token
// inválido de verdad) nunca se reintenta — no tiene sentido, el
// siguiente intento fallaría igual.
export async function resolverCategoria(termino: string, token: string): Promise<CategoriaMl | null> {
  const url = `${BASE_URL}/sites/${SITE_ID}/domain_discovery/search?q=${encodeURIComponent(termino)}&limit=1`;
  for (let intento = 0; intento < 3; intento++) {
    if (intento > 0) await esperar(800 * intento);
    try {
      const resp = await pedir<unknown>(url, token);
      if (!resp.ok) return null;
      const primero = Array.isArray(resp.data) ? (resp.data[0] as { category_id?: unknown } | undefined) : undefined;
      const categoryId = primero && typeof primero.category_id === "string" ? primero.category_id : null;
      return categoryId && PATRON_ID_CATEGORIA.test(categoryId) ? { categoryId } : null;
    } catch (e) {
      if (e instanceof MlSinPermisoAppError || e instanceof MlNoDisponibleError) continue; // reintentable
      throw e; // 401 — no tiene sentido reintentar
    }
  }
  return null; // 3 intentos agotados — enriquecimiento opcional, se tolera
}

export type ItemDestacadoMl = { id: string; tipo: string };

// Los más vendidos REALES de una categoría (highlights BEST_SELLER) —
// complementa la búsqueda por texto con productos que el texto solo no
// encuentra (confirmado en producción con el caso real documentado en
// zilonix-os-web/lib/busqueda-productos.js).
//
// Issue #147, bug real: Mercado Libre devuelve content[] con "type"
// ITEM | PRODUCT | USER_PRODUCT — antes se descartaba el "type" por
// completo y se filtraba solo por el FORMATO del id (/^MCO\d+$/), que
// ITEM también cumple (USER_PRODUCT es "MCOU...", ese sí se descartaba
// solo). El resultado real: un id de tipo ITEM (una publicación) se
// mandaba a obtenerProducto() → GET /products/{id}, que espera un id
// de PRODUCTO de catálogo, no de publicación — fallaba siempre. Ahora
// se devuelve el tipo tal cual junto al id; el llamador (investigacion.ts)
// decide qué hacer con cada uno (PRODUCT → obtenerProducto, ITEM →
// obtenerItemMl, USER_PRODUCT → se ignora, nunca se inventa un mapeo).
// Tolera 403/5xx (enriquecimiento, nunca tira abajo la búsqueda por
// texto); 401 propaga — ver resolverCategoria, mismo criterio.
// Issue #147 — a propósito NO se filtra acá por PATRON_ID_PRODUCTO_O_ITEM
// (/^MCO\d+$/): un USER_PRODUCT real viene como "MCOU..." (con la U),
// que esa regex estricta rechaza — si se filtrara acá, USER_PRODUCT
// desaparecería en silencio ANTES de que investigacion.ts pudiera
// siquiera contarlo (pedido explícito: "se ignora Y SE CUENTA", no
// "se pierde sin que nadie se entere"). El filtro de formato real
// (estricto, el que de verdad protege la URL) sigue en obtenerProducto/
// obtenerItemMl — cada id pasa por esa validación recién cuando se usa
// de verdad, nunca antes. Acá solo se exige el mínimo sensato (un
// string que empiece por "MCO" — nunca basura que ni eso cumple).
const PATRON_ID_DESTACADO = /^MCO[A-Z0-9]+$/i;

export async function obtenerMejoresProductosCategoria(categoryId: string, token: string): Promise<ItemDestacadoMl[]> {
  if (!PATRON_ID_CATEGORIA.test(categoryId)) return [];
  const url = `${BASE_URL}/highlights/${SITE_ID}/category/${encodeURIComponent(categoryId)}`;
  try {
    const resp = await pedir<{ content?: unknown[] }>(url, token);
    if (!resp.ok) return [];
    const contenido = Array.isArray(resp.data.content) ? resp.data.content : [];
    return contenido
      .map((c) => {
        const item = c as { id?: unknown; type?: unknown };
        return typeof item.id === "string" && PATRON_ID_DESTACADO.test(item.id)
          ? { id: item.id, tipo: typeof item.type === "string" ? item.type : "" }
          : null;
      })
      .filter((i): i is ItemDestacadoMl => i !== null);
  } catch (e) {
    if (e instanceof MlSinPermisoAppError || e instanceof MlNoDisponibleError) return [];
    throw e;
  }
}

// Nombre + foto de un product_id de catálogo — solo se usa para
// completar los candidatos de tipo PRODUCT que vinieron de
// obtenerMejoresProductosCategoria (que no trae esos datos), nunca
// para los que ya vinieron de buscarProductosCatalogo. Tolera 403/5xx
// (enriquecimiento); 401 propaga.
export async function obtenerProducto(productId: string, token: string): Promise<ProductoCatalogoMl | null> {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(productId)) return null;
  const url = `${BASE_URL}/products/${encodeURIComponent(productId)}`;
  try {
    const resp = await pedir<{ name?: unknown; pictures?: unknown }>(url, token);
    if (!resp.ok) return null;
    return { id: productId, nombre: typeof resp.data.name === "string" ? resp.data.name : null, foto: fotoDe(resp.data.pictures) };
  } catch (e) {
    if (e instanceof MlSinPermisoAppError || e instanceof MlNoDisponibleError) return null;
    throw e;
  }
}

// Issue #147 — hermana de obtenerProducto, pero para un id de tipo
// ITEM (una publicación real, GET /items/{id}) en vez de un id de
// PRODUCTO de catálogo (GET /products/{id}) — los dos endpoints NO son
// intercambiables (confirmado en vivo: /products/{idDeItem} da 404).
// Mismo criterio de tolerancia que obtenerProducto.
export async function obtenerItemMl(itemId: string, token: string): Promise<ProductoCatalogoMl | null> {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
  const url = `${BASE_URL}/items/${encodeURIComponent(itemId)}?attributes=id,title,thumbnail`;
  try {
    const resp = await pedir<{ title?: unknown; thumbnail?: unknown }>(url, token);
    if (!resp.ok) return null;
    return {
      id: itemId,
      nombre: typeof resp.data.title === "string" ? resp.data.title : null,
      foto: typeof resp.data.thumbnail === "string" ? resp.data.thumbnail : null,
    };
  } catch (e) {
    if (e instanceof MlSinPermisoAppError || e instanceof MlNoDisponibleError) return null;
    throw e;
  }
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
// devuelve [] en vez de lanzar para un 404 — la lógica de negocio
// decide qué hacer con "sin ofertas", no este cliente.
//
// Issue #147 — a propósito SIN try/catch alrededor de pedir(): un
// 401/403/5xx acá SÍ propaga (nunca se traga como "sin ofertas", que
// sería engañoso — "sin ofertas reales" y "Mercado Libre no deja ver
// las ofertas" son avisos distintos). investigacion.ts cuenta estos
// fallos por candidato para poder avisar "todas las ofertas fallaron
// por falta de permiso" en vez de "no se encontró nada", cuando
// corresponda.
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

// Issue #147 — enriquecimiento secundario (solo cambia el nombre del
// vendedor/insignia Platinum que se muestra, nunca si una publicación
// cuenta como encontrada): tolera 403/5xx igual que obtenerProducto,
// nunca tira abajo el candidato completo por esto. 401 propaga.
export async function obtenerVendedor(sellerId: string, token: string): Promise<VendedorMl | null> {
  if (!PATRON_ID_VENDEDOR.test(sellerId)) return null;
  const url = `${BASE_URL}/users/${encodeURIComponent(sellerId)}`;
  try {
    const resp = await pedir<{ nickname?: unknown; seller_reputation?: { power_seller_status?: unknown } }>(url, token);
    if (!resp.ok) return null;
    return {
      nickname: typeof resp.data.nickname === "string" ? resp.data.nickname : null,
      esPlatinum: resp.data.seller_reputation?.power_seller_status === "platinum",
    };
  } catch (e) {
    if (e instanceof MlSinPermisoAppError || e instanceof MlNoDisponibleError) return null;
    throw e;
  }
}

// Link real de la publicación — confirmado en producción (zilonix-os-web):
// articulo.mercadolibre.com.co/MCO-{numero} redirige a la ficha exacta,
// sin pasar por /items/{id} (que da 403 para publicaciones ajenas).
export function linkPublicacion(itemId: string): string | null {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
  return `https://articulo.mercadolibre.com.co/${itemId.replace(/^MCO(\d+)$/, "MCO-$1")}`;
}
