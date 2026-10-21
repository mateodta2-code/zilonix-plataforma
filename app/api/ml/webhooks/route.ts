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
//
// Fix real (2026-10-21) — esta ruta es pública en el middleware (ver
// lib/rutas-publicas.ts, nunca pasa por auth.protect()), así que
// cualquiera en internet puede llamarla: dos capas nuevas, ninguna
// cambia el "siempre 200" de arriba (un 4xx/5xx le haría reintentar de
// más a Mercado Libre, o apagarle el callback, por algo que ni
// siquiera es suyo).
const TAMANO_MAXIMO_BYTES = 16 * 1024; // un aviso real de ML son unas pocas líneas de JSON

export async function POST(request: NextRequest) {
  // 1) Tamaño del cuerpo, por Content-Length — Mercado Libre siempre
  // lo manda; si no viene (caso raro, chunked) se sigue de largo y lo
  // filtra igual la validación de forma de abajo.
  const tamanoDeclarado = Number(request.headers.get("content-length") ?? 0);
  if (tamanoDeclarado > TAMANO_MAXIMO_BYTES) {
    return NextResponse.json({ ok: false, motivo: "cuerpo demasiado grande" }, { status: 200 });
  }

  const body = (await request.json().catch(() => null)) as (AvisoMl & { application_id?: string | number }) | null;

  // Se responde 200 siempre que el cuerpo venga bien formado, aunque la
  // cuenta no sea nuestra o el aviso ya se hubiera recibido — un
  // 4xx/5xx acá hace que Mercado Libre reintente de más o, a la larga,
  // apague el callback.
  if (!body || !body.resource || !body.user_id || !body.topic || !body.sent) {
    return NextResponse.json({ ok: false, motivo: "cuerpo incompleto" }, { status: 200 });
  }

  // 2) application_id — el dato real que confirma que este aviso es
  // para NUESTRA app de Mercado Libre, no de cualquiera que le pegue a
  // esta URL pública. Si ML_CLIENT_ID no está configurado, se rechaza
  // todo (cerrado por defecto, nunca "si no sé, dejo pasar").
  if (!process.env.ML_CLIENT_ID || String(body.application_id) !== process.env.ML_CLIENT_ID) {
    return NextResponse.json({ ok: false, motivo: "application_id ajeno" }, { status: 200 });
  }

  const resultado = await recibirAviso(body);
  return NextResponse.json({ ok: true, resultado });
}
