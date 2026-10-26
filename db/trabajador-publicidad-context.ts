import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Issue #254 — única conexión que el cron de publicidad usa para
// enumerar cuentas de CUALQUIER empresa. Mismo patrón que
// seguimiento_trabajador_user: ve las cuentas activas (sin las columnas
// de tokens) y la bitácora técnica, y nada más. El token y las
// escrituras pasan por dbComoEmpresa()/app_user cuando ya se sabe la
// empresa. El rol se crea en db/rls-setup.sql; lo aplica quien corre
// ese script (no viaja en la migración de Drizzle).
if (!process.env.DATABASE_URL_PUBLICIDAD) {
  throw new Error(
    "Falta DATABASE_URL_PUBLICIDAD (el usuario de base del cron de publicidad, issue #254) — no es la misma variable que DATABASE_URL_APP ni DATABASE_URL_SEGUIMIENTO."
  );
}

const client = postgres(process.env.DATABASE_URL_PUBLICIDAD, { max: 5 });
export const dbTrabajadorPublicidad = drizzle(client, { schema });
