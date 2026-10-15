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

  // onConflictDoUpdate por email (no por clerkUserId): cubre el caso
  // raro de una fila de prueba o de una cuenta vieja con el mismo
  // correo pero sin clerkUserId enlazado todavía — nunca falla con un
  // choque de llave única silencioso.
  const [creado] = await db
    .insert(usuarios)
    .values({ clerkUserId: clerkUser.id, email, nombre })
    .onConflictDoUpdate({ target: usuarios.email, set: { clerkUserId: clerkUser.id, nombre } })
    .returning();
  return creado;
}
