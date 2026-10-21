import { NextRequest, NextResponse } from "next/server";
import { procesarAvisosPendientes } from "@/lib/ml/trabajador";

// Tarea 2.4 — sin sesión de usuario (lo llama un cron, no una persona),
// protegida con un secreto compartido elegido por una persona (nunca
// por Claude Code), mismo patrón que `x-setup-secret` del Zilonix OS
// actual. `.github/workflows/trabajador-avisos.yml` lo llama cada
// minuto — Railway no tiene todavía el tercer servicio "trabajador de
// cola" que pide la decisión D4 del plan técnico; un cron externo es
// honesto con el alcance de hoy (mismo criterio que ya usa el Zilonix
// OS actual para su "cron de respaldo" de Telegram) y se reemplaza por
// el servicio real cuando el volumen lo justifique.
export async function POST(request: NextRequest) {
  const secreto = request.headers.get("x-trabajador-secret");
  if (!secreto || secreto !== process.env.TRABAJADOR_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const resultado = await procesarAvisosPendientes();
  return NextResponse.json({ ok: true, ...resultado });
}
