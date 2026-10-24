import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { procesarAvisosPendientes } from "@/lib/ml/trabajador";

// Tarea 2.4 — sin sesión de usuario (lo llama un cron, no una persona),
// protegida con un secreto compartido elegido por una persona (nunca
// por Claude Code), mismo patrón que `x-setup-secret` del Zilonix OS
// actual. `.github/workflows/trabajador-avisos-ml.yml` lo llama cada
// minuto — Railway no tiene todavía el tercer servicio "trabajador de
// cola" que pide la decisión D4 del plan técnico; un cron externo es
// honesto con el alcance de hoy (mismo criterio que ya usa el Zilonix
// OS actual para su "cron de respaldo" de Telegram) y se reemplaza por
// el servicio real cuando el volumen lo justifique.
//
// Fix real (2026-10-21) — esta ruta es pública en el middleware (ver
// lib/rutas-publicas.ts), así que el secreto es la ÚNICA puerta: se
// compara con `crypto.timingSafeEqual` (nunca `===`, que revela por
// timing cuánto del secreto coincide) — timingSafeEqual exige buffers
// de IGUAL longitud, así que primero se comparan las longitudes; si
// difieren, 401 directo, sin llegar a compararlo byte a byte.
function secretoCoincide(recibido: string, esperado: string): boolean {
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);
  if (bufferRecibido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecibido, bufferEsperado);
}

export async function POST(request: NextRequest) {
  const secretoEsperado = process.env.TRABAJADOR_SECRET;
  const secretoRecibido = request.headers.get("x-trabajador-secret");
  if (!secretoEsperado || !secretoRecibido || !secretoCoincide(secretoRecibido, secretoEsperado)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const resultado = await procesarAvisosPendientes();
  return NextResponse.json({ ok: true, ...resultado });
}
