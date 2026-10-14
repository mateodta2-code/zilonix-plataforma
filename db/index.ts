import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL (la pone Railway solo al conectar el servicio de Postgres).");
}

const client = postgres(process.env.DATABASE_URL, { max: 10 });
export const db = drizzle(client, { schema });
