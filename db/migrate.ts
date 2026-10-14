import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Corre las migraciones pendientes contra DATABASE_URL — se llama a mano
// (npm run db:migrate) después de cada `db:generate`, nunca automático en
// cada arranque (un deploy no debe poder alterar el esquema sin que
// alguien lo haya revisado primero).
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.");
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./db/migrations" });
  await client.end();
  console.log("Migraciones aplicadas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
