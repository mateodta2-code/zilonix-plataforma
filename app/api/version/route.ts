import { commitCorto, VERSION } from "@/lib/version";

// Tarea 1.1 del plan técnico — solo el número de versión, sin datos.
// Pública a propósito (sirve para confirmar un deploy sin sesión).
//
// Issue #37 (Z-P0-09) — se agrega el commit real desplegado, para
// poder confirmar un deploy sin adivinar si quedó la versión anterior
// con el mismo número de package.json.
//
// Ajuste issue #37: sin esto, Next puede prerenderizar esta ruta como
// estática en el build y servir siempre el mismo commit cacheado — el
// punto entero de este endpoint es confirmar el deploy que está
// corriendo AHORA, así que nunca puede cachearse ni prerenderizarse.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return Response.json({ version: VERSION, commit: commitCorto(process.env.RAILWAY_GIT_COMMIT_SHA) });
}
