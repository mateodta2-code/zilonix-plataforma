import { sql } from "drizzle-orm";
import { db } from "./index";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Puerta única para toda consulta de negocio (tarea 1.3). Fija qué
// empresa está "activa" para Postgres DENTRO de una transacción con
// set_config(..., true) — el "true" final es el equivalente a SET
// LOCAL: se deshace solo al terminar la transacción.
//
// Por qué no un SET normal: postgres-js reutiliza conexiones físicas
// con un pool. Un SET normal se queda pegado a esa conexión — si la
// siguiente petición (de OTRA empresa) reutiliza la misma conexión del
// pool antes de que alguien la resetee, vería datos de la empresa
// anterior. SET LOCAL (vía set_config con is_local=true) es inmune a
// esto: se borra solo, pase lo que pase, al cerrar la transacción.
//
// Por qué set_config() y no un SET LOCAL armado a mano con texto: SET
// no acepta parámetros ($1) en el protocolo de Postgres — armar el
// texto a mano con el valor pegado adentro abriría la puerta a
// inyección SQL si algún día empresaId viniera de un lugar menos
// confiable. set_config() es una función común y sí acepta parámetros
// normales, tratando el valor siempre como dato, nunca como código.
export async function dbComoEmpresa<T>(empresaId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(empresaId)) {
    throw new Error(`empresaId inválido: "${empresaId}" no es un UUID.`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.empresa_actual', ${empresaId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

// Nota para cuando se construya el registro de una empresa nueva (tarea
// 1.6): la política de empresas exige que `id = empresa_actual` incluso
// al insertar (no se puede "insertar sin contexto"). La forma correcta
// es generar el id en el código ANTES de insertar y fijar el contexto a
// ese mismo id recién generado:
//
//   const nuevaId = crypto.randomUUID();
//   await dbComoEmpresa(nuevaId, (tx) => tx.insert(empresas).values({ id: nuevaId, ... }));
