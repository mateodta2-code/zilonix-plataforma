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

// Autorregistro (Registro-0): la persona crea SU bodega y se vuelve su
// admin_bodega en una sola transacción. Fija la bodega NUEVA (id generado en
// código con randomUUID(), sin depender de INSERT ... RETURNING) y el rol
// admin_bodega. Las políticas bodega3pl_autorregistro y
// miembro3pl_admin_autorregistro limitan el permiso: una bodega por persona,
// estado activa y un único admin (ella) mientras la bodega no tenga miembros.
export async function dbComoAutorregistroBodega<T>(usuarioId: string, bodegaIdNueva: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(usuarioId)) throw new Error(`usuarioId inválido: "${usuarioId}" no es un UUID.`);
  if (!UUID_RE.test(bodegaIdNueva)) throw new Error(`bodegaIdNueva inválido: "${bodegaIdNueva}" no es un UUID.`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.empresa_actual', ${EMPRESA_SENTINEL}, true)`);
    await tx.execute(sql`SELECT set_config('app.bodega_usuario_id', ${usuarioId}, true)`);
    await tx.execute(sql`SELECT set_config('app.bodega_id', ${bodegaIdNueva}, true)`);
    await tx.execute(sql`SELECT set_config('app.bodega_rol', 'admin_bodega', true)`);
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
