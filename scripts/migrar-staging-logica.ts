// Barreras del migrador automático de staging. Función pura para poder
// probarla sin base de datos.
const ROLES_RLS = [
  "app_user",
  "superadmin_user",
  "trabajador_user",
  "seguimiento_trabajador_user",
  "publicidad_trabajador_user",
] as const;

export { ROLES_RLS };

// Devuelve el motivo por el que NO se debe migrar, o null si se puede.
export function motivoDeNegacion(env: Record<string, string | undefined>): string | null {
  if (env.MIGRAR_AL_DESPLEGAR !== "staging") {
    return 'MIGRAR_AL_DESPLEGAR no vale "staging": no se migra automáticamente.';
  }
  const entorno = (env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase();
  if (entorno.includes("production") || entorno.includes("produccion") || entorno.includes("producción")) {
    return "El entorno parece producción: allí las migraciones son manuales y con aprobación.";
  }
  if (!env.DATABASE_URL) return "Falta DATABASE_URL (la URL con permisos de dueño).";
  return null;
}

// rls-setup.sql solo usa las contraseñas marcadoras dentro de
// CREATE ROLE ... IF NOT EXISTS. Si algún rol falta, correrlo crearía
// el rol con la contraseña marcadora literal: se prohíbe.
export function rolesFaltantes(existentes: string[]): string[] {
  return ROLES_RLS.filter((r) => !existentes.includes(r));
}
