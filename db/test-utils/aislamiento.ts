import { randomUUID } from "crypto";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { expect } from "vitest";
import { dbComoEmpresa } from "../empresa-context";
import { empresas } from "../schema";

// Z-MT-09 — las pruebas de aislamiento se estaban reescribiendo a mano
// en cada tabla (db/rls.test.ts, db/rls-cuentas-ml.test.ts, …). En
// cuentas_ml, por ejemplo, quedó cubierto "no ve" y "no edita", pero
// no "no borra": es justo el hueco que aparece cuando cada test arma
// las tres comprobaciones por su cuenta. RLS no se puede simular con
// un mock — esto corre contra Postgres real, con app_user, y solo
// entra por dbComoEmpresa (SET LOCAL de app.empresa_actual), el mismo
// camino que el tráfico de la app.

export type EmpresasDePrueba = {
  empresaAId: string;
  empresaBId: string;
};

// Cualquier tabla de negocio con `id` uuid. El cast del `.set()` vive
// adentro de este archivo: la columna que se intenta pisar se elige en
// runtime (la pasa el test, o se toma una text que no sea la clave).
export type TablaConId = PgTable & { id: AnyPgColumn };

export type FilaInsertada = {
  id: string;
  // Columna que la empresa B va a intentar cambiar. Si no se pasa, se
  // usa la primera columna text/varchar que no sea única.
  columna?: AnyPgColumn;
  // Valor distinto del que quedó guardado. Si no se pasa y la columna
  // es texto, se arma un centinela que no puede coincidir con el real.
  valorAjeno?: unknown;
};

const TIPOS_TEXTO = new Set(["PgText", "PgVarchar"]);

// Misma forma que los tests de RLS que ya existen: el id se genera
// antes del insert porque la política de `empresas` exige
// `id = app.empresa_actual` también al insertar (no hay "insertar sin
// contexto"). Ver el comentario de db/empresa-context.ts.
export async function crearDosEmpresas(etiqueta = "plantilla de aislamiento"): Promise<EmpresasDePrueba> {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();

  await dbComoEmpresa(empresaAId, (tx) =>
    tx.insert(empresas).values({
      id: empresaAId,
      nombre: `Empresa A (${etiqueta})`,
      nit: `TEST-A-${empresaAId}`,
    })
  );
  await dbComoEmpresa(empresaBId, (tx) =>
    tx.insert(empresas).values({
      id: empresaBId,
      nombre: `Empresa B (${etiqueta})`,
      nit: `TEST-B-${empresaBId}`,
    })
  );

  return { empresaAId, empresaBId };
}

function dondeId(tabla: TablaConId, filaId: string): SQL {
  // El id viaja como parámetro ($1::uuid), nunca interpolado en el
  // texto: misma razón que set_config en dbComoEmpresa (el valor es
  // dato, no SQL).
  return sql`${tabla.id} = ${filaId}::uuid`;
}

async function leerFila(empresaId: string, tabla: TablaConId, filaId: string): Promise<Record<string, unknown>[]> {
  const filas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(tabla).where(dondeId(tabla, filaId)));
  return filas as Record<string, unknown>[];
}

async function intentarActualizar(
  empresaId: string,
  tabla: TablaConId,
  filaId: string,
  clave: string,
  valorAjeno: unknown
): Promise<unknown[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(tabla)
      .set({ [clave]: valorAjeno } as never)
      .where(dondeId(tabla, filaId))
      .returning({ id: tabla.id })
  );
}

async function intentarBorrar(empresaId: string, tabla: TablaConId, filaId: string): Promise<unknown[]> {
  return dbComoEmpresa(empresaId, (tx) => tx.delete(tabla).where(dondeId(tabla, filaId)).returning({ id: tabla.id }));
}

function claveDe(tabla: TablaConId, columna: AnyPgColumn): string {
  for (const [clave, candidata] of Object.entries(getTableColumns(tabla))) {
    if (candidata === columna || candidata.name === columna.name) return clave;
  }
  throw new Error(`afirmarAislamiento: la columna "${columna.name}" no está en ${getTableName(tabla)}.`);
}

function elegirColumnaTexto(tabla: TablaConId): { clave: string; columna: AnyPgColumn } {
  const candidatas = Object.entries(getTableColumns(tabla)).filter(([, columna]) => {
    return TIPOS_TEXTO.has(columna.columnType) && !columna.primary && !columna.isUnique;
  });
  const preferida = candidatas.find(([clave]) => clave !== "id" && clave !== "empresaId");
  if (!preferida) {
    throw new Error(
      `afirmarAislamiento: ${getTableName(tabla)} no tiene una columna text para simular la edición. Devolvé \`columna\` y \`valorAjeno\` desde insertarFila.`
    );
  }
  return { clave: preferida[0], columna: preferida[1] };
}

function valorAjenoPorDefecto(columna: AnyPgColumn): string {
  if (columna.dataType === "string" || TIPOS_TEXTO.has(columna.columnType)) {
    return `ajeno-${randomUUID()}`;
  }
  throw new Error(
    `afirmarAislamiento: pasá valorAjeno para la columna ${columna.name} (${columna.columnType}); no hay un centinela seguro para ese tipo.`
  );
}

function normalizarInsercion(valor: string | FilaInsertada): FilaInsertada {
  if (typeof valor === "string") {
    if (valor.length === 0) throw new Error("insertarFila devolvió un id vacío.");
    return { id: valor };
  }
  if (!valor || typeof valor.id !== "string" || valor.id.length === 0) {
    throw new Error("insertarFila tiene que devolver el id de la fila de la empresa A.");
  }
  return valor;
}

/**
 * Crea dos empresas y comprueba que B no ve, no edita ni borra la fila
 * que `insertarFila` insertó como A.
 *
 * `insertarFila` recibe las dos empresas (creadas con crearDosEmpresas)
 * y devuelve el id de la fila, o `{ id, columna, valorAjeno }` si la
 * edición tiene que pisar una columna concreta. La fila tiene que
 * quedar visible para A: si no, "B no ve nada" no demostraría nada.
 *
 * Ejemplo:
 *   const { empresaAId, filaId } = await afirmarAislamiento(pedidos, async ({ empresaAId }) => {
 *     const [fila] = await dbComoEmpresa(empresaAId, (tx) =>
 *       tx.insert(pedidos).values({ empresaId: empresaAId }).returning({ id: pedidos.id })
 *     );
 *     return fila.id;
 *   });
 */
export async function afirmarAislamiento(
  tabla: TablaConId,
  insertarFila: (ctx: EmpresasDePrueba) => Promise<string | FilaInsertada>
): Promise<EmpresasDePrueba & { filaId: string }> {
  const nombreTabla = getTableName(tabla);
  const ctx = await crearDosEmpresas(nombreTabla);
  const insercion = normalizarInsercion(await insertarFila(ctx));
  const columna = insercion.columna ?? elegirColumnaTexto(tabla).columna;
  const clave = claveDe(tabla, columna);
  const valorAjeno = insercion.valorAjeno === undefined ? valorAjenoPorDefecto(columna) : insercion.valorAjeno;

  const propias = await leerFila(ctx.empresaAId, tabla, insercion.id);
  expect(propias, `${nombreTabla}: la empresa A no ve la fila que acaba de insertar`).toHaveLength(1);
  if (!(clave in propias[0])) {
    throw new Error(`afirmarAislamiento: la fila de ${nombreTabla} no tiene la clave "${clave}".`);
  }
  const valorOriginal = propias[0][clave];
  expect(
    valorOriginal,
    `${nombreTabla}: el valor ajeno coincide con el real de "${clave}"; un update que sí pasó no se distinguiría`
  ).not.toEqual(valorAjeno);

  const ajenas = await leerFila(ctx.empresaBId, tabla, insercion.id);
  expect(ajenas, `${nombreTabla}: la empresa B vio la fila de la empresa A`).toHaveLength(0);

  const actualizadas = await intentarActualizar(ctx.empresaBId, tabla, insercion.id, clave, valorAjeno);
  expect(actualizadas, `${nombreTabla}: la empresa B modificó la fila de la empresa A`).toHaveLength(0);
  const trasEditar = await leerFila(ctx.empresaAId, tabla, insercion.id);
  expect(trasEditar, `${nombreTabla}: la fila de A desapareció al intentar editarla`).toHaveLength(1);
  expect(trasEditar[0][clave], `${nombreTabla}: la empresa B cambió "${clave}" de la fila de A`).toEqual(valorOriginal);

  const borradas = await intentarBorrar(ctx.empresaBId, tabla, insercion.id);
  expect(borradas, `${nombreTabla}: la empresa B borró la fila de la empresa A`).toHaveLength(0);
  const trasBorrar = await leerFila(ctx.empresaAId, tabla, insercion.id);
  expect(trasBorrar, `${nombreTabla}: la fila de A no sigue después de que B intentó borrarla`).toHaveLength(1);

  return { ...ctx, filaId: insercion.id };
}
