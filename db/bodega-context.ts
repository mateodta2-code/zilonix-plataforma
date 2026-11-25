import { sql } from "drizzle-orm";
import { db } from "./index";
import { EMPRESA_SENTINEL } from "./empresa-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Puerta única para toda consulta de una bodega 3PL (patrón de
// db/empresa-context.ts). Variables propias, que ningún contexto de
// vendedor fija: app.bodega_id (bodega activa), app.bodega_usuario_id
// ("¿en cuáles bodegas estoy?") y app.bodega_invitacion_token. Todas
// con set_config(..., true) (SET LOCAL): mueren con la transacción, así
// que una conexión reutilizada del pool nunca arrastra la bodega anterior.
//
// app.empresa_actual se fija al UUID centinela (el que ninguna empresa
// real puede tener): una bodega no lee NADA de empresas de vendedores, y
// las políticas de empresa no revientan por falta de variable.
//
// app.bodega_rol (opcional) es el rol del miembro en la sesión: las políticas
// de UPDATE de bodegas_3pl y miembros_bodega_3pl exigen 'admin_bodega'. Sin
// rol vale cadena vacía y NO da permiso de edición (solo lectura).
//
// usuarioId (opcional, Issue #627): la persona de la sesión. Lo fija como
// app.bodega_usuario_id para que un domiciliario solo vea SUS entregas
// (entregas_domiciliario). Sin él, nada cambia para quien ya llamaba esto.
export async function dbComoBodega<T>(bodegaId: string, fn: (tx: typeof db) => Promise<T>, rol?: string, usuarioId?: string): Promise<T> {
  if (!UUID_RE.test(bodegaId)) throw new Error(`bodegaId inválido: "${bodegaId}" no es un UUID.`);
  if (usuarioId !== undefined && !UUID_RE.test(usuarioId)) throw new Error(`usuarioId inválido: "${usuarioId}" no es un UUID.`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.empresa_actual', ${EMPRESA_SENTINEL}, true)`);
    await tx.execute(sql`SELECT set_config('app.bodega_id', ${bodegaId}, true)`);
    await tx.execute(sql`SELECT set_config('app.bodega_rol', ${rol ?? ""}, true)`);
    if (usuarioId) await tx.execute(sql`SELECT set_config('app.bodega_usuario_id', ${usuarioId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

// "¿En cuáles bodegas estoy?" — todavía no hay una activa.
export async function dbComoUsuarioBodega<T>(usuarioId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(usuarioId)) throw new Error(`usuarioId inválido: "${usuarioId}" no es un UUID.`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.empresa_actual', ${EMPRESA_SENTINEL}, true)`);
    await tx.execute(sql`SELECT set_config('app.bodega_usuario_id', ${usuarioId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

// Quien tiene el token ve y acepta esa invitación puntual (mismo
// principio que dbComoInvitacion): el secreto en la URL es el permiso.
// usuarioId es opcional — la vista previa no lo necesita, aceptar sí.
export async function dbComoInvitacionBodega<T>(token: string, usuarioId: string | null, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  if (usuarioId && !UUID_RE.test(usuarioId)) throw new Error(`usuarioId inválido: "${usuarioId}" no es un UUID.`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.empresa_actual', ${EMPRESA_SENTINEL}, true)`);
    await tx.execute(sql`SELECT set_config('app.bodega_invitacion_token', ${token}, true)`);
    if (usuarioId) await tx.execute(sql`SELECT set_config('app.bodega_usuario_id', ${usuarioId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}
