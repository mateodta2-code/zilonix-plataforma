import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Issue #422 — única conexión que el cron de pedidos Falabella usa para
// enumerar las cuentas de CUALQUIER empresa. El rol
// falabella_trabajador_user (db/rls-setup.sql, 1f) solo puede leer id,
// empresa_id y desconectada_ts de cuentas_falabella: nada de user_id,
// api_key_cifrada ni escrituras. Las credenciales, los pedidos y la
// auditoría van por dbComoEmpresa()/app_user cuando ya se sabe la empresa.
if (!process.env.DATABASE_URL_FALABELLA) {
  throw new Error(
    "Falta DATABASE_URL_FALABELLA (el usuario de base del cron de pedidos Falabella, issue #422) — no es la misma variable que DATABASE_URL_APP ni DATABASE_URL_PUBLICIDAD."
  );
}

const client = postgres(process.env.DATABASE_URL_FALABELLA, { max: 2 });
export const dbTrabajadorFalabella = drizzle(client, { schema });
