// Solo lectura. Antes de mostrar en Optimización cuántos clips tiene
// una publicación (y avisar si no tiene), se confirma con una cuenta
// real cómo responde Mercado Libre (CLAUDE.md: nunca se adivina la API).
// Lo que se sabe hoy (módulo Publicar Clip, retirado en #383):
// - GET /marketplace/items/{id}/clips está documentado SOLO para Global
//   Selling; en los sitios de desarrolladores de CO/AR/MX/BR da 404.
// - GET /items/{id}/clips (ruta "local") nunca se confirmó.
// - video_id del ítem es el video de YouTube viejo, no los clips.
//
// - Solo GET, todo por lib/ml/cliente.ts (pedirLecturaMl).
// - No imprime el token ni textos libres: códigos HTTP, nombres de
//   campos y solo los valores de una lista blanca (estados, totales).
//
//   npx tsx scripts/explorar-clips.ts --empresa=<uuid> --cuenta=<uuid> [--item=MCO123]

import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { pedirLecturaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VENDEDOR = /^\d{1,20}$/;
const ID_ITEM = /^[A-Z]{3}\d{6,15}$/;
const TEXTO_SEGURO = new Set(["status", "moderation_status", "type", "source", "tag", "site_id", "listing_type_id", "catalog_listing", "error", "message"]);
const NUMERO_SEGURO = new Set(["total", "limit", "offset", "count", "duration", "status"]);

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

async function probar(etiqueta: string, ruta: string, query: string, token: string): Promise<void> {
  try {
    const resp = await pedirLecturaMl<unknown>(ruta, token, { query });
    if (!resp.ok) {
      console.log(`${etiqueta}: HTTP ${resp.status}${resp.error.code ? ` (${resp.error.code})` : ""}`);
      return;
    }
    console.log(`${etiqueta}: OK ${forma(resp.data)}`);
  } catch (error) {
    console.log(`${etiqueta}: ${error instanceof Error ? error.name : "error"}`);
  }
}

async function main(): Promise<number> {
  const empresaId = argumento("empresa");
  const cuentaMlId = argumento("cuenta");
  const itemPedido = argumento("item");
  if (!empresaId || !cuentaMlId || !UUID.test(empresaId) || !UUID.test(cuentaMlId) || (itemPedido !== null && !ID_ITEM.test(itemPedido))) {
    console.log("Uso: --empresa=<uuid> --cuenta=<uuid> [--item=MCO123] (ver scripts/buscar-cuenta-ml.ts).");
    return 1;
  }
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ vendedor: cuentasMl.cuentaIdExterna })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, cuentaMlId), eq(cuentasMl.empresaId, empresaId)))
  );
  if (!cuenta || !ID_VENDEDOR.test(cuenta.vendedor)) {
    console.log("No se encontró la cuenta en esa empresa.");
    return 1;
  }
  const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);

  // La publicación pedida y hasta 5 activas más: si alguna tiene clips,
  // se ve la forma real de la respuesta con datos.
  const activas = await pedirLecturaMl<{ results?: unknown[] }>(`/users/${cuenta.vendedor}/items/search`, token, { query: "?status=active&limit=5" }).catch(() => null);
  const ids = [
    ...(itemPedido ? [itemPedido] : []),
    ...((activas?.ok ? activas.data.results : []) ?? []).filter((r): r is string => typeof r === "string" && ID_ITEM.test(r)),
  ];
  const unicos = [...new Set(ids)].slice(0, 6);
  if (unicos.length === 0) {
    console.log("La cuenta no tiene publicaciones activas para probar.");
    return 0;
  }
  for (const [i, id] of unicos.entries()) {
    console.log(`--- publicación ${i + 1}${id === itemPedido ? " (la pedida)" : ""}`);
    await probar("ítem (video_id, tags)", `/items/${id}`, "?attributes=id,video_id,tags,listing_type_id,catalog_listing", token);
    await probar("clips /marketplace", `/marketplace/items/${id}/clips`, "", token);
    await probar("clips local", `/items/${id}/clips`, "", token);
  }
  return 0;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : "desconocido"}`);
    process.exit(1);
  });
