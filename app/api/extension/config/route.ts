import { NextResponse } from "next/server";
import { configExtension } from "@/lib/extension/configuracion";
import { urlPublicaDesdeEnv } from "@/lib/url-publica-env";

// Configuración (servidor, textos, interruptores) que lee la extensión.
// Pública a propósito (ver lib/rutas-publicas.ts): la extensión la pide
// desde su service worker, a veces sin sesión, y solo devuelve valores
// no sensibles de lib/extension/configuracion.ts — nunca datos de una
// empresa. Si esta ruta falla, la extensión sigue con sus valores por
// defecto, así que nunca es un punto único de falla.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(configExtension(urlPublicaDesdeEnv()), {
    headers: { "Cache-Control": "no-store" },
  });
}
