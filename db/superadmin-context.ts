import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Tarea 1.11 (decisión D8) — ÚNICA conexión que el código del panel
// superadmin debe importar. Usa `superadmin_user`, un rol de base
// APARTE de `app_user` (db/index.ts) — nunca el mismo. Esto es lo que
// hace cierta la promesa de los Términos ("el personal de Zilonix no
// ve tus ventas ni tus clientes sin tu permiso"): aunque alguien se
// equivoque en el código y use esta conexión para una ruta normal de
// empresa, `superadmin_user` solo tiene SELECT sobre lo agregado
// (db/rls-setup.sql) — nunca puede escribir ni leer el detalle de una
// empresa sin que exista un acceso temporal, y eso lo exige
// lib/superadmin.ts, no esta conexión por sí sola.
if (!process.env.DATABASE_URL_SUPERADMIN) {
  throw new Error(
    "Falta DATABASE_URL_SUPERADMIN (el usuario de base del panel superadmin, tarea 1.11) — no es la misma variable que DATABASE_URL_APP."
  );
}

const client = postgres(process.env.DATABASE_URL_SUPERADMIN, { max: 5 });
export const dbSuperadmin = drizzle(client, { schema });
