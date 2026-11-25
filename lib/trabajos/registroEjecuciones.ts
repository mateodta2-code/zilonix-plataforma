import { sql } from "drizzle-orm";

// Estado de los procesos (25-nov): cada proceso automático anota su
// corrida en ejecuciones_procesos para que el superadmin vea desde el
// panel si sigue vivo (antes solo estaba en los logs de Railway).
// Cada proceso escribe con SU usuario de base (el mismo que ya usa para
// trabajar) a través de registrar_ejecucion_proceso() — la base decide
// qué proceso puede anotar cada usuario (db/rls-setup.sql).

export const PROCESOS = ["avisos_ml", "publicidad", "seguimiento"] as const;
export type Proceso = (typeof PROCESOS)[number];

// D8: el resumen va al panel superadmin, así que solo pasan conteos.
// Hoy los tres procesos devuelven solo números, pero si mañana alguno
// agrega un texto (un nickname, un id de pedido), acá se descarta en
// vez de filtrarse al superadmin.
export function soloConteos(resultado: unknown): Record<string, number> {
  const salida: Record<string, number> = {};
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) return salida;
  for (const [clave, valor] of Object.entries(resultado)) {
    if (typeof valor === "number" && Number.isFinite(valor)) salida[clave] = valor;
  }
  return salida;
}

// Un mensaje de error puede traer la cadena de conexión a la base o una
// URL con token: nunca se guarda tal cual. Solo el tipo de error y el
// texto sin URLs, recortado.
export function errorCorto(error: unknown): string {
  if (!(error instanceof Error)) return "Error desconocido";
  const limpio = error.message.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]").replace(/\s+/g, " ").trim();
  return `${error.name}: ${limpio}`.slice(0, 300);
}

// Import dinámico: los contextos de publicidad y seguimiento revientan
// al cargarse si falta su variable de base (ver sus rutas en
// app/api/trabajos/*), y esto se importa desde las tres rutas.
async function dbDe(proceso: Proceso) {
  if (proceso === "avisos_ml") return (await import("@/db/trabajador-context")).dbTrabajador;
  if (proceso === "publicidad") return (await import("@/db/trabajador-publicidad-context")).dbTrabajadorPublicidad;
  return (await import("@/db/trabajador-seguimiento-context")).dbTrabajadorSeguimiento;
}

export async function registrarEjecucion(proceso: Proceso, inicio: Date, ok: boolean, resumen: Record<string, number>, error: string | null): Promise<void> {
  try {
    const db = await dbDe(proceso);
    await db.execute(
      sql`select registrar_ejecucion_proceso(${proceso}, ${inicio.toISOString()}::timestamptz, ${ok}, ${JSON.stringify(resumen)}::jsonb, ${error})`
    );
  } catch (e) {
    // Anotar la corrida nunca puede tumbar el proceso mismo: si falla,
    // el trabajo ya se hizo; solo queda en el log.
    console.error(`[lib/trabajos/registroEjecuciones] no se pudo anotar la corrida de ${proceso}:`, errorCorto(e));
  }
}

// Corre el proceso y anota la corrida, salga bien o mal. El error se
// vuelve a lanzar: cada ruta sigue respondiendo como antes.
export async function ejecutarConRegistro<T>(proceso: Proceso, trabajo: () => Promise<T>): Promise<T> {
  const inicio = new Date();
  try {
    const resultado = await trabajo();
    await registrarEjecucion(proceso, inicio, true, soloConteos(resultado), null);
    return resultado;
  } catch (error) {
    await registrarEjecucion(proceso, inicio, false, {}, errorCorto(error));
    throw error;
  }
}
