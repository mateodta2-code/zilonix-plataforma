// Solo lectura. Antes de construir el módulo "Preguntas y reclamos" se
// confirma con una cuenta real cómo responde Mercado Libre al LISTAR
// preguntas sin responder y reclamos (CLAUDE.md: nunca se adivina la
// API; la rama tarea-2.9 solo confirmó leer UNA pregunta y responderla).
//
// - Solo GET, todo por lib/ml/cliente.ts (pedirLecturaMl).
// - No imprime el token, ni textos, ni nicknames, ni datos del
//   comprador: solo códigos HTTP, totales y NOMBRES de campos.
//
//   npx tsx scripts/explorar-preguntas-reclamos.ts --empresa=<uuid> --cuenta=<uuid> [--estado=ANSWERED]
//   (los uuid salen de scripts/buscar-cuenta-ml.ts --nickname=...)

import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { pedirLecturaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VENDEDOR = /^\d{1,20}$/;
// Campos que se pueden mostrar con su valor: no identifican a nadie.
const CAMPOS_SEGUROS = new Set(["status", "stage", "type", "reason_id", "resource", "role", "deleted_from_listing", "hold", "fulfilled"]);
// Totales de la paginación: se muestra el número.
const CAMPOS_NUMERO = new Set(["total", "limit", "offset"]);

function argumento(nombre: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${nombre}=`));
  return arg ? arg.slice(nombre.length + 3).trim() : null;
}

// Describe la forma de un objeto sin mostrar valores personales.
function forma(valor: unknown, profundidad = 0): string {
  if (valor === null) return "null";
  if (Array.isArray(valor)) return `array(${valor.length})${valor.length > 0 && profundidad < 3 ? ` de ${forma(valor[0], profundidad + 1)}` : ""}`;
  if (typeof valor !== "object") return typeof valor;
  if (profundidad >= 3) return "objeto";
  const partes = Object.entries(valor as Record<string, unknown>).map(([clave, v]) => {
    if (CAMPOS_SEGUROS.has(clave) && (typeof v === "string" || typeof v === "boolean")) return `${clave}=${String(v)}`;
    if (CAMPOS_NUMERO.has(clave) && typeof v === "number") return `${clave}=${v}`;
    return `${clave}: ${forma(v, profundidad + 1)}`;
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
  if (!empresaId || !cuentaMlId || !UUID.test(empresaId) || !UUID.test(cuentaMlId)) {
    console.log("Uso: --empresa=<uuid> --cuenta=<uuid> (ver scripts/buscar-cuenta-ml.ts).");
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
  // --estado=ANSWERED para ver la forma de una pregunta cuando la cuenta
  // no tiene ninguna sin responder.
  const estado = argumento("estado") === "ANSWERED" ? "ANSWERED" : "UNANSWERED";
  const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
  const vendedor = cuenta.vendedor;

  // Preguntas sin responder, la más vieja primero.
  await probar(
    "preguntas v4",
    "/questions/search",
    `?seller_id=${vendedor}&status=${estado}&api_version=4&sort_fields=date_created&sort_types=ASC&limit=5`,
    token
  );
  await probar("preguntas sin api_version", "/questions/search", `?seller_id=${vendedor}&status=UNANSWERED&limit=5`, token);

  // Reclamos: el issue #51 pide /marketplace/v2/claims/search con
  // "players" (post-purchase/v1 da 400 con ese filtro). Se prueban las
  // variantes para ver cuál responde.
  await probar("reclamos v2 sin filtro", "/marketplace/v2/claims/search", "?limit=5", token);
  await probar("reclamos v2 abiertos", "/marketplace/v2/claims/search", "?status=opened&limit=5", token);
  await probar("reclamos v2 players", "/marketplace/v2/claims/search", `?players.user_id=${vendedor}&players.role=respondent&limit=5`, token);
  await probar("reclamos v1 abiertos", "/post-purchase/v1/claims/search", "?status=opened&limit=5", token);
  return 0;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : "desconocido"}`);
    process.exit(1);
  });
