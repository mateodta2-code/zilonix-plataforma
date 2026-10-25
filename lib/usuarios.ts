import { eq } from "drizzle-orm";
import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { usuarios } from "@/db/schema";

// Tarea 1.6 — primer punto de contacto entre Clerk y nuestras propias
// tablas. `usuarios` no lleva RLS (decisión de la tarea 1.3: una
// persona puede estar en varias empresas, no tiene una sola "empresa
// dueña"), así que esto se consulta directo con `db`, sin
// dbComoEmpresa()/dbComoUsuario().
//
// Se llama en cada página que necesita saber "quién es este usuario
// para NUESTRAS tablas" — si todavía no existe la fila, se crea acá
// mismo (no hay webhook de Clerk para esto, a propósito: así no hace
// falta verificar firmas de webhook en esta tarea, y el primer request
// real del usuario después de registrarse ya la crea sola).
export async function obtenerOCrearUsuarioActual() {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const email = clerkUser.primaryEmailAddress?.emailAddress;
  if (!email) {
    throw new Error(`El usuario de Clerk ${clerkUser.id} no tiene un correo principal verificado.`);
  }
  const nombre = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || email;

  const existente = await db.select().from(usuarios).where(eq(usuarios.clerkUserId, clerkUser.id));
  if (existente.length > 0) return existente[0];

  // Issue #219 — bug real en producción: dos requests casi simultáneos
  // del MISMO usuario de Clerk recién creado (ej. dos tabs, o un
  // doble-click justo después del sign-up) pasaban LOS DOS el SELECT
  // de arriba como "no existe" antes de que el primer INSERT
  // confirmara, y los dos intentaban insertar con el mismo
  // `clerk_user_id`. El `onConflictDoUpdate` de antes apuntaba a
  // `email` — nunca atrapaba ESTA carrera (mismo email Y mismo
  // clerk_user_id en los dos inserts, pero Postgres puede chocar
  // primero contra el índice único de `clerk_user_id`, que el target
  // de `email` no cubre) — Postgres tiraba el `23505` crudo sin
  // capturar. Apuntar acá a `clerk_user_id` es la carrera REAL que hay
  // que cubrir: si el otro request ya ganó, esto actualiza esa misma
  // fila con el email/nombre más reciente de Clerk, nunca inventa una
  // segunda fila.
  try {
    const [creado] = await db
      .insert(usuarios)
      .values({ clerkUserId: clerkUser.id, email, nombre })
      .onConflictDoUpdate({ target: usuarios.clerkUserId, set: { email, nombre } })
      .returning();
    return creado;
  } catch (error) {
    // Caso real DISTINTO, ya cubierto desde antes de este issue — se
    // mantiene la misma política, solo que ahora llega por este otro
    // camino: una fila con el MISMO email pero `clerk_user_id` todavía
    // null o de otra cuenta (ej. una fila de prueba, o una invitación
    // sembrada antes de que esa persona iniciara sesión por primera
    // vez). El `ON CONFLICT` de arriba, apuntado a `clerk_user_id`,
    // nunca atrapa esto — Postgres revienta con `23505` sobre
    // `usuarios_email_unique` en cambio. Esa fila existente adopta el
    // `clerk_user_id` nuevo, nunca se duplica por email — ninguna
    // política nueva, la misma de siempre.
    if (!esViolacionDeEmailUnico(error)) throw error;

    const [actualizado] = await db.update(usuarios).set({ clerkUserId: clerkUser.id, nombre }).where(eq(usuarios.email, email)).returning();
    return actualizado;
  }
}

// 23505 = unique_violation de Postgres (mismo chequeo que ya usan
// lib/invitaciones.ts, lib/ml/cuentas.ts, lib/ml/sku.ts y
// app/crear-empresa/actions.ts) — acá además hace falta mirar
// `constraint_name`, porque `usuarios` tiene DOS unique distintos
// (`email` y `clerk_user_id`) y solo uno de los dos tiene un camino de
// recuperación propio.
function esViolacionDeEmailUnico(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505" &&
      "constraint_name" in error &&
      error.constraint_name === "usuarios_email_unique"
  );
}
