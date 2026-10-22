import { commitDesplegado, VERSION } from "@/lib/version";

// Tarea 1.1 — pública a propósito: confirma un deploy sin sesión.
// Z-P0-09 (#37): también el commit corto. Nada más — ni rama, ni autor,
// ni mensaje, ni ninguna otra variable de Railway.
//
// force-dynamic: en Next.js 14 un GET que devuelve Response se
// prerenderiza en `next build` y ese JSON queda congelado. Sin
// RAILWAY_GIT_COMMIT_SHA en el build (local, CI, y a veces el propio
// build de Railway: el SHA sale en el log pero no entra al bundle de
// Next — station.railway.com, "I cant make RAILWAY_GIT_COMMIT_SHA
// reach my app") la respuesta quedaría en "desconocido" para siempre,
// aunque el contenedor sí tenga la variable en runtime.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ version: VERSION, commit: commitDesplegado() });
}
