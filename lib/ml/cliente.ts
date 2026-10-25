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
// Solo para LECTURA (pedir()) — una escritura necesita más tiempo, ver
// TIMEOUT_ESCRITURA_MS/TIMEOUT_SUBIDA_CLIP_MS más abajo.
const TIMEOUT_MS = 8_000;

// Bug real: escribir() usaba el mismo TIMEOUT_MS de 8s de pedir() para
// TODA escritura — eso corta un POST /items (crear publicación) antes
// de que Mercado Libre termine de procesarlo, y la llamada se trata
// como fallida aunque el ítem SÍ se haya creado del otro lado (riesgo
// real de publicación duplicada al reintentar). crearItemMl/
// actualizarItemMl/agregarDescripcionItemMl usan este tiempo más
// generoso; subirClipMl (video de hasta 280MB) usa
// TIMEOUT_SUBIDA_CLIP_MS, bastante más largo todavía.
const TIMEOUT_ESCRITURA_MS = 30_000;
const TIMEOUT_SUBIDA_CLIP_MS = 300_000;

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

// Issue #174 — bug real encontrado al diagnosticar "Investigación no
// devuelve resultados" en staging: buscarProductosCatalogo (la
// búsqueda PRINCIPAL, /products/search) lanzaba un Error genérico para
// cualquier 4xx que no fuera 404 (ej. un 400 real si Mercado Libre
// rechaza algún parámetro, o cambia su contrato) — page.tsx solo
// atrapa los 4 tipos de arriba por nombre, así que ese Error genérico
// se le escapaba hasta app/panel/investigacion/error.tsx, que a
// propósito muestra un mensaje GENÉRICO ("no se sabe qué fue") sin
// error.message — el status real de Mercado Libre quedaba invisible
// tanto para quien busca como para quien lee el reporte del bug. Con
// esto, cualquier 4xx inesperado llega a page.tsx con su status real
// adentro del mensaje, nunca a la pantalla genérica.
export class MlRespuestaInesperadaError extends Error {
  readonly status: number;
  constructor(status: number, contexto: string) {
    super(`Mercado Libre respondió ${status} al ${contexto} — puede ser un cambio reciente de su API, revisar con el equipo de Mercado Libre.`);
    this.name = "MlRespuestaInesperadaError";
    this.status = status;
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

// token opcional: GET /categories/{id} y GET /categories/{id}/attributes
// son endpoints PÚBLICOS de Mercado Libre (sin Authorization) — antes
// de esta tarea vivían como fetch sueltos en lib/ml/publicar.ts; ahora
// pasan por acá también, sin forzar un token que no existe para ellos.
async function pedir<T>(url: string, token?: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const endpoint = endpointSinQuery(url);
  let res: Response;
  try {
    res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(TIMEOUT_MS) });
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

// Issue #147 agregó errores tipados a pedir() para 401/403/5xx — pero
// buscarEnSitioMl/domainDiscoveryMl (tarea 2.11) necesitan el contrato
// ORIGINAL de "nunca lanza, status real en la respuesta": sus
// llamadores en lib/ml/publicar.ts deciden ELLOS MISMOS el
// reintento/respaldo mirando resp.status en un bucle, nunca con un
// catch (bug real encontrado al fusionar: un 403 puntual escapaba sin
// capturar y tumbaba resolverCategoria entero en el primer intento, en
// vez de reintentar). Se traduce de vuelta acá, una sola vez. 429
// (LimiteMercadoLibreError) nunca se traduce — sigue propagando tal
// cual, mismo criterio de siempre ("corta TODA la búsqueda").
async function pedirTolerante<T>(url: string, token?: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  try {
    return await pedir<T>(url, token);
  } catch (e) {
    if (e instanceof MlNoAutorizadoError) return { ok: false, status: 401 };
    if (e instanceof MlSinPermisoAppError) return { ok: false, status: 403 };
    if (e instanceof MlNoDisponibleError) return { ok: false, status: 503 };
    throw e;
  }
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
  body: Record<string, unknown> | FormData,
  timeoutMs: number = TIMEOUT_ESCRITURA_MS
): Promise<{ ok: boolean; status: number; data: T | null; textoCrudo: string }> {
  const esFormData = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: esFormData ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: esFormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
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
    // Sin el término acá — igual que endpointSinQuery(), nunca lo que la
    // persona escribió adentro de un mensaje de error/log.
    throw new MlRespuestaInesperadaError(resp.status, "buscar en el catálogo");
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

export type ItemMl = { producto: ProductoCatalogoMl; oferta: OfertaMl | null };

// Issue #147 — hermana de obtenerProducto, pero para un id de tipo
// ITEM (una publicación real, GET /items/{id}) en vez de un id de
// PRODUCTO de catálogo (GET /products/{id}) — los dos endpoints NO son
// intercambiables (confirmado en vivo: /products/{idDeItem} da 404).
// Mismo criterio de tolerancia que obtenerProducto.
//
// Issue #147, bug real: un destacado ITEM se mandaba a
// obtenerOfertasProducto() (GET /products/{id}/items), que espera un id
// de PRODUCTO de catálogo — un ITEM nunca tiene esa ruta, 404 siempre,
// así que el highlight nunca producía ninguna publicación. Un ITEM es
// la publicación en sí: la oferta sale de este mismo /items/{id}, nunca
// de obtenerOfertasProducto — por eso esta función ya devuelve la
// OfertaMl armada (misma validación de seller_id que obtenerOfertasProducto),
// y el llamador (investigacion.ts) nunca llama a obtenerOfertasProducto
// para un candidato de tipo ITEM.
export async function obtenerItemMl(itemId: string, token: string): Promise<ItemMl | null> {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
  // Issue #197 — sold_quantity/date_created sumados a la lista de
  // atributos: mismo endpoint (GET /items/{id}) y mismos dos campos
  // que YA pide obtenerFotoItemMl (más abajo) para seguimiento de
  // competidores (issue #175) — ahí ya está confirmado que Mercado
  // Libre los da para una publicación AJENA, no solo la propia. Antes
  // esta función no los pedía porque la Parte 1 de Investigación
  // (issue #174) había descartado "vendidos" por el endpoint de
  // VISITAS (/visits/items, ese sí restringido para ajenas) — nunca
  // se había confirmado que sold_quantity es un campo distinto, sin
  // esa restricción.
  const url = `${BASE_URL}/items/${encodeURIComponent(itemId)}?attributes=id,title,thumbnail,price,currency_id,seller_id,shipping,status,sold_quantity,date_created`;
  try {
    const resp = await pedir<{
      title?: unknown;
      thumbnail?: unknown;
      price?: unknown;
      currency_id?: unknown;
      seller_id?: unknown;
      shipping?: { logistic_type?: unknown; free_shipping?: unknown };
      status?: unknown;
      sold_quantity?: unknown;
      date_created?: unknown;
    }>(url, token);
    if (!resp.ok) return null;
    // Bug real: una publicación pausada/cerrada seguía apareciendo en
    // la tabla de Investigación (el precio/oferta de una publicación
    // que ya no se puede comprar no sirve para nada ahí) — se descarta
    // igual que cualquier otro candidato sin oferta real, nunca se
    // distingue del caso "Mercado Libre no pudo traerla".
    if (resp.data.status !== "active") return null;
    const producto: ProductoCatalogoMl = {
      id: itemId,
      nombre: typeof resp.data.title === "string" ? resp.data.title : null,
      foto: typeof resp.data.thumbnail === "string" ? resp.data.thumbnail : null,
    };
    const precio = Number(resp.data.price);
    let oferta: OfertaMl | null = null;
    if (Number.isFinite(precio) && precio > 0) {
      const sellerIdCrudo = resp.data.seller_id != null ? String(resp.data.seller_id) : null;
      oferta = {
        itemId,
        precio,
        monedaId: typeof resp.data.currency_id === "string" ? resp.data.currency_id : "COP",
        sellerId: sellerIdCrudo && PATRON_ID_VENDEDOR.test(sellerIdCrudo) ? sellerIdCrudo : null,
        esFull: resp.data.shipping?.logistic_type === "fulfillment",
        esEnvioGratis: typeof resp.data.shipping?.free_shipping === "boolean" ? resp.data.shipping.free_shipping : null,
        vendidos: numeroONull(resp.data.sold_quantity),
        fechaCreacion: typeof resp.data.date_created === "string" ? resp.data.date_created : null,
      };
    }
    return { producto, oferta };
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
  // Issue #197 — sold_quantity real de Mercado Libre para ESTA oferta
  // puntual (no un estimado) — null si ML no lo mandó. fechaCreacion
  // (date_created) es lo que necesita lib/ml/estimacionVentas.ts para
  // convertir el acumulado en una tasa mensual — los dos, igual que
  // esEnvioGratis abajo, se leen de forma defensiva, nunca se asume
  // que van a venir siempre.
  vendidos: number | null;
  fechaCreacion: string | null;
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
      const item = raw as {
        item_id?: unknown;
        id?: unknown;
        price?: unknown;
        currency_id?: unknown;
        seller_id?: unknown;
        shipping?: { logistic_type?: unknown; free_shipping?: unknown };
        sold_quantity?: unknown;
        date_created?: unknown;
      };
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
        // Issue #197 — igual que esEnvioGratis arriba: sin precedente
        // confirmado contra producción de que /products/{id}/items
        // mande estos dos campos (ese endpoint nunca los había leído
        // antes) — se leen de forma defensiva, null si no vienen,
        // nunca una cifra inventada en su lugar.
        vendidos: numeroONull(item.sold_quantity),
        fechaCreacion: typeof item.date_created === "string" ? item.date_created : null,
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
  const resp = await pedirTolerante<{ results?: unknown[] }>(url, token);
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
  const resp = await pedirTolerante<unknown>(url, token);
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
// existe ninguno — el category_id del body ya se validó antes de
// llegar hasta acá, en leerAtributosCategoriaMl, que publicar.ts llama
// justo antes de armar este body — domainDiscoveryMl solo descubre un
// category_id candidato, no lo valida).
export async function crearItemMl(token: string, body: Record<string, unknown>): Promise<RespuestaEscrituraMl> {
  return escribir<Record<string, unknown>>(`${BASE_URL}/items`, token, "POST", body, TIMEOUT_ESCRITURA_MS);
}

// PUT /items/{id} — el mismo endpoint sirve para pausar/activar
// (estado-item.ts), asignar picture_ids por variante y pausar en modo
// prueba (publicar.ts) — una sola función, el body cambia según quién
// llama.
export async function actualizarItemMl(itemId: string, token: string, cambios: Record<string, unknown>): Promise<RespuestaEscrituraMl> {
  exigirId(itemId, PATRON_ID_PRODUCTO_O_ITEM, "itemId");
  return escribir<Record<string, unknown>>(`${BASE_URL}/items/${encodeURIComponent(itemId)}`, token, "PUT", cambios, TIMEOUT_ESCRITURA_MS);
}

// POST /items/{id}/description — endpoint SEPARADO del body de /items
// (confirmado: la descripción nunca va en el POST de creación).
export async function agregarDescripcionItemMl(itemId: string, token: string, texto: string): Promise<{ ok: boolean; status: number }> {
  exigirId(itemId, PATRON_ID_PRODUCTO_O_ITEM, "itemId");
  const r = await escribir(`${BASE_URL}/items/${encodeURIComponent(itemId)}/description`, token, "POST", { plain_text: texto }, TIMEOUT_ESCRITURA_MS);
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
// Video de hasta 280MB — usa TIMEOUT_SUBIDA_CLIP_MS, no el de
// escritura normal.
export async function subirClipMl(itemId: string, token: string, form: FormData): Promise<{ ok: boolean; status: number; textoCrudo: string }> {
  exigirId(itemId, PATRON_ID_PRODUCTO_O_ITEM, "itemId");
  const r = await escribir(`${BASE_URL}/marketplace/items/${encodeURIComponent(itemId)}/clips/upload`, token, "POST", form, TIMEOUT_SUBIDA_CLIP_MS);
  return { ok: r.ok, status: r.status, textoCrudo: r.textoCrudo };
}

// Issue #175 — lector real del seguimiento diario. Confirmado en vivo
// antes de escribirse con /panel/investigacion/diagnostico (ver
// docs/changelog/pendientes/feat-investigacion-diagnostico.md): un
// campo que Mercado Libre no deja ver para un recurso AJENO queda
// null, nunca un 0/false inventado. Tolera 403/5xx (una publicación
// ajena puede no dejar ver todos los campos — "no disponible", nunca
// un fallo que tire abajo la foto del día entera); 401 propaga, mismo
// criterio que el resto de este archivo.
export type FotoItemMl = {
  precio: number | null;
  // original_price real de Mercado Libre — nunca una resta contra la
  // foto de ayer, esa cuenta la hace lib/seguimiento/alertas.ts.
  precioAnterior: number | null;
  inventarioDisponible: number | null;
  vendidos: number | null;
  estado: string | null;
  enCatalogo: boolean | null;
  catalogProductId: string | null;
  esFull: boolean | null;
  esEnvioGratis: boolean | null;
};

function numeroONull(valor: unknown): number | null {
  if (valor == null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export async function obtenerFotoItemMl(itemId: string, token: string): Promise<FotoItemMl | null> {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
  const url = `${BASE_URL}/items/${encodeURIComponent(itemId)}?attributes=id,price,original_price,available_quantity,sold_quantity,status,catalog_listing,catalog_product_id,shipping`;
  try {
    const resp = await pedir<{
      price?: unknown;
      original_price?: unknown;
      available_quantity?: unknown;
      sold_quantity?: unknown;
      status?: unknown;
      catalog_listing?: unknown;
      catalog_product_id?: unknown;
      shipping?: { logistic_type?: unknown; free_shipping?: unknown };
    }>(url, token);
    if (!resp.ok) return null;
    const d = resp.data;
    return {
      precio: numeroONull(d.price),
      precioAnterior: numeroONull(d.original_price),
      inventarioDisponible: numeroONull(d.available_quantity),
      vendidos: numeroONull(d.sold_quantity),
      estado: typeof d.status === "string" ? d.status : null,
      enCatalogo: typeof d.catalog_listing === "boolean" ? d.catalog_listing : null,
      catalogProductId: typeof d.catalog_product_id === "string" ? d.catalog_product_id : null,
      esFull: d.shipping ? d.shipping.logistic_type === "fulfillment" : null,
      esEnvioGratis: typeof d.shipping?.free_shipping === "boolean" ? d.shipping.free_shipping : null,
    };
  } catch (e) {
    if (e instanceof MlSinPermisoAppError || e instanceof MlNoDisponibleError) return null;
    throw e;
  }
}

export type PublicacionTiendaMl = { itemId: string; titulo: string; precio: number | null };

const TOPE_PUBLICACIONES_TIENDA = 50; // suficiente para detectar nuevas/eliminadas sin paginar sin límite
const TAMAÑO_LOTE_DETALLE_ITEMS = 20; // mismo tamaño de lote ya confirmado en producción, lib/ml/importacion.ts
// Issue #175 — "respeta los límites de ML: pausa entre llamadas":
// entre cada lote de /items?ids= (hasta 20 ids cada uno), nunca entre
// la primera llamada y el resto (esa no tiene con qué competir todavía).
const PAUSA_ENTRE_LOTES_MS = 300;

function idsDeResultadosBusqueda(resultados: unknown): string[] {
  if (!Array.isArray(resultados)) return [];
  return resultados
    .map((r) => (typeof r === "string" ? r : typeof r === "object" && r && typeof (r as { id?: unknown }).id === "string" ? (r as { id: string }).id : null))
    .filter((id): id is string => id !== null && PATRON_ID_PRODUCTO_O_ITEM.test(id));
}

// Issue #175 — dos caminos confirmados en vivo para las publicaciones
// de un vendedor/tienda AJENO: GET /users/{seller_id}/items/search
// (mismo endpoint que buscarItemsPorSkuMl ya usa para la cuenta
// PROPIA, acá con un seller_id de otra cuenta) devuelve 403 real para
// un vendedor ajeno — se cae entonces a la búsqueda pública del sitio
// (/sites/MCO/search?seller_id=), que sí deja ver publicaciones
// ajenas (con menos detalle por resultado, por eso el paso siguiente
// completa título/precio con el mismo endpoint masivo /items?ids= que
// ya usa lib/ml/importacion.ts). 401 (token inválido de verdad)
// propaga tal cual, nunca tiene sentido probar el camino público con
// el mismo token roto.
async function idsDePublicacionesDeVendedor(sellerId: string, token: string): Promise<string[]> {
  if (!PATRON_ID_VENDEDOR.test(sellerId)) return [];
  const urlPropio = `${BASE_URL}/users/${encodeURIComponent(sellerId)}/items/search?limit=${TOPE_PUBLICACIONES_TIENDA}`;
  try {
    const resp = await pedir<{ results?: unknown[] }>(urlPropio, token);
    if (resp.ok) return idsDeResultadosBusqueda(resp.data.results);
  } catch (e) {
    if (!(e instanceof MlSinPermisoAppError)) throw e;
  }
  const urlPublico = `${BASE_URL}/sites/${SITE_ID}/search?seller_id=${encodeURIComponent(sellerId)}&limit=${TOPE_PUBLICACIONES_TIENDA}`;
  const respPublico = await pedir<{ results?: unknown[] }>(urlPublico, token);
  if (!respPublico.ok) return [];
  return idsDeResultadosBusqueda(respPublico.data.results);
}

export async function obtenerPublicacionesVendedorAjenoMl(sellerId: string, token: string): Promise<PublicacionTiendaMl[]> {
  const ids = await idsDePublicacionesDeVendedor(sellerId, token);
  const publicaciones: PublicacionTiendaMl[] = [];
  for (let i = 0; i < ids.length; i += TAMAÑO_LOTE_DETALLE_ITEMS) {
    if (i > 0) await esperar(PAUSA_ENTRE_LOTES_MS);
    const lote = ids.slice(i, i + TAMAÑO_LOTE_DETALLE_ITEMS);
    const resp = await pedir<{ code?: unknown; body?: { id?: unknown; title?: unknown; price?: unknown } }[]>(
      `${BASE_URL}/items?ids=${lote.join(",")}&attributes=id,title,price`,
      token
    );
    if (!resp.ok) continue; // un lote puntual que falla no tira abajo los demás
    for (const fila of resp.data) {
      if (fila.code !== 200 || !fila.body || typeof fila.body.id !== "string") continue;
      publicaciones.push({
        itemId: fila.body.id,
        titulo: typeof fila.body.title === "string" ? fila.body.title : fila.body.id,
        precio: numeroONull(fila.body.price),
      });
    }
  }
  return publicaciones;
}
