import { pedirLecturaMl, tieneAutomatizacionPrecioMl } from "@/lib/ml/cliente";

// SOLO servidor. Diagnóstico de solo lectura de una publicación (botón en
// el detalle de Optimización, solo administradores; condiciones de Pablo
// y Mateo, 21-nov). Para ver por qué el título o el precio no cambian en
// las publicaciones «User Products» (MCO4656053860: BODY_INVALID_FIELDS).
// Mismas consultas que scripts/explorar-familia-precio.ts (#529):
// 1. GET /items/{id} con los campos de familia y de precio.
// 2. GET /items/{id}/prices.
// 3. GET /user-products/{user_product_id}, si lo trae.
// 4. Si tiene la automatización de precios activa.
// Nada se guarda ni se escribe. Nunca se pide seller_id ni se muestra el
// token: los textos se muestran solo si su clave está en la lista blanca
// (ids de la publicación, estados, tipos, etiquetas) o si son el título
// y family_name (datos que el vendedor ya ve en su publicación).

const ID_USER_PRODUCT = /^[A-Z]{3}U?\d{3,20}$/;
const CLAVES_TEXTO = new Set([
  "id",
  "user_product_id",
  "family_id",
  "status",
  "sub_status",
  "listing_type_id",
  "buying_mode",
  "currency_id",
  "type",
  "tags",
  "deal_ids",
  "price_id",
  "promotion_id",
  "promotion_type",
  "channel",
  "mode",
  "context",
  "error",
  "message",
  "code",
  "category_id",
  "domain_id",
  "catalog_product_id",
]);
// Nunca se muestran, aunque Mercado Libre las devuelva (ids de la cuenta).
const CLAVES_OCULTAS = new Set(["seller_id", "user_id", "owner_id", "official_store_id"]);

const CAMPOS_ITEM = [
  "id",
  "status",
  "sub_status",
  "title",
  "family_name",
  "user_product_id",
  "family_id",
  "catalog_listing",
  "catalog_product_id",
  "listing_type_id",
  "buying_mode",
  "currency_id",
  "price",
  "base_price",
  "original_price",
  "sold_quantity",
  "variations",
  "deal_ids",
  "tags",
  "category_id",
  "domain_id",
].join(",");

// Forma de un valor sin datos libres: números y booleanos tal cual,
// textos solo de la lista blanca (el resto, su largo).
export function forma(valor: unknown, profundidad = 0, clave = ""): string {
  if (valor === null) return "null";
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (typeof valor === "string") return CLAVES_TEXTO.has(clave) && valor.length <= 60 ? `"${valor}"` : `texto(${valor.length})`;
  if (Array.isArray(valor)) {
    if (profundidad >= 3) return `lista(${valor.length})`;
    return `lista(${valor.length})${valor.length ? ` [${valor.slice(0, 6).map((v) => forma(v, profundidad + 1, clave)).join(", ")}${valor.length > 6 ? ", …" : ""}]` : ""}`;
  }
  if (typeof valor !== "object") return typeof valor;
  if (profundidad >= 4) return "objeto";
  return `{ ${Object.entries(valor as Record<string, unknown>)
    .filter(([k]) => !CLAVES_OCULTAS.has(k))
    .map(([k, v]) => `${k}: ${forma(v, profundidad + 1, k)}`)
    .join(", ")} }`;
}

export type RespuestaDiagnostico = { ok: true; data: unknown } | { ok: false; status: number };

export type EntradaDiagnostico = {
  itemId: string;
  item: RespuestaDiagnostico;
  precios: RespuestaDiagnostico | null;
  userProduct: RespuestaDiagnostico | null;
  automatizada: boolean | null;
};

function textoLibre(v: unknown): string {
  return typeof v === "string" ? `"${v.replace(/\s+/g, " ").slice(0, 120)}"` : forma(v);
}

// Puro: arma las líneas que ve el administrador (y que copia a soporte).
export function lineasDiagnostico(e: EntradaDiagnostico): string[] {
  const lineas: string[] = [];
  if (!e.item.ok) return [`items/${e.itemId}: HTTP ${e.item.status}`];
  const d = (e.item.data && typeof e.item.data === "object" ? e.item.data : {}) as Record<string, unknown>;
  const { title, family_name, variations, ...resto } = d;
  lineas.push(`items/${e.itemId}: ${forma(resto)}`);
  lineas.push(`título: ${textoLibre(title)}`);
  lineas.push(`family_name: ${family_name === undefined ? "no viene" : textoLibre(family_name)}`);
  lineas.push(`variaciones: ${Array.isArray(variations) ? variations.length : "no vienen"}`);
  if (typeof title === "string" && typeof family_name === "string") {
    lineas.push(`el título empieza con family_name: ${title.toLowerCase().startsWith(family_name.toLowerCase()) ? "sí" : "no"}`);
  }
  if (e.precios) lineas.push(`items/${e.itemId}/prices: ${e.precios.ok ? forma(e.precios.data) : `HTTP ${e.precios.status}`}`);
  const userProductId = typeof d.user_product_id === "string" && ID_USER_PRODUCT.test(d.user_product_id) ? d.user_product_id : null;
  if (!userProductId) {
    lineas.push("sin user_product_id: no es una publicación «User Products».");
  } else if (e.userProduct) {
    if (e.userProduct.ok) {
      const up = (e.userProduct.data && typeof e.userProduct.data === "object" ? e.userProduct.data : {}) as Record<string, unknown>;
      const { name, ...upResto } = up;
      lineas.push(`user-products/${userProductId}: ${forma(upResto)}`);
      lineas.push(`nombre del user product: ${textoLibre(name)}`);
    } else {
      lineas.push(`user-products/${userProductId}: HTTP ${e.userProduct.status}`);
    }
  }
  lineas.push(`automatización de precios activa: ${e.automatizada === null ? "no se supo" : e.automatizada ? "sí" : "no"}`);
  return lineas;
}

async function leer(ruta: string, token: string, query?: string): Promise<RespuestaDiagnostico> {
  const r = await pedirLecturaMl<unknown>(ruta, token, query ? { query } : undefined);
  return r.ok ? { ok: true, data: r.data } : { ok: false, status: r.status };
}

// Solo GET. itemId ya validado por quien llama (PATRON_ID_PRODUCTO_O_ITEM).
export async function diagnosticarPublicacion(itemId: string, token: string): Promise<string[]> {
  const item = await leer(`/items/${itemId}`, token, `?attributes=${CAMPOS_ITEM}`);
  if (!item.ok) return lineasDiagnostico({ itemId, item, precios: null, userProduct: null, automatizada: null });
  const d = (item.data && typeof item.data === "object" ? item.data : {}) as Record<string, unknown>;
  const userProductId = typeof d.user_product_id === "string" && ID_USER_PRODUCT.test(d.user_product_id) ? d.user_product_id : null;
  const [precios, userProduct, automatizada] = await Promise.all([
    leer(`/items/${itemId}/prices`, token),
    userProductId ? leer(`/user-products/${userProductId}`, token) : Promise.resolve(null),
    tieneAutomatizacionPrecioMl(itemId, token),
  ]);
  return lineasDiagnostico({ itemId, item, precios, userProduct, automatizada });
}
