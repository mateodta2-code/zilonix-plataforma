import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Tarea 2.4 — ÚNICA conexión que el trabajador de cola debe importar.
// Usa `trabajador_user`, un rol de base APARTE (mismo patrón que
// superadmin_user de la tarea 1.11): el trabajador necesita ver avisos
// de CUALQUIER empresa (no sabe de antemano cuál, hasta leer la fila) y
// marcarlos procesados, pero nunca tiene que tocar ninguna otra tabla
// de negocio — `db/rls-setup.sql` le da SELECT/UPDATE solo en
// `avisos_ml`, nada más.
if (!process.env.DATABASE_URL_TRABAJADOR) {
  throw new Error(
    "Falta DATABASE_URL_TRABAJADOR (el usuario de base del trabajador de cola, tarea 2.4) — no es la misma variable que DATABASE_URL_APP."
  );
}

const client = postgres(process.env.DATABASE_URL_TRABAJADOR, { max: 5 });
export const dbTrabajador = drizzle(client, { schema });
