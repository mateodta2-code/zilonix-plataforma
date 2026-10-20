import { NextRequest, NextResponse } from "next/server";
import { recibirAviso, type AvisoMl } from "@/lib/ml/avisos";

// Tarea 2.4 (adelanto parcial, pedido real de Mateo 20/10 para poder
// terminar de una vez la configuración de la app en Mercado Libre
// Developers). Contrato real documentado por Mercado Libre (topic
// "orders_v2" y otros): POST { resource, user_id, topic, application_id,
// attempts, sent, received } — confirmado contra el webhook que ya
// corre hoy en producción en el Zilonix OS actual
// (zilonix-os-web/app/api/ml/webhook-notificaciones/route.js).
//
// Mercado Libre espera un 200 RÁPIDO — si no le llega a tiempo,
// reintenta y, después de varios fallos seguidos, puede desactivar el
// callback por completo. Por eso acá SOLO se guarda el aviso (un
// INSERT, rápido) y se responde — nunca se espera a procesarlo de
// verdad (eso es el resto de la tarea 2.4, el trabajador, todavía sin
// construir).
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as AvisoMl | null;

  // Se responde 200 siempre que el cuerpo venga bien formado, aunque la
  // cuenta no sea nuestra o el aviso ya se hubiera recibido — un
  // 4xx/5xx acá hace que Mercado Libre reintente de más o, a la larga,
  // apague el callback.
  if (!body || !body.resource || !body.user_id || !body.topic || !body.sent) {
    return NextResponse.json({ ok: false, motivo: "cuerpo incompleto" }, { status: 200 });
  }

  const resultado = await recibirAviso(body);
  return NextResponse.json({ ok: true, resultado });
}
