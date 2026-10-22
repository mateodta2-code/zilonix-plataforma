import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Tarea 1.3 — ÚNICA conexión que el resto de la app debe importar. Usa
// el usuario de base restringido (app_user), que SÍ respeta la
// seguridad por fila (RLS). A propósito este archivo nunca expone la
// conexión con privilegios de superusuario que da Railway en
// DATABASE_URL (esa es la que podría saltarse el aislamiento entre
// empresas) — esa otra conexión solo se abre en dos lugares, y el
// tráfico de la app no importa ninguno de los dos: db/migrate.ts
// (migraciones) y scripts/recifrar-tokens-ml.ts (rotación manual de
// la clave de los tokens; ver docs/rotacion-claves.md).
//
// Toda consulta que toque empresas/roles/membresias/permisos_rol/
// invitaciones/auditoria tiene que pasar por dbComoEmpresa()
// (db/empresa-context.ts) — usar `db` directo para esas tablas no
// rompe nada visiblemente (RLS sigue activo), pero sin fijar la
// empresa actual la política no deja ver ni escribir ninguna fila.
if (!process.env.DATABASE_URL_APP) {
  throw new Error(
    "Falta DATABASE_URL_APP (el usuario de base restringido app_user, tarea 1.3) — no es la misma variable que DATABASE_URL."
  );
}

const client = postgres(process.env.DATABASE_URL_APP, { max: 10 });
export const db = drizzle(client, { schema });
