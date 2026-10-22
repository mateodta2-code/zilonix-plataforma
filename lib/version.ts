// Única fuente de verdad de la versión — pie de página y /api/version
// leen de acá, nunca se escribe el número en dos lugares distintos.
import packageJson from "../package.json";

export const VERSION = packageJson.version;

// Railway la inyecta sola, en el build y en el contenedor, cuando el
// deploy sale de un trigger de GitHub (docs.railway.com/variables/reference,
// "Git variables"). Es el SHA completo, p. ej.
// d0beb8f5c55b36df7d674d55965a23b8d54ad69b. No hay que crearla en el
// dashboard: si falta, el deploy no vino de GitHub.
//
// En local y en CI no existe. GitHub Actions sí pone GITHUB_SHA, pero
// el contrato de /api/version (issue #37) es esta variable y nada más:
// sin ella la respuesta es "desconocido", no se adivina otro SHA.
const VARIABLE_COMMIT_RAILWAY = "RAILWAY_GIT_COMMIT_SHA";

export const COMMIT_DESCONOCIDO = "desconocido";

// Corto, como `git rev-parse --short` por defecto. Alcanza para
// distinguir un deploy de otro sin publicar el SHA entero.
const LARGO_COMMIT = 7;

export function commitDesplegado(): string {
  // Acceso dinámico: Next.js reemplaza en el bundle el acceso estático
  // process.env.NEXT_PUBLIC_* (y las claves de `env` en next.config).
  // Esta clave no es pública y no debe quedar horneada. El contenedor
  // de Railway la tiene en runtime; un `next build` local no.
  const crudo = process.env[VARIABLE_COMMIT_RAILWAY];
  if (typeof crudo !== "string") return COMMIT_DESCONOCIDO;
  const sha = crudo.trim().toLowerCase();
  // Solo hex (SHA-1 de 40 o SHA-256 de 64). Si el valor no es un
  // commit, no se republica: la ruta no puede servir de eco de la
  // variable.
  if (!/^[0-9a-f]{7,64}$/.test(sha)) return COMMIT_DESCONOCIDO;
  return sha.slice(0, LARGO_COMMIT);
}
