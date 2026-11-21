// Solo lectura. Optimización → editar título y precio de una publicación
// «User Products» (las que Zilonix publica con family_name). Visto en
// staging (21-nov): MCO4656053860 respondió BODY_INVALID_FIELDS al
// cambiar el título y el precio no cambió. Antes de tocar el código se
// confirma con la publicación real (CLAUDE.md: nunca se adivina la API):
// 1. GET /items/{id}: si trae family_name, user_product_id y family_id,
//    y cómo viene el precio (price, base_price, original_price, deals).
// 2. GET /items/{id}/prices: los precios que maneja Mercado Libre.
// 3. GET /user-products/{user_product_id}: su family_id.
// 4. Si tiene la automatización de precios activa.
//
// - Todo a Mercado Libre por lib/ml/cliente.ts. No escribe nada.
// - No imprime el token ni textos libres (título, family_name): de los
//   textos muestra solo su largo, salvo los de una lista blanca (ids,
//   estados, tipos, etiquetas).
//
//   npx tsx scripts/explorar-familia-precio.ts --empresa=<uuid> --cuenta=<uuid> --item=MCO4656053860

import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { pedirLecturaMl, tieneAutomatizacionPrecioMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_ITEM = /^[A-Z]{3}\d{6,15}$/;
const ID_USER_PRODUCT = /^[A-Z]{3}U?\d{3,20}$/;
// Valores de texto que sí se muestran (no son datos libres).
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

function argumento(nombre: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${nombre}=`));
  return arg ? arg.slice(nombre.length + 3).trim() : null;
}

function forma(valor: unknown, profundidad = 0, clave = ""): string {
  if (valor === null) return "null";
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (typeof valor === "string") return CLAVES_TEXTO.has(clave) && valor.length <= 60 ? `"${valor}"` : `string(${valor.length})`;
  if (Array.isArray(valor)) {
    if (profundidad >= 3) return `array(${valor.length})`;
    return `array(${valor.length})${valor.length ? ` [${valor.slice(0, 6).map((v) => forma(v, profundidad + 1, clave)).join(", ")}${valor.length > 6 ? ", …" : ""}]` : ""}`;
  }
  if (typeof valor !== "object") return typeof valor;
  if (profundidad >= 4) return "objeto";
  return `{ ${Object.entries(valor as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${forma(v, profundidad + 1, k)}`)
    .join(", ")} }`;
}

async function main(): Promise<number> {
  const empresaId = argumento("empresa");
  const cuentaMlId = argumento("cuenta");
  const itemId = argumento("item");
  if (!empresaId || !cuentaMlId || !itemId || !UUID.test(empresaId) || !UUID.test(cuentaMlId) || !ID_ITEM.test(itemId)) {
    console.log("Uso: --empresa=<uuid> --cuenta=<uuid> --item=MCO123 (ver scripts/buscar-cuenta-ml.ts).");
    return 1;
  }
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: cuentasMl.id })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, cuentaMlId), eq(cuentasMl.empresaId, empresaId)))
  );
  if (!cuenta) {
    console.log("No se encontró la cuenta en esa empresa.");
    return 1;
  }
  const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);

  // 1. La publicación, con los campos de familia y de precio.
  const campos = [
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
  const item = await pedirLecturaMl<Record<string, unknown>>(`/items/${itemId}`, token, { query: `?attributes=${campos}` });
  if (!item.ok) {
    console.log(`items/${itemId}: HTTP ${item.status}`);
    return 0;
  }
  const d = item.data;
  const { title, family_name, variations, ...resto } = d;
  console.log(`items/${itemId}: ${forma(resto)}`);
  console.log(`  title: ${forma(title)} · family_name: ${forma(family_name)} · variaciones: ${Array.isArray(variations) ? variations.length : "?"}`);
  if (typeof title === "string" && typeof family_name === "string") {
    console.log(`  el título empieza con family_name: ${title.toLowerCase().startsWith(family_name.toLowerCase())}`);
  }

  // 2. Precios que maneja Mercado Libre para la publicación.
  const precios = await pedirLecturaMl<unknown>(`/items/${itemId}/prices`, token);
  console.log(`items/${itemId}/prices: ${precios.ok ? forma(precios.data) : `HTTP ${precios.status}`}`);

  // 3. El User Product y su familia.
  const userProductId = typeof d.user_product_id === "string" && ID_USER_PRODUCT.test(d.user_product_id) ? d.user_product_id : null;
  if (userProductId) {
    const up = await pedirLecturaMl<Record<string, unknown>>(`/user-products/${userProductId}`, token);
    if (up.ok) {
      const { name, ...upResto } = up.data;
      console.log(`user-products/${userProductId}: ${forma(upResto)} · name: ${forma(name)}`);
    } else {
      console.log(`user-products/${userProductId}: HTTP ${up.status}`);
    }
  } else {
    console.log("sin user_product_id: no es una publicación «User Products».");
  }

  // 4. Automatización de precios.
  console.log(`automatización de precios activa: ${String(await tieneAutomatizacionPrecioMl(itemId, token))}`);
  return 0;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.name : "desconocido"}`);
    process.exit(1);
  });
