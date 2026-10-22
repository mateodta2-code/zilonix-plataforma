import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { expect } from "vitest";
import { dbComoEmpresa } from "../empresa-context";
import { db } from "../index";
import { empresas, usuarios } from "../schema";

// Issue #39 (Z-MT-09) — plantilla reutilizable para la prueba que,
// hasta ahora, cada archivo db/rls-*.test.ts repetía a mano: crear dos
// empresas y confirmar que una nunca ve, edita ni borra una fila de la
// otra. Nunca con el superusuario: crearDosEmpresas() usa
// dbComoEmpresa() (db/empresa-context.ts), que ya corre siempre con
// app_user (DATABASE_URL_APP, ver db/index.ts) — igual que cualquier
// consulta real de la app.
export type ContextoDosEmpresas = {
  empresaAId: string;
  empresaBId: string;
  usuarioAId: string;
  usuarioBId: string;
};

export async function crearDosEmpresas(): Promise<ContextoDosEmpresas> {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();

  await dbComoEmpresa(empresaAId, (tx) =>
    tx.insert(empresas).values({
      id: empresaAId,
      nombre: "Empresa A (prueba de aislamiento)",
      nit: `TEST-AISLA-A-${empresaAId.slice(0, 8)}`,
    })
  );
  await dbComoEmpresa(empresaBId, (tx) =>
    tx.insert(empresas).values({
      id: empresaBId,
      nombre: "Empresa B (prueba de aislamiento)",
      nit: `TEST-AISLA-B-${empresaBId.slice(0, 8)}`,
    })
  );

  // usuarios no lleva RLS (tarea 1.3 — una persona puede estar en
  // varias empresas, no tiene una sola empresa dueña), así que se
  // inserta con la conexión normal de app_user, igual que lib/usuarios.ts.
  const [usuarioA] = await db
    .insert(usuarios)
    .values({ email: `prueba-aislamiento-a-${empresaAId}@zilonix.test`, nombre: "Usuario A (prueba de aislamiento)" })
    .returning({ id: usuarios.id });
  const [usuarioB] = await db
    .insert(usuarios)
    .values({ email: `prueba-aislamiento-b-${empresaBId}@zilonix.test`, nombre: "Usuario B (prueba de aislamiento)" })
    .returning({ id: usuarios.id });

  return { empresaAId, empresaBId, usuarioAId: usuarioA.id, usuarioBId: usuarioB.id };
}

// Toda tabla de negocio con empresa_id (regla de CLAUDE.md: "toda tabla
// con datos de una empresa tiene una columna empresa_id") trae como
// mínimo estas dos columnas — es lo único que esta plantilla necesita
// saber del resto de cada esquema para poder probar el aislamiento sin
// conocerlo.
type TablaConAislamiento = PgTable & {
  id: PgColumn;
  empresaId: PgColumn;
};

// inserta una fila como empresa A (contexto.empresaAId) y comprueba
// que empresa B nunca la ve (SELECT), nunca la edita (UPDATE afecta 0
// filas) ni la borra (DELETE afecta 0 filas) — y que A sí sigue
// viéndola. insertarFilaComoA recibe la transacción ya abierta con
// app.empresa_actual = empresaAId (vía dbComoEmpresa) y el propio
// empresaAId, para poder armar los valores del insert.
export async function afirmarAislamiento<Tabla extends TablaConAislamiento>(
  contexto: ContextoDosEmpresas,
  tabla: Tabla,
  insertarFilaComoA: (tx: typeof db, empresaId: string) => Promise<{ id: string }[]>
): Promise<{ id: string }> {
  const { empresaAId, empresaBId } = contexto;

  const [fila] = await dbComoEmpresa(empresaAId, (tx) => insertarFilaComoA(tx, empresaAId));

  const veB = await dbComoEmpresa(empresaBId, (tx) => tx.select({ id: tabla.id }).from(tabla).where(eq(tabla.id, fila.id)));
  expect(veB, "empresa B no debería poder ver la fila de empresa A (SELECT)").toHaveLength(0);

  // No hay ninguna columna de negocio común a toda tabla aparte de
  // empresa_id, así que el ataque genérico que de verdad tiene sentido
  // probar acá — el mismo para cualquier tabla — es que B intente
  // "robarse" la fila reasignándole su propio empresa_id. RLS tiene
  // que bloquear el UPDATE igual que a cualquier otro.
  const actualizadas = await dbComoEmpresa(empresaBId, (tx) =>
    tx
      .update(tabla)
      .set({ empresaId: empresaBId } as never)
      .where(eq(tabla.id, fila.id))
      .returning({ id: tabla.id })
  );
  expect(actualizadas, "empresa B no debería poder editar la fila de empresa A (UPDATE)").toHaveLength(0);

  const borradas = await dbComoEmpresa(empresaBId, (tx) =>
    tx.delete(tabla).where(eq(tabla.id, fila.id)).returning({ id: tabla.id })
  );
  expect(borradas, "empresa B no debería poder borrar la fila de empresa A (DELETE)").toHaveLength(0);

  const veA = await dbComoEmpresa(empresaAId, (tx) => tx.select({ id: tabla.id }).from(tabla).where(eq(tabla.id, fila.id)));
  expect(veA, "empresa A sí debería seguir viendo su propia fila").toHaveLength(1);

  return fila;
}
