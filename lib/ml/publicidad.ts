// Issue #254 — cliente de SOLO LECTURA de Product Ads. Rutas y cabeceras
// copiadas de la doc CO vigente (docs/publicidad/api-research.md, F1):
// `/advertising/...`, no `/marketplace/advertising/...`. No está
// confirmado contra una cuenta real (MTTIENDA). No hay PUT ni POST.
//
// Advertisers usa `Api-Version: 1`. El resto usa `api-version: 2`.
// La diferencia de mayúsculas es la de los ejemplos de F1.

import {
  LimiteMercadoLibreError,
  MlRespuestaInesperadaError,
  MlSinPermisoAppError,
  PATRON_ID_PRODUCTO_O_ITEM,
  pedirLecturaMl,
} from "@/lib/ml/cliente";

export const SUGERENCIA_RECONECTAR_PUBLICIDAD =
  "Reconectá la cuenta de Mercado Libre desde Seller. Un token emitido antes de activar el permiso Publicidad puede no traerlo.";

export const CODIGO_SIN_PERMISO_PUBLICIDAD = "PA_UNAUTHORIZED_RESULT_FROM_POLICIES";
const MENSAJE_SIN_PRODUCT_ADS = "No permissions found for user_id";

const CABECERA_ANUNCIANTES = { "Api-Version": "1" };
const CABECERA_ADS = { "api-version": "2" };

const LIMITE_PAGINA = 50;
const TOPE_PAGINACION = 10_000;

// F1, campañas. En ad group y anuncios se suma tacos.
export const METRICAS_CAMPANA = [
  "clicks",
  "prints",
  "ctr",
  "cost",
  "cpc",
  "acos",
  "roas",
  "sov",
  "cvr",
  "direct_amount",
  "indirect_amount",
  "total_amount",
  "direct_units_quantity",
  "indirect_units_quantity",
  "units_quantity",
  "advertising_items_quantity",
  "organic_items_quantity",
  "organic_units_amount",
  "organic_units_quantity",
].join(",");

export const METRICAS_ANUNCIO = `${METRICAS_CAMPANA},tacos`;

// El ejemplo de búsqueda de ad groups con métricas (F1) las pide en
// mayúsculas. El de métricas de ad groups de una campaña y el de
// anuncios de un ad group las pide en minúsculas. Cada función usa el
// de su propio ejemplo.
export const METRICAS_AD_GROUP_BUSQUEDA = [
  "CLICKS",
  "PRINTS",
  "COST",
  "CPC",
  "CTR",
  "DIRECT_AMOUNT",
  "INDIRECT_AMOUNT",
  "TOTAL_AMOUNT",
  "DIRECT_UNITS_QUANTITY",
  "INDIRECT_UNITS_QUANTITY",
  "UNITS_QUANTITY",
  "DIRECT_ITEMS_QUANTITY",
  "INDIRECT_ITEMS_QUANTITY",
  "ADVERTISING_ITEMS_QUANTITY",
  "ORGANIC_UNITS_QUANTITY",
  "ORGANIC_UNITS_AMOUNT",
  "ORGANIC_ITEMS_QUANTITY",
  "ACOS",
  "TACOS",
  "SOV",
  "CVR",
  "ROAS",
].join(",");

const PATRON_SITE = /^[A-Z]{3}$/;
const PATRON_ID_NUM = /^\d+$/;
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type ContextoAds = {
  token: string;
  siteId: string;
  advertiserId: string;
};

export type AnuncianteOk = {
  estado: "ok";
  advertiserId: string;
  siteId: string;
  nombre: string | null;
  cuentaNombre: string | null;
};

export type ResultadoAnunciante =
  | AnuncianteOk
  | { estado: "sin_product_ads" }
  | { estado: "sin_permiso_app"; sugerencia: string; codigo: string | null };

type AdvertiserCrudo = {
  advertiser_id?: unknown;
  site_id?: unknown;
  advertiser_name?: unknown;
  account_name?: unknown;
};

function exigirSite(siteId: string): string {
  if (!PATRON_SITE.test(siteId)) throw new Error("site_id de publicidad inválido — no se llamó a Mercado Libre.");
  return siteId;
}

function exigirIdNum(valor: string, etiqueta: string): string {
  if (!PATRON_ID_NUM.test(valor)) throw new Error(`${etiqueta} inválido — no se llamó a Mercado Libre.`);
  return valor;
}

function exigirFecha(valor: string): string {
  if (!PATRON_FECHA.test(valor)) throw new Error("fecha inválida — no se llamó a Mercado Libre.");
  return valor;
}

function query(params: Record<string, string | undefined>): string {
  const partes: string[] = [];
  for (const [clave, valor] of Object.entries(params)) {
    if (!valor) continue;
    // La clave la arma este archivo (filters[status], date_from, …).
    // El valor sí se codifica: nunca se pega crudo a la URL.
    partes.push(`${clave}=${encodeURIComponent(valor)}`);
  }
  return partes.length ? `?${partes.join("&")}` : "";
}

type Pagina<T> = { results?: T[]; paging?: { total?: unknown } };

async function pagina<T>(ruta: string, token: string, q: string): Promise<Pagina<T>> {
  const resp = await pedirLecturaMl<Pagina<T>>(ruta, token, { cabeceras: CABECERA_ADS, query: q });
  if (!resp.ok) throw new MlRespuestaInesperadaError(resp.status, ruta);
  return resp.data ?? {};
}

async function todasLasPaginas<T>(ruta: string, token: string, base: Record<string, string | undefined>): Promise<T[]> {
  const acumulado: T[] = [];
  let offset = 0;
  while (offset < TOPE_PAGINACION) {
    const limit = Math.min(LIMITE_PAGINA, TOPE_PAGINACION - offset);
    const data = await pagina<T>(ruta, token, query({ ...base, limit: String(limit), offset: String(offset) }));
    const results = Array.isArray(data.results) ? data.results : [];
    acumulado.push(...results);
    const total = typeof data.paging?.total === "number" ? data.paging.total : null;
    offset += results.length;
    if (results.length < limit) break;
    if (total != null && offset >= total) break;
    if (results.length === 0) break;
  }
  return acumulado;
}

export async function obtenerAnunciante(token: string): Promise<ResultadoAnunciante> {
  let resp;
  try {
    resp = await pedirLecturaMl<{ advertisers?: AdvertiserCrudo[] }>("/advertising/advertisers", token, {
      cabeceras: CABECERA_ANUNCIANTES,
      query: query({ product_id: "PADS" }),
    });
  } catch (error) {
    if (error instanceof MlSinPermisoAppError) {
      return { estado: "sin_permiso_app", sugerencia: SUGERENCIA_RECONECTAR_PUBLICIDAD, codigo: error.codigoPolitica };
    }
    throw error;
  }
  if (!resp.ok) {
    const message = resp.error.message ?? "";
    if (resp.status === 404 && message.includes(MENSAJE_SIN_PRODUCT_ADS)) return { estado: "sin_product_ads" };
    throw new MlRespuestaInesperadaError(resp.status, "/advertising/advertisers");
  }
  const lista = Array.isArray(resp.data.advertisers) ? resp.data.advertisers : [];
  const elegido =
    lista.find((a) => a.site_id === "MCO") ??
    lista.find((a) => typeof a.site_id === "string" && PATRON_SITE.test(a.site_id)) ??
    null;
  if (!elegido) return { estado: "sin_product_ads" };
  const advertiserId = typeof elegido.advertiser_id === "number" ? String(elegido.advertiser_id) : String(elegido.advertiser_id ?? "");
  const siteId = String(elegido.site_id ?? "");
  if (!PATRON_ID_NUM.test(advertiserId) || !PATRON_SITE.test(siteId)) {
    throw new MlRespuestaInesperadaError(200, "/advertising/advertisers");
  }
  return {
    estado: "ok",
    advertiserId,
    siteId,
    nombre: typeof elegido.advertiser_name === "string" ? elegido.advertiser_name : null,
    cuentaNombre: typeof elegido.account_name === "string" ? elegido.account_name : null,
  };
}

export type CampanaAds = Record<string, unknown> & { id?: unknown };

export async function listarCampanas(
  cuenta: ContextoAds,
  filtro: { desde?: string; hasta?: string; metricas?: string; estado?: "active" | "paused" }
): Promise<CampanaAds[]> {
  const site = exigirSite(cuenta.siteId);
  const adv = exigirIdNum(cuenta.advertiserId, "advertiser_id");
  if (filtro.desde) exigirFecha(filtro.desde);
  if (filtro.hasta) exigirFecha(filtro.hasta);
  const ruta = `/advertising/${site}/advertisers/${adv}/product_ads/campaigns/search`;
  return todasLasPaginas<CampanaAds>(ruta, cuenta.token, {
    "filters[status]": filtro.estado,
    date_from: filtro.desde,
    date_to: filtro.hasta,
    metrics: filtro.metricas,
    metrics_summary: filtro.metricas ? "true" : undefined,
  });
}

export async function metricasDiariasCampana(
  cuenta: ContextoAds,
  campanaId: string,
  rango: { desde: string; hasta: string }
): Promise<unknown> {
  const site = exigirSite(cuenta.siteId);
  const id = exigirIdNum(campanaId, "campaña");
  const ruta = `/advertising/${site}/product_ads/campaigns/${id}`;
  const resp = await pedirLecturaMl<unknown>(ruta, cuenta.token, {
    cabeceras: CABECERA_ADS,
    query: query({
      date_from: exigirFecha(rango.desde),
      date_to: exigirFecha(rango.hasta),
      metrics: METRICAS_CAMPANA,
      aggregation_type: "DAILY",
    }),
  });
  if (!resp.ok) throw new MlRespuestaInesperadaError(resp.status, ruta);
  return resp.data;
}

export async function metricasDiariasCuenta(cuenta: ContextoAds, rango: { desde: string; hasta: string }): Promise<unknown[]> {
  const site = exigirSite(cuenta.siteId);
  const adv = exigirIdNum(cuenta.advertiserId, "advertiser_id");
  const ruta = `/advertising/${site}/advertisers/${adv}/product_ads/campaigns/search`;
  return todasLasPaginas(ruta, cuenta.token, {
    date_from: exigirFecha(rango.desde),
    date_to: exigirFecha(rango.hasta),
    metrics: METRICAS_CAMPANA,
    aggregation_type: "DAILY",
  });
}

export async function adGroupsDeCampana(
  cuenta: ContextoAds,
  filtro: { campanas: string[]; desde: string; hasta: string; estado: "active" | "paused" }
): Promise<unknown[]> {
  const site = exigirSite(cuenta.siteId);
  const adv = exigirIdNum(cuenta.advertiserId, "advertiser_id");
  const ids = filtro.campanas.map((id) => exigirIdNum(id, "campaña"));
  if (ids.length === 0) return [];
  const ruta = `/advertising/${site}/advertisers/${adv}/product_ads/ad_groups/search`;
  const acumulado: unknown[] = [];
  // La URL no puede crecer sin límite. Se parte la lista de campañas;
  // el filtro `filters[campaigns]` es el documentado.
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const paginaLote = await todasLasPaginas(ruta, cuenta.token, {
      "filters[campaigns]": lote.join(","),
      "filters[statuses]": filtro.estado,
      date_from: exigirFecha(filtro.desde),
      date_to: exigirFecha(filtro.hasta),
      metrics: METRICAS_AD_GROUP_BUSQUEDA,
      metrics_summary: "true",
    });
    acumulado.push(...paginaLote);
  }
  return acumulado;
}

export async function metricasAdGroupsDelDia(cuenta: ContextoAds, campanaId: string, fecha: string): Promise<unknown> {
  const site = exigirSite(cuenta.siteId);
  const id = exigirIdNum(campanaId, "campaña");
  const dia = exigirFecha(fecha);
  // Sin filters[ad_group_ids] la doc solo acepta un día (date_from = date_to).
  const ruta = `/advertising/${site}/product_ads/campaigns/${id}/ad_groups/metrics`;
  const resp = await pedirLecturaMl<unknown>(ruta, cuenta.token, {
    cabeceras: CABECERA_ADS,
    query: query({
      date_from: dia,
      date_to: dia,
      metrics: METRICAS_ANUNCIO,
    }),
  });
  if (!resp.ok) throw new MlRespuestaInesperadaError(resp.status, ruta);
  return resp.data;
}

export async function anunciosDeAdGroup(
  cuenta: ContextoAds,
  adGroupId: string,
  rango: { desde: string; hasta: string }
): Promise<unknown[]> {
  const site = exigirSite(cuenta.siteId);
  const id = exigirIdNum(adGroupId, "ad_group");
  const ruta = `/advertising/${site}/product_ads/ad_groups/${id}/ads`;
  return todasLasPaginas(ruta, cuenta.token, {
    date_from: exigirFecha(rango.desde),
    date_to: exigirFecha(rango.hasta),
    metrics: METRICAS_ANUNCIO,
  });
}

export function idNumerico(valor: unknown): string | null {
  if (typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0) return String(valor);
  if (typeof valor === "string" && PATRON_ID_NUM.test(valor)) return valor;
  return null;
}

export function itemIdDe(valor: unknown): string | null {
  return typeof valor === "string" && PATRON_ID_PRODUCTO_O_ITEM.test(valor) ? valor : null;
}

export { LimiteMercadoLibreError };
