import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Lógica única de "aplicar migraciones pendientes", compartida por
// db/migrate.ts (a mano) y scripts/migrar-staging.ts (automático en
// el pre-deploy de staging). Nunca imprime la URL.
export async function aplicarMigraciones(url: string): Promise<void> {
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./db/migrations" });
  } finally {
    await client.end();
  }
}
