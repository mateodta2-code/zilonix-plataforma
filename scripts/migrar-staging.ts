import { readFileSync } from "fs";
import { join } from "path";
import postgres from "postgres";
import { aplicarMigraciones } from "../db/migrar-logica";
import { motivoDeNegacion, rolesFaltantes, ROLES_RLS } from "./migrar-staging-logica";

// Pre-deploy de STAGING en Railway: aplica migraciones pendientes y
// luego db/rls-setup.sql (idempotente). Doble barrera para que jamás
// se active en producción. Nunca imprime URLs ni contraseñas.
async function main() {
  const motivo = motivoDeNegacion(process.env);
  if (motivo) {
    console.error(`Migración automática cancelada: ${motivo}`);
    process.exit(1);
  }
  const url = process.env.DATABASE_URL as string;

  console.log("Aplicando migraciones pendientes…");
  await aplicarMigraciones(url);

  const sql = postgres(url, { max: 1 });
  try {
    const filas = await sql<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname IN ${sql([...ROLES_RLS])}`;
    const faltan = rolesFaltantes(filas.map((f) => f.rolname));
    if (faltan.length > 0) {
      throw new Error(
        `Faltan roles de base (${faltan.join(", ")}). Créalos una vez a mano con db/rls-setup.sql y contraseñas reales; el deploy no los crea con contraseña de ejemplo.`
      );
    }
    console.log("Aplicando db/rls-setup.sql…");
    await sql.unsafe(readFileSync(join(process.cwd(), "db/rls-setup.sql"), "utf8"));
  } finally {
    await sql.end();
  }
  console.log("Staging al día: migraciones y RLS aplicadas.");
}

main().catch((e) => {
  // Solo el mensaje: el error completo del driver puede traer datos de conexión.
  console.error(`Falló la migración automática de staging: ${e instanceof Error ? e.message : "error desconocido"}`);
  process.exit(1);
});
