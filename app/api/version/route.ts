import { commitCorto, VERSION } from "@/lib/version";

// Tarea 1.1 del plan técnico — solo el número de versión, sin datos.
// Pública a propósito (sirve para confirmar un deploy sin sesión).
//
// Issue #37 (Z-P0-09) — se agrega el commit real desplegado, para
// poder confirmar un deploy sin adivinar si quedó la versión anterior
// con el mismo número de package.json.
export async function GET() {
  return Response.json({ version: VERSION, commit: commitCorto(process.env.RAILWAY_GIT_COMMIT_SHA) });
}
