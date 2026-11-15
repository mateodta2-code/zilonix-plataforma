import { aplicarMigraciones } from "./migrar-logica";

// Corre las migraciones pendientes contra DATABASE_URL — se llama a mano
// (npm run db:migrate) después de cada `db:generate`. En producción
// sigue siendo SIEMPRE manual y con aprobación; solo staging migra solo,
// vía scripts/migrar-staging.ts (ver docs/migraciones-staging.md).
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.");
  await aplicarMigraciones(process.env.DATABASE_URL);
  console.log("Migraciones aplicadas.");
}

main().catch((e) => {
  // Tarea 1.10 — "logs que tachan tokens y datos personales": nunca
  // se imprime el error completo. Algunos drivers de Postgres pueden
  // meter la query o datos de conexión dentro del objeto de error
  // completo; `.message` es lo único que de verdad hace falta para
  // diagnosticar una migración fallida.
  console.error(e instanceof Error ? e.message : "Error desconocido al migrar.");
  process.exit(1);
});
