import { pgTable, serial, timestamp } from "drizzle-orm/pg-core";

// Tabla mínima solo para probar que el canal completo funciona (Drizzle
// -> migración -> Postgres -> lectura). El modelo de datos real
// (empresas, usuarios, membresías, roles) es la tarea 1.2 — ahí se
// diseña y se aprueba ANTES de construir, no acá.
export const chequeos = pgTable("chequeos", {
  id: serial("id").primaryKey(),
  creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
});
