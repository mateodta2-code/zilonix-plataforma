// Solo lectura. Antes de construir la Fase 1 de "Optimización" se
// confirma con una cuenta real cómo responde Mercado Libre (CLAUDE.md:
// nunca se adivina la API): publicaciones pausadas, detalle en lote,
// visitas de 7 días, calidad de la publicación y competencia en el
// catálogo.
//
// - Solo GET, todo por lib/ml/cliente.ts (pedirLecturaMl).
// - No imprime el token ni textos libres: códigos HTTP, nombres de
//   campos y solo los valores de una lista blanca (estados, puntajes,
//   totales).
//
//   npx tsx scripts/explorar-optimizacion.ts --empresa=<uuid> --cuenta=<uuid>

import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { pedirLecturaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VENDEDOR = /^\d{1,20}$/;
const ID_ITEM = /^[A-Z]{3}\d{6,15}$/;
// Valores que se pueden mostrar: estados, tipos y puntajes. Nada que
// identifique a una persona.
const TEXTO_SEGURO = new Set([
  "status",
  "sub_status",
  "listing_type_id",
  "logistic_type",
  "mode",
  "level",
  "level_wording",
  "bucket",
  "condition",
  "catalog_listing",
  "free_shipping",
  "unit",
  "type",
  "key",
  "mode_type",
  "competition_status",
  "visit_share",
  "id",
  "title",
  "wording",
  "level_id",
  "power_seller_status",
  "tag",
  "currency_id",
]);
const NUMERO_SEGURO = new Set(["total", "limit", "offset", "score", "total_visits", "visits", "code", "boosts", "last", "progress", "quantity", "order", "sold_quantity", "price", "available_quantity", "rate", "original_price"]);

function argumento(nombre: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${nombre}=`));
  return arg ? arg.slice(nombre.length + 3).trim() : null;
}

function forma(valor: unknown, profundidad = 0, maximo = 4): string {
  if (valor === null) return "null";
  if (Array.isArray(valor)) return `array(${valor.length})${valor.length > 0 && profundidad < maximo ? ` de ${forma(valor[0], profundidad + 1, maximo)}` : ""}`;
  if (typeof valor !== "object") return typeof valor;
  if (profundidad >= maximo) return "objeto";
  const partes = Object.entries(valor as Record<string, unknown>).map(([clave, v]) => {
    if (TEXTO_SEGURO.has(clave) && (typeof v === "string" || typeof v === "boolean")) return `${clave}=${String(v)}`;
    if (NUMERO_SEGURO.has(clave) && typeof v === "number") return `${clave}=${v}`;
    return `${clave}: ${forma(v, profundidad + 1, maximo)}`;
  });
  return `{ ${partes.join(", ")} }`;
}

async function probar(
  etiqueta: string,
  ruta: string,
  query: string,
  token: string,
  cabeceras?: Record<string, string>,
  maximo = 4
): Promise<unknown> {
  try {
    const resp = await pedirLecturaMl<unknown>(ruta, token, { query, cabeceras });
    if (!resp.ok) {
      console.log(`${etiqueta}: HTTP ${resp.status}${resp.error.code ? ` (${resp.error.code})` : ""}`);
      return null;
    }
    console.log(`${etiqueta}: OK ${forma(resp.data, 0, maximo)}`);
    return resp.data;
  } catch (error) {
    console.log(`${etiqueta}: ${error instanceof Error ? error.name : "error"}`);
    return null;
  }
}

function hace(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
}

async function main(): Promise<number> {
  const empresaId = argumento("empresa");
  const cuentaMlId = argumento("cuenta");
  if (!empresaId || !cuentaMlId || !UUID.test(empresaId) || !UUID.test(cuentaMlId)) {
    console.log("Uso: --empresa=<uuid> --cuenta=<uuid> (ver scripts/buscar-cuenta-ml.ts).");
    return 1;
  }
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ vendedor: cuentasMl.cuentaIdExterna, siteId: cuentasMl.siteId })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, cuentaMlId), eq(cuentasMl.empresaId, empresaId)))
  );
  if (!cuenta || !ID_VENDEDOR.test(cuenta.vendedor)) {
    console.log("No se encontró la cuenta en esa empresa.");
    return 1;
  }
  const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
  const vendedor = cuenta.vendedor;

  // 1. Publicaciones activas y pausadas.
  const activas = (await probar("items activas", `/users/${vendedor}/items/search`, "?status=active&limit=5", token)) as { results?: unknown[] } | null;
  await probar("items pausadas", `/users/${vendedor}/items/search`, "?status=paused&limit=5", token);
  await probar("items sin filtro de estado", `/users/${vendedor}/items/search`, "?limit=5", token);
  // Una de catálogo, si hay, para probar la competencia.
  const catalogo = (await probar("items de catálogo", `/users/${vendedor}/items/search`, "?status=active&catalog_listing=true&limit=1", token)) as {
    results?: unknown[];
  } | null;

  const ids = (activas?.results ?? []).filter((r): r is string => typeof r === "string" && ID_ITEM.test(r));
  const deCatalogo = (catalogo?.results ?? []).filter((r): r is string => typeof r === "string" && ID_ITEM.test(r));
  if (ids.length === 0) {
    console.log("La cuenta no tiene publicaciones activas: no se pueden probar las demás llamadas.");
    return 0;
  }
  const item = ids[0];
  const itemCatalogo = deCatalogo[0] ?? item;

  // 2. Detalle en lote (multiget), solo los campos de la lista.
  await probar(
    "multiget",
    "/items",
    `?ids=${ids.slice(0, 3).join(",")}&attributes=id,status,sub_status,price,original_price,listing_type_id,shipping,catalog_listing,catalog_product_id,available_quantity,thumbnail,secure_thumbnail,health,tags`,
    token
  );

  // 2b. La página pide 20 a la vez y más campos que el multiget de
  // arriba, y Mercado Libre respondió 403 (17-nov). Se prueban 20 ids con
  // cada campo extra por separado para ver cuál lo provoca.
  const veinte = (await probar("items activas (20)", `/users/${vendedor}/items/search`, "?status=active&limit=20", token)) as { results?: unknown[] } | null;
  const ids20 = (veinte?.results ?? []).filter((r): r is string => typeof r === "string" && ID_ITEM.test(r));
  const base = "id,status,price,original_price,listing_type_id,shipping,catalog_listing,available_quantity,thumbnail";
  for (const extra of ["", "title", "secure_thumbnail", "permalink", "seller_custom_field", "attributes"]) {
    await probar(`multiget 20 +${extra || "nada"}`, "/items", `?ids=${ids20.join(",")}&attributes=${base}${extra ? `,${extra}` : ""}`, token, undefined, 0);
  }
  await probar("multiget 3 completo", "/items", `?ids=${ids20.slice(0, 3).join(",")}&attributes=${base},title,secure_thumbnail,permalink,seller_custom_field,attributes`, token, undefined, 0);

  // 2c. Fase 3 (editar): ventas de la publicación (el título solo se
  // cambia sin ventas), variantes, fotos y si tiene la automatización de
  // precios de Mercado Libre activa (con ella no se cambia el precio).
  await probar(
    "item para editar",
    `/items/${item}`,
    "?attributes=id,status,price,sold_quantity,title,variations,pictures,tags,deal_ids,catalog_listing",
    token,
    undefined,
    2
  );
  await probar("automatización de precio", `/pricing-automation/items/${item}/automation`, "", token, undefined, 3);
  await probar("reglas de automatización", `/pricing-automation/items/${item}/rules`, "", token, undefined, 3);
  for (const id of ids20.slice(0, 20)) {
    const d = (await pedirLecturaMl<{ variations?: unknown[] }>(`/items/${id}`, token, { query: "?attributes=id,variations" }).catch(() => null)) as {
      ok: boolean;
      data?: { variations?: unknown[] };
    } | null;
    if (d?.ok && Array.isArray(d.data?.variations) && d.data.variations.length > 0) {
      await probar("item con variantes", `/items/${id}`, "?attributes=id,price,variations", token, undefined, 3);
      break;
    }
  }

  // 3. Visitas de los últimos 7 días.
  await probar("visitas por rango (lote)", "/items/visits", `?ids=${ids.slice(0, 3).join(",")}&date_from=${hace(7)}&date_to=${hace(0)}`, token);
  await probar("visitas ventana 7 días", `/items/${item}/visits/time_window`, "?last=7&unit=day", token);
  // Fase 2 (detalle): hasta cuántos días hacia atrás da visitas por día,
  // para el selector de período (90 días + el período anterior = 180).
  for (const dias of [30, 90, 150, 180, 365]) {
    await probar(`visitas ventana ${dias} días`, `/items/${item}/visits/time_window`, `?last=${dias}&unit=day`, token, undefined, 1);
  }
  await probar("visitas rango un ítem", "/items/visits", `?ids=${item}&date_from=${hace(60)}&date_to=${hace(30)}`, token, undefined, 1);

  // Variantes en lote: con fecha y hora completas, y la ruta /visits/items.
  const desde = `${hace(7)}T00:00:00.000-00:00`;
  const hasta = `${hace(0)}T00:00:00.000-00:00`;
  await probar("visitas lote fecha-hora", "/items/visits", `?ids=${ids.slice(0, 3).join(",")}&date_from=${encodeURIComponent(desde)}&date_to=${encodeURIComponent(hasta)}`, token);
  await probar("visitas lote /visits/items", "/visits/items", `?ids=${ids.slice(0, 3).join(",")}&date_from=${hace(7)}&date_to=${hace(0)}`, token);
  await probar("visitas usuario 7 días", `/users/${vendedor}/items_visits/time_window`, "?last=7&unit=day", token);

  // 4. Calidad de la publicación (con todo el detalle de los objetivos).
  await probar("calidad /performance", `/item/${item}/performance`, "", token, undefined, 7);
  await probar("calidad /health (vieja)", `/items/${item}/health`, "", token);

  // 5. Competencia en el catálogo.
  await probar("competencia price_to_win", `/items/${itemCatalogo}/price_to_win`, `?siteId=${cuenta.siteId ?? ""}&version=v2`, token);
  console.log(`(competencia probada con una publicación ${deCatalogo.length > 0 ? "de catálogo" : "que NO es de catálogo"})`);

  // 6. Fase 4 (competidores): vendedores del mismo producto de catálogo y
  // qué se puede leer de SUS publicaciones (título, portada, cuotas,
  // descripción, fotos, video/clips) y de su reputación. Se recorren las
  // publicaciones de catálogo hasta dar con un producto con otros vendedores.
  const catalogo20 = (await probar("items de catálogo (20)", `/users/${vendedor}/items/search`, "?catalog_listing=true&limit=20", token, undefined, 0)) as {
    results?: unknown[];
  } | null;
  let probado = false;
  for (const propio of (catalogo20?.results ?? []).filter((r): r is string => typeof r === "string" && ID_ITEM.test(r))) {
    const det = await pedirLecturaMl<{ catalog_product_id?: unknown }>(`/items/${propio}`, token, { query: "?attributes=id,catalog_product_id" }).catch(() => null);
    const producto = det?.ok && typeof det.data.catalog_product_id === "string" && /^[A-Z]{3}\d+$/.test(det.data.catalog_product_id) ? det.data.catalog_product_id : null;
    if (!producto) continue;
    const ofertas = await pedirLecturaMl<{ results?: { item_id?: unknown; seller_id?: unknown }[] }>(`/products/${producto}/items`, token).catch(() => null);
    const ajena = ofertas?.ok ? (ofertas.data.results ?? []).find((o) => typeof o.item_id === "string" && o.item_id !== propio) : undefined;
    if (!ajena || typeof ajena.item_id !== "string" || !ID_ITEM.test(ajena.item_id)) continue;
    console.log(`producto con ${(ofertas?.ok ? ofertas.data.results?.length : 0) ?? 0} vendedores`);
    await probar("ofertas del producto", `/products/${producto}/items`, "", token, undefined, 3);
    await probar(
      "competidor multiget",
      "/items",
      `?ids=${ajena.item_id}&attributes=id,title,thumbnail,price,original_price,shipping,pictures,video_id,installments,sale_terms,tags,seller_id,listing_type_id,catalog_listing`,
      token,
      undefined,
      4
    );
    await probar("competidor descripción", `/items/${ajena.item_id}/description`, "", token, undefined, 1);
    if (typeof ajena.seller_id === "number" || typeof ajena.seller_id === "string") {
      await probar("competidor reputación", `/users/${String(ajena.seller_id)}`, "?attributes=id,seller_reputation", token, undefined, 3);
    }
    probado = true;
    break;
  }
  if (!probado) console.log("Ningún producto de catálogo de esta cuenta tiene otros vendedores.");
  return 0;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : "desconocido"}`);
    process.exit(1);
  });
