import { VERSION } from "@/lib/version";

// Tarea 1.1 del plan técnico — solo el número de versión, sin datos.
// Pública a propósito (sirve para confirmar un deploy sin sesión).
export async function GET() {
  return Response.json({ version: VERSION });
}
