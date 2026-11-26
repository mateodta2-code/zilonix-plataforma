import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

// Issue #422 — sin sesión de usuario (lo llama un cron cada 30 min, no
// una persona). Pública en el middleware (lib/rutas-publicas.ts). El
// secreto es la única puerta, comparado con crypto.timingSafeEqual.
// Mismo patrón que app/api/trabajos/publicidad/route.ts.
function secretoCoincide(recibido: string, esperado: string): boolean {
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);
  if (bufferRecibido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecibido, bufferEsperado);
}

// Import dinámico: lib/trabajos/sincronizarFalabella.ts carga
// db/trabajador-falabella-context.ts, que revienta si falta
// DATABASE_URL_FALABELLA. Un import estático haría fallar el build.
export async function POST(request: NextRequest) {
  const secretoEsperado = process.env.FALABELLA_TRABAJADOR_SECRET;
  if (!secretoEsperado) {
    return NextResponse.json({ ok: false, error: "Falta la variable FALABELLA_TRABAJADOR_SECRET en este ambiente." }, { status: 503 });
  }

  const secretoRecibido = request.headers.get("x-falabella-trabajador-secret");
  if (!secretoRecibido || !secretoCoincide(secretoRecibido, secretoEsperado)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!process.env.DATABASE_URL_FALABELLA) {
    return NextResponse.json({ ok: false, error: "Falta la variable DATABASE_URL_FALABELLA en este ambiente." }, { status: 503 });
  }

  try {
    const { sincronizarFalabellaProgramada, errorSeguro } = await import("@/lib/trabajos/sincronizarFalabella");
    try {
      const resumen = await sincronizarFalabellaProgramada();
      return NextResponse.json({ ok: true, ...resumen });
    } catch (error) {
      console.error("[app/api/trabajos/falabella] la sincronización no se pudo correr:", errorSeguro(error));
      return NextResponse.json({ ok: false, error: "No se pudo sincronizar Falabella — revisa los logs del servidor." }, { status: 503 });
    }
  } catch {
    console.error("[app/api/trabajos/falabella] no se pudo cargar el trabajo de sincronización.");
    return NextResponse.json({ ok: false, error: "No se pudo sincronizar Falabella — revisa los logs del servidor." }, { status: 503 });
  }
}
