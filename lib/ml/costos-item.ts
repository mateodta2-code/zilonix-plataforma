// Issue #254 — precio vigente, comisión y envío estimado de un ítem
// anunciado. Solo GET. La comisión SIEMPRE manda logistic_type y
// shipping_mode (desde el 23/03/2026 en Colombia, sin esos dos el
// fixed_fee no coincide con lo cobrado — api-research §5). El envío
// que paga el vendedor es el estimado de una sola unidad (F9), no el
// costo real de un despacho.

import { MlRespuestaInesperadaError, PATRON_ID_PRODUCTO_O_ITEM, PATRON_ID_VENDEDOR, pedirLecturaMl } from "@/lib/ml/cliente";
import { DecimalInvalidoError, aEscala, cabeEnNumeric, textoDeNumeroJson } from "@/lib/numeros/normalizar-decimal";
import { SITE_ID_DEFECTO } from "@/lib/ml/sitios";

export type CostoItemLeido = {
  itemId: string;
  skuCodigo: string | null;
  categoryId: string | null;
  precioVentaVigente: string | null;
  precioRegular: string | null;
  comisionMl: string | null;
  comisionDetalle: Record<string, unknown> | null;
  envioVendedorEstimado: string | null;
  compradorPagaEnvio: boolean | null;
  logisticType: string | null;
  shippingMode: string | null;
  listingTypeId: string | null;
  envioEsEstimado: boolean;
};

type ItemCrudo = {
  category_id?: unknown;
  listing_type_id?: unknown;
  seller_custom_field?: unknown;
  shipping?: { logistic_type?: unknown; mode?: unknown; free_shipping?: unknown };
  tags?: unknown;
  attributes?: unknown;
};

function dinero(valor: unknown): string | null {
  if (valor == null) return null;
  try {
    const texto = typeof valor === "number" ? textoDeNumeroJson(valor) : typeof valor === "string" ? valor.trim() : null;
    if (!texto) return null;
    const opciones = typeof valor === "number" ? { origenJson: true as const } : undefined;
    const escalado = aEscala(texto, 2, opciones);
    if (!cabeEnNumeric(escalado, 14, 2)) return null;
    return escalado;
  } catch (error) {
    if (error instanceof DecimalInvalidoError) return null;
    throw error;
  }
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
}

function skuDe(item: ItemCrudo): string | null {
  if (Array.isArray(item.attributes)) {
    for (const atributo of item.attributes) {
      if (!atributo || typeof atributo !== "object") continue;
      const fila = atributo as { id?: unknown; value_name?: unknown };
      if (fila.id === "SELLER_SKU" && typeof fila.value_name === "string" && fila.value_name.trim()) return fila.value_name.trim();
    }
  }
  return texto(item.seller_custom_field);
}

function query(params: Record<string, string>): string {
  return `?${Object.entries(params)
    .map(([clave, valor]) => `${clave}=${encodeURIComponent(valor)}`)
    .join("&")}`;
}

export async function costosDeItem(entrada: {
  token: string;
  userId: string;
  itemId: string;
  siteId?: string;
}): Promise<CostoItemLeido> {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(entrada.itemId)) throw new Error("item_id inválido — no se llamó a Mercado Libre.");
  if (!PATRON_ID_VENDEDOR.test(entrada.userId)) throw new Error("user_id inválido — no se llamó a Mercado Libre.");
  const site = entrada.siteId && /^[A-Z]{3}$/.test(entrada.siteId) ? entrada.siteId : SITE_ID_DEFECTO;

  const itemResp = await pedirLecturaMl<ItemCrudo>(`/items/${entrada.itemId}`, entrada.token, {
    query: query({
      attributes: "id,category_id,listing_type_id,shipping,tags,attributes,seller_custom_field",
    }),
  });
  if (!itemResp.ok) throw new MlRespuestaInesperadaError(itemResp.status, `/items/${entrada.itemId}`);
  const item = itemResp.data;
  const logisticType = texto(item.shipping?.logistic_type);
  const shippingMode = texto(item.shipping?.mode);
  const listingTypeId = texto(item.listing_type_id);
  const categoryId = texto(item.category_id);
  const tags = Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string") : [];
  const envioGratisObligatorio = tags.includes("mandatory_free_shipping");
  const freeShipping = item.shipping?.free_shipping;
  const compradorPaga = freeShipping === false && !envioGratisObligatorio ? true : freeShipping === true || envioGratisObligatorio ? false : null;

  const precioResp = await pedirLecturaMl<{ amount?: unknown; regular_amount?: unknown }>(
    `/items/${entrada.itemId}/sale_price`,
    entrada.token,
    { query: query({ context: "channel_marketplace" }) }
  );
  if (!precioResp.ok) throw new MlRespuestaInesperadaError(precioResp.status, `/items/${entrada.itemId}/sale_price`);
  const precioVigente = dinero(precioResp.data.amount);
  const precioRegular = dinero(precioResp.data.regular_amount);

  let comisionMl: string | null = null;
  let comisionDetalle: Record<string, unknown> | null = null;
  // Sin logistic_type y shipping_mode la doc dice que el fixed_fee no
  // coincide con el cobro real. No se llama el endpoint a medias.
  if (precioVigente && categoryId && listingTypeId && logisticType && shippingMode) {
    const comisionResp = await pedirLecturaMl<unknown>(`/sites/${site}/listing_prices`, entrada.token, {
      query: query({
        price: precioVigente,
        category_id: categoryId,
        listing_type_id: listingTypeId,
        currency_id: "COP",
        logistic_type: logisticType,
        shipping_mode: shippingMode,
      }),
    });
    if (!comisionResp.ok) throw new MlRespuestaInesperadaError(comisionResp.status, `/sites/${site}/listing_prices`);
    const lista = Array.isArray(comisionResp.data) ? comisionResp.data : [comisionResp.data];
    const coincidente =
      lista.find((fila) => esRegistro(fila) && fila.listing_type_id === listingTypeId) ?? lista.find((fila) => esRegistro(fila));
    if (esRegistro(coincidente)) {
      comisionMl = dinero(coincidente.sale_fee_amount);
      comisionDetalle = esRegistro(coincidente.sale_fee_details) ? coincidente.sale_fee_details : null;
    }
  }

  let envioVendedorEstimado: string | null = null;
  let envioEsEstimado = false;
  if (compradorPaga === true) {
    envioVendedorEstimado = "0.00";
  } else if (compradorPaga === false) {
    const envioResp = await pedirLecturaMl<{ coverage?: { all_country?: { list_cost?: unknown } } }>(
      `/users/${entrada.userId}/shipping_options/free`,
      entrada.token,
      { query: query({ item_id: entrada.itemId, free_shipping: "true" }) }
    );
    if (!envioResp.ok) throw new MlRespuestaInesperadaError(envioResp.status, `/users/${entrada.userId}/shipping_options/free`);
    envioVendedorEstimado = dinero(envioResp.data.coverage?.all_country?.list_cost);
    envioEsEstimado = true;
  }

  return {
    itemId: entrada.itemId,
    skuCodigo: skuDe(item),
    categoryId,
    precioVentaVigente: precioVigente,
    precioRegular,
    comisionMl,
    comisionDetalle,
    envioVendedorEstimado,
    compradorPagaEnvio: compradorPaga,
    logisticType,
    shippingMode,
    listingTypeId,
    envioEsEstimado,
  };
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}
