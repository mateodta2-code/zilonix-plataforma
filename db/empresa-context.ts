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

// Tarea 1.6 — el selector de cambio de empresa necesita, antes de que
// el usuario elija ninguna, la lista de TODAS las empresas donde tiene
// membresía. dbComoEmpresa() no sirve para esto: su política solo deja
// ver UNA empresa a la vez (la que esté activa), y la lista es
// justamente "en cuáles estoy" — todavía no hay ninguna activa.
//
// La solución (ver db/rls-setup.sql, políticas aislamiento_empresas y
// aislamiento_membresias) es una regla aparte, independiente de
// app.empresa_actual: un usuario siempre puede ver SUS PROPIAS filas de
// membresía (en cualquier empresa) y las empresas a las que esas
// membresías apuntan — nunca las membresías de otra persona. No es una
// fuga entre empresas: lo único que se expone es "a qué empresas
// pertenezco yo", que es exactamente el dato que el selector necesita
// mostrar.
//
// EMPRESA_SENTINEL: la mitad "empresa_actual" de esas políticas sigue
// con el cast directo `current_setting(...)::uuid` que ya prueba 1.4
// (revienta fuerte si nadie fijó ninguna empresa — eso NO cambia). Para
// que esa mitad no reviente cuando lo único que se fijó es el usuario
// (no una empresa activa todavía), se fija un UUID que ninguna empresa
// real puede tener — empresas.id usa defaultRandom() (gen_random_uuid),
// que nunca genera el UUID de puros ceros — así esa mitad de la política
// evalúa a "ninguna fila" en vez de tronar, y la mitad "usuario_actual"
// es la que de verdad filtra.
const EMPRESA_SENTINEL = "00000000-0000-0000-0000-000000000000";

export async function dbComoUsuario<T>(usuarioId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(usuarioId)) {
    throw new Error(`usuarioId inválido: "${usuarioId}" no es un UUID.`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.empresa_actual', ${EMPRESA_SENTINEL}, true)`);
    await tx.execute(sql`SELECT set_config('app.usuario_actual', ${usuarioId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

// Tarea 1.7 — quien recibe una invitación por correo todavía NO es
// miembro de esa empresa (es justo lo que está por decidir). No hay
// forma de leer su fila de `invitaciones` con dbComoEmpresa() (no tiene
// empresa activa) ni con dbComoUsuario() (la invitación puede ser para
// alguien que ni siquiera tiene cuenta todavía, antes de aceptar).
//
// La política nueva de `invitaciones` (ver db/rls-setup.sql) agrega una
// tercera vía, totalmente aparte de empresa_actual/usuario_actual:
// quien tiene el TOKEN (un secreto largo e imposible de adivinar,
// generado al invitar) puede ver y aceptar esa fila puntual — ni una
// más. Es el mismo principio que un link mágico de recuperación de
// acceso: el secreto en la URL ES el permiso, no hace falta ser ya
// miembro de nada para demostrarlo.
//
// usuarioId es opcional: la vista previa de la invitación (antes de
// iniciar sesión) solo necesita leer la fila por token; aceptarla sí
// necesita además `usuario_actual` fijado, porque crea una membresía
// para ESE usuario (política de membresias de la tarea 1.6).
export async function dbComoInvitacion<T>(
  token: string,
  usuarioId: string | null,
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  if (usuarioId && !UUID_RE.test(usuarioId)) {
    throw new Error(`usuarioId inválido: "${usuarioId}" no es un UUID.`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.empresa_actual', ${EMPRESA_SENTINEL}, true)`);
    await tx.execute(sql`SELECT set_config('app.invitacion_token_actual', ${token}, true)`);
    if (usuarioId) {
      await tx.execute(sql`SELECT set_config('app.usuario_actual', ${usuarioId}, true)`);
    }
    return fn(tx as unknown as typeof db);
  });
}

// Tarea 2.4 — un aviso de Mercado Libre llega SOLO con `user_id` (el id
// de la cuenta de ML), sin decir a qué empresa de Zilonix pertenece —
// eso es justo lo que hay que averiguar. Mismo patrón que
// dbComoInvitacion(): un secreto puntual (acá, el user_id que mandó
// Mercado Libre) da acceso a UNA fila de `cuentas_ml`, nunca a las de
// las demás empresas — ver la política `cuentas_ml_por_aviso_webhook`
// en db/rls-setup.sql. No hay sesión de usuario en un webhook: no hace
// falta (ni existe) ningún usuario_actual acá.
export async function dbComoAvisoWebhook<T>(cuentaIdExterna: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.empresa_actual', ${EMPRESA_SENTINEL}, true)`);
    await tx.execute(sql`SELECT set_config('app.cuenta_ml_externa_actual', ${cuentaIdExterna}, true)`);
    return fn(tx as unknown as typeof db);
  });
}
