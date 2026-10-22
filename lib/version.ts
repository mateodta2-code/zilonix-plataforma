// Única fuente de verdad de la versión — pie de página y /api/version
// leen de acá, nunca se escribe el número en dos lugares distintos.
import packageJson from "../package.json";

export const VERSION = packageJson.version;

// Issue #37 (Z-P0-09) — Railway ya inyecta RAILWAY_GIT_COMMIT_SHA solo
// (el commit real que está corriendo), sin que nadie tenga que
// mantenerlo a mano. Función pura (recibe el valor, no lee
// process.env ella misma) para poder probar los 3 casos reales sin
// tener que simular variables de entorno: SHA normal, SHA vacío
// (variable puesta pero sin valor) y variable ausente (undefined) —
// los dos últimos dan lo mismo, "desconocido", porque ninguno es un
// commit real que mostrar.
export function commitCorto(sha: string | undefined): string {
  if (!sha) return "desconocido";
  return sha.slice(0, 7);
}
