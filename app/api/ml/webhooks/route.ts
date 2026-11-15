import { NextRequest, NextResponse } from "next/server";
import { recibirAviso, type AvisoMl } from "@/lib/ml/avisos";
import { intentarProcesarAvisoAhora } from "@/lib/ml/trabajador";

// Issue "despachos no aparecen solos" (Refs #49) — mismos temas que
// mueven pedidos/despachos_ml en lib/ml/trabajador.ts (TOPICS_VENTA);
// solo esos vale la pena intentarlos al instante acá.
const TOPICS_VENTA = new Set(["orders_v2", "shipments"]);

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
// callback por completo. Por eso acá se guarda el aviso (un INSERT,
// rápido) y recién después se intenta procesarlo.
//
// Issue "despachos no aparecen solos" (Refs #49) — el cron de
// lib/ml/trabajador.ts (disparado por GitHub Actions) podía tardar
// 3-5h en correr en staging (retraso real de `schedule`, no una
// config rota), así que una venta pagada se quedaba invisible en
// Despachos todo ese tiempo. Para "orders_v2"/"shipments" (los dos
// temas que mueven pedidos/despachos_ml) ahora se intenta procesar
// ACÁ MISMO, con un solo intento y un tope corto (intentarProcesarAvisoAhora,
// lib/ml/trabajador.ts) — nunca más de ese tope, y nunca deja que un
// error rompa el 200. Si falla o se pasa del tiempo, el aviso queda
// pendiente para que el cron de respaldo lo reintente, igual que antes.
//
// Fix real (2026-10-21) — esta ruta es pública en el middleware (ver
// lib/rutas-publicas.ts, nunca pasa por auth.protect()), así que
// cualquiera en internet puede llamarla: dos capas nuevas, ninguna
// cambia el "siempre 200" de arriba (un 4xx/5xx le haría reintentar de
// más a Mercado Libre, o apagarle el callback, por algo que ni
// siquiera es suyo).
const TAMANO_MAXIMO_BYTES = 16 * 1024; // un aviso real de ML son unas pocas líneas de JSON

type LecturaCuerpo = { ok: true; texto: string } | { ok: false };

// Corregido (2026-10-21): el tope anterior solo miraba el header
// Content-Length — un valor que quien llama controla por completo (se
// puede mentir, o simplemente omitir con un cuerpo en chunked, donde
// Content-Length no existe). Se lee el stream real byte a byte y se
// corta apenas se pasa del tope, sin importar qué diga (o no diga) ese
// header — un cuerpo real de 20KB sin Content-Length también se frena
// acá, antes de llegar a JSON.parse.
async function leerCuerpoConTope(request: NextRequest, topeBytes: number): Promise<LecturaCuerpo> {
  const reader = request.body?.getReader();
  if (!reader) {
    // Sin stream disponible (caso raro) — se cae al camino normal, sin
    // tope real, pero nunca revienta la petición.
    const texto = await request.text().catch(() => "");
    return { ok: true, texto };
  }

  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > topeBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    trozos.push(value);
  }
  return { ok: true, texto: Buffer.concat(trozos.map((t) => Buffer.from(t))).toString("utf8") };
}

export async function POST(request: NextRequest) {
  const lectura = await leerCuerpoConTope(request, TAMANO_MAXIMO_BYTES);
  if (!lectura.ok) {
    return NextResponse.json({ ok: false, motivo: "cuerpo demasiado grande" }, { status: 200 });
  }

  let body: (AvisoMl & { application_id?: string | number }) | null;
  try {
    body = JSON.parse(lectura.texto);
  } catch {
    body = null;
  }

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

  const recepcion = await recibirAviso(body);

  // Issue "despachos no aparecen solos" (Refs #49) — intento síncrono,
  // SOLO si la fila es nueva de verdad (nunca sobre un duplicado o una
  // cuenta ajena) y es un tema de venta. intentarProcesarAvisoAhora
  // nunca deja escapar un error (siempre resuelve, nunca rechaza) — el
  // 200 de abajo sale sin importar qué devuelva.
  if (recepcion.resultado === "guardado" && recepcion.avisoId && TOPICS_VENTA.has(body.topic)) {
    await intentarProcesarAvisoAhora(recepcion.avisoId).catch(() => {});
  }

  return NextResponse.json({ ok: true, resultado: recepcion.resultado });
}
