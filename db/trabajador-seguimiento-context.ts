import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Issue #175 — ÚNICA conexión que la revisión diaria de seguimientos
// debe importar para enumerar seguimientos de CUALQUIER empresa.
// Usa `seguimiento_trabajador_user`, un rol de base APARTE (mismo
// patrón que trabajador_user, tarea 2.4): necesita ver seguimientos_ml
// de cualquier empresa (no sabe de antemano cuál hasta leer la fila) y
// marcar ultima_revision_ts, pero nunca toca cuentas_ml,
// seguimiento_fotos ni seguimiento_alertas directamente — esas
// escrituras de negocio pasan por dbComoEmpresa()/app_user una vez que
// ya se sabe a qué empresa pertenece (ver lib/trabajos/revisionDiariaSeguimiento.ts,
// mismo criterio que procesarUnAviso() en lib/ml/trabajador.ts). `db/rls-setup.sql`
// le da SELECT/UPDATE solo en `seguimientos_ml`, nada más.
if (!process.env.DATABASE_URL_SEGUIMIENTO) {
  throw new Error(
    "Falta DATABASE_URL_SEGUIMIENTO (el usuario de base de la revisión diaria de seguimientos, issue #175) — no es la misma variable que DATABASE_URL_APP ni DATABASE_URL_TRABAJADOR."
  );
}

const client = postgres(process.env.DATABASE_URL_SEGUIMIENTO, { max: 5 });
export const dbTrabajadorSeguimiento = drizzle(client, { schema });
