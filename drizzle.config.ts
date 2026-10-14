import { defineConfig } from "drizzle-kit";

// Migraciones versionadas (pieza del plan técnico que el Zilonix OS
// actual no tiene): cada cambio de tablas queda en un archivo en
// db/migrations/, se aplica igual en staging y producción — nunca un
// CREATE TABLE IF NOT EXISTS suelto dentro de una ruta.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});
