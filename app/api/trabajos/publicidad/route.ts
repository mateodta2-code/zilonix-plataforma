import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { textoErrorCorto } from "@/lib/publicidad/plan";

// Issue #254 — sin sesión de usuario (lo llama un cron, no una
// persona). Pública en el middleware (lib/rutas-publicas.ts). El
// secreto es la única puerta, comparado con crypto.timingSafeEqual.
function secretoCoincide(recibido: string, esperado: string): boolean {
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);
  if (bufferRecibido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecibido, bufferEsperado);
}

// Import dinámico, igual que app/api/trabajos/seguimiento/route.ts:
// lib/trabajos/sincronizarPublicidad.ts carga
// db/trabajador-publicidad-context.ts, que revienta si falta
// DATABASE_URL_PUBLICIDAD. Un import estático haría fallar el build
// de Next antes de que la variable exista en el ambiente.
export async function POST(request: NextRequest) {
  const secretoEsperado = process.env.PUBLICIDAD_TRABAJADOR_SECRET;
  if (!secretoEsperado) {
    return NextResponse.json({ ok: false, error: "Falta la variable PUBLICIDAD_TRABAJADOR_SECRET en este ambiente." }, { status: 503 });
  }

  const secretoRecibido = request.headers.get("x-publicidad-trabajador-secret");
  if (!secretoRecibido || !secretoCoincide(secretoRecibido, secretoEsperado)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!process.env.DATABASE_URL_PUBLICIDAD) {
    return NextResponse.json({ ok: false, error: "Falta la variable DATABASE_URL_PUBLICIDAD en este ambiente." }, { status: 503 });
  }

  try {
    const { sincronizarPublicidadProgramada } = await import("@/lib/trabajos/sincronizarPublicidad");
    const resultado = await sincronizarPublicidadProgramada();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    console.error("[app/api/trabajos/publicidad] la sincronización no se pudo correr:", textoErrorCorto(error));
    return NextResponse.json({ ok: false, error: "No se pudo sincronizar la publicidad — revisá los logs del servidor." }, { status: 503 });
  }
}
