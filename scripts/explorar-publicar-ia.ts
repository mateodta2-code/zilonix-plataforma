// Solo lectura. Antes del PR2 de Publicar → «Crear con IA» (imágenes) se
// confirma con una cuenta real (CLAUDE.md: nunca se adivina la API):
// 1. La versión de Postgres (la migración 0033 usa ON DELETE SET NULL de
//    una sola columna, que pide Postgres 15 o más).
// 2. GET /trends/{SITE_ID}/{CATEGORY_ID} (títulos del PR1).
// 3. POST /moderations/pictures/diagnostic con una foto que YA tiene
//    una publicación de la cuenta: solo la analiza, no toca nada.
//
// - Todo a Mercado Libre por lib/ml/cliente.ts.
// - No imprime el token, ni URLs de fotos, ni textos libres: códigos
//   HTTP, nombres de campos, números y solo los valores de una lista
//   blanca (tipos de diagnóstico, acciones, estados).
//
//   npx tsx scripts/explorar-publicar-ia.ts --empresa=<uuid> --cuenta=<uuid>

import { and, eq, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { diagnosticarImagenMl, pedirLecturaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VENDEDOR = /^\d{1,20}$/;
const ID_ITEM = /^[A-Z]{3}\d{6,15}$/;
// Valores de texto que sí se muestran (no son datos libres).
const CLAVES_TEXTO = new Set(["type", "action", "status", "code", "error", "result", "picture_type", "category_id", "detection", "name", "level"]);

function argumento(nombre: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${nombre}=`));
  return arg ? arg.slice(nombre.length + 3).trim() : null;
}

function forma(valor: unknown, profundidad = 0, clave = ""): string {
  if (valor === null) return "null";
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (typeof valor === "string") return CLAVES_TEXTO.has(clave) && valor.length <= 60 ? `"${valor}"` : "string";
  if (Array.isArray(valor)) {
    if (profundidad >= 3) return `array(${valor.length})`;
    return `array(${valor.length})${valor.length ? ` [${valor.slice(0, 4).map((v) => forma(v, profundidad + 1, clave)).join(", ")}${valor.length > 4 ? ", …" : ""}]` : ""}`;
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
  if (!empresaId || !cuentaMlId || !UUID.test(empresaId) || !UUID.test(cuentaMlId)) {
    console.log("Uso: --empresa=<uuid> --cuenta=<uuid> (ver scripts/buscar-cuenta-ml.ts).");
    return 1;
  }

  // 1. Versión de Postgres.
  const [version] = await dbComoEmpresa(empresaId, (tx) => tx.execute<{ v: string }>(sql`select current_setting('server_version') as v`));
  console.log(`postgres: ${String((version as { v?: unknown } | undefined)?.v ?? "?").split(" ")[0]}`);

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

  // Una publicación activa de la cuenta: su categoría real y su primera foto.
  const activas = await pedirLecturaMl<{ results?: unknown[] }>(`/users/${cuenta.vendedor}/items/search`, token, { query: "?status=active&limit=1" });
  const itemId = activas.ok ? (activas.data.results ?? []).find((r): r is string => typeof r === "string" && ID_ITEM.test(r)) : undefined;
  if (!itemId) {
    console.log("La cuenta no tiene publicaciones activas para probar.");
    return 0;
  }
  const item = await pedirLecturaMl<{ category_id?: unknown; pictures?: { secure_url?: unknown }[] }>(`/items/${itemId}`, token, { query: "?attributes=category_id,pictures" });
  const categoria = item.ok && typeof item.data.category_id === "string" ? item.data.category_id : null;
  const foto = item.ok ? item.data.pictures?.find((p) => typeof p.secure_url === "string")?.secure_url : undefined;
  console.log(`categoría de prueba: ${categoria ?? "?"} · fotos: ${item.ok ? (item.data.pictures?.length ?? 0) : "?"}`);

  // 2. Tendencias de la categoría.
  if (categoria) {
    // Directo (tendenciasCategoriaMl vive en el PR1, todavía fuera de main).
    const crudo = await pedirLecturaMl<unknown>(`/trends/${cuenta.siteId}/${categoria}`, token).catch((e: unknown) => ({ ok: false as const, status: e instanceof Error ? e.name : "error" }));
    console.log(`trends/${cuenta.siteId}/${categoria}: ${"data" in crudo ? forma(crudo.data) : `HTTP ${crudo.status}`}`);
  }

  // 3. Diagnóstico de la foto (thumbnail y other).
  if (categoria && typeof foto === "string") {
    for (const tipo of ["thumbnail", "other"] as const) {
      const r = await diagnosticarImagenMl(foto, categoria, tipo, token);
      console.log(`diagnóstico ${tipo}: HTTP ${r.status} ${forma(r.data)}`);
    }
  } else {
    console.log("diagnóstico: sin categoría o sin foto para probar.");
  }
  return 0;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.name : "desconocido"}`);
    process.exit(1);
  });
