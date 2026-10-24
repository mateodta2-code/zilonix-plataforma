import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

// Issue #175 — sin sesión de usuario (lo llama un cron, no una
// persona), protegida con un secreto compartido, mismo patrón que
// app/api/ml/trabajador/route.ts. Pública en el middleware (ver
// lib/rutas-publicas.ts) — el secreto es la ÚNICA puerta, comparado
// con crypto.timingSafeEqual (nunca "===", que revela por timing
// cuánto del secreto coincide).
function secretoCoincide(recibido: string, esperado: string): boolean {
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);
  if (bufferRecibido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecibido, bufferEsperado);
}

// Issue #175 — "si falta una variable, responde 503 con un mensaje
// claro, sin romper el build": lib/trabajos/revisionDiariaSeguimiento.ts
// importa (transitivo) db/trabajador-seguimiento-context.ts, que
// revienta al cargarse si falta DATABASE_URL_SEGUIMIENTO (mismo patrón
// que db/trabajador-context.ts) — un import ESTÁTICO de ese módulo acá
// arriba haría que el build de Next.js (que carga este archivo para
// inspeccionar sus exports) reviente si esa variable todavía no existe
// en el ambiente. El import dinámico de abajo, DENTRO del handler,
// nunca se ejecuta durante el build — recién cuando llega una petición
// real, y ya después de confirmar que la variable existe.
export async function POST(request: NextRequest) {
  const secretoEsperado = process.env.SEGUIMIENTO_TRABAJADOR_SECRET;
  if (!secretoEsperado) {
    return NextResponse.json({ ok: false, error: "Falta la variable SEGUIMIENTO_TRABAJADOR_SECRET en este ambiente." }, { status: 503 });
  }

  const secretoRecibido = request.headers.get("x-seguimiento-trabajador-secret");
  if (!secretoRecibido || !secretoCoincide(secretoRecibido, secretoEsperado)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!process.env.DATABASE_URL_SEGUIMIENTO) {
    return NextResponse.json({ ok: false, error: "Falta la variable DATABASE_URL_SEGUIMIENTO en este ambiente." }, { status: 503 });
  }

  try {
    const { revisarSeguimientosDelDia } = await import("@/lib/trabajos/revisionDiariaSeguimiento");
    const resultado = await revisarSeguimientosDelDia();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    // Nunca el detalle crudo del error (podría incluir datos de
    // conexión a la base) — solo al log del servidor.
    console.error("[app/api/trabajos/seguimiento] la revisión diaria no se pudo correr:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "No se pudo correr la revisión diaria — revisá los logs del servidor." }, { status: 503 });
  }
}
