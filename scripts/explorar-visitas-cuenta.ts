// Solo lectura. Antes de mostrar en Optimización las VISITAS de toda la
// tienda (resumen global por cuenta), se confirma con una cuenta real
// cómo responde Mercado Libre (CLAUDE.md: nunca se adivina la API).
// Lo que se sabe hoy (lib/ml/cliente.ts, PR #457/#458): visitas solo por
// ítem (/items/{id}/visits/time_window); en lote (/items/visits y
// /visits/items) responde 400. Acá se prueban las rutas por VENDEDOR
// que documenta Mercado Libre:
// - GET /users/{id}/items_visits?date_from=&date_to=
// - GET /users/{id}/items_visits/time_window?last=N&unit=day
//
// - Solo GET, todo por lib/ml/cliente.ts (pedirLecturaMl).
// - No imprime el token ni textos libres: códigos HTTP, nombres de
//   campos y solo números (totales, visitas por día).
//
//   npx tsx scripts/explorar-visitas-cuenta.ts --empresa=<uuid> --cuenta=<uuid>

import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { pedirLecturaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VENDEDOR = /^\d{1,20}$/;

function argumento(nombre: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${nombre}=`));
  return arg ? arg.slice(nombre.length + 3).trim() : null;
}

// Forma de la respuesta: nombres de campos y números; los textos solo
// si son fechas o unidades (nunca datos libres).
function forma(valor: unknown, profundidad = 0): string {
  if (valor === null) return "null";
  if (typeof valor === "number") return String(valor);
  if (typeof valor === "string") return /^\d{4}-\d{2}-\d{2}/.test(valor) || /^(day|week|month)$/.test(valor) ? valor : "string";
  if (Array.isArray(valor)) {
    if (profundidad >= 2) return `array(${valor.length})`;
    return `array(${valor.length})${valor.length ? ` [${valor.slice(0, 3).map((v) => forma(v, profundidad + 1)).join(", ")}${valor.length > 3 ? ", …" : ""}]` : ""}`;
  }
  if (typeof valor !== "object") return typeof valor;
  if (profundidad >= 3) return "objeto";
  return `{ ${Object.entries(valor as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${forma(v, profundidad + 1)}`)
    .join(", ")} }`;
}

function isoDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

async function probar(etiqueta: string, ruta: string, query: string, token: string): Promise<void> {
  try {
    const resp = await pedirLecturaMl<unknown>(ruta, token, { query });
    console.log(resp.ok ? `${etiqueta}: OK ${forma(resp.data)}` : `${etiqueta}: HTTP ${resp.status}${resp.error.code ? ` (${resp.error.code})` : ""}`);
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
  const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
  const hoy = new Date();
  const hace7 = new Date(hoy.getTime() - 7 * 86_400_000);
  const v = cuenta.vendedor;

  await probar("items_visits (rango 7 días)", `/users/${v}/items_visits`, `?date_from=${isoDia(hace7)}&date_to=${isoDia(hoy)}`, token);
  await probar("items_visits/time_window last=7", `/users/${v}/items_visits/time_window`, "?last=7&unit=day", token);
  await probar("items_visits/time_window last=90", `/users/${v}/items_visits/time_window`, "?last=90&unit=day", token);
  return 0;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : "desconocido"}`);
    process.exit(1);
  });
