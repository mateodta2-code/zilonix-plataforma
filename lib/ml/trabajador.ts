import { and, eq, isNull } from "drizzle-orm";
import { dbTrabajador } from "@/db/trabajador-context";
import { avisosMl, cuentasMl } from "@/db/schema";
import { dbComoEmpresa } from "@/db/empresa-context";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { LimiteMercadoLibreError, pedirLecturaMl } from "@/lib/ml/cliente";
import { sincronizarDespacho } from "@/lib/ml/despachos";
import { guardarOrdenMl, type Esperar } from "@/lib/ml/ventas-finanzas";
import type { OrdenMl } from "@/lib/finanzas/venta-ml";
import { msDeReintento429 } from "@/lib/ml/reintento-429";

const TAMAÑO_LOTE = 50;
const REINTENTOS_429 = 4;
const ESPERA_BASE_429_MS = 1_000;
// Issue "ventas nuevas en segundos" (Refs #49) — rate limiting real:
// nunca se procesan los avisos de un lote todos a la vez (serían
// varias llamadas a Mercado Libre por aviso — orden, envío, costos,
// ítems, SLA — y hasta TAMAÑO_LOTE avisos en una sola corrida del
// cron). Una pausa chica entre uno y el siguiente alcanza para no
// disparar una ráfaga; el backoff de abajo (REINTENTOS_429) sigue
// siendo lo que de verdad protege contra un 429 real.
const PAUSA_ENTRE_AVISOS_MS = 150;
const esperarDeVerdad: Esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PATRON_ID_NUMERICO = /^\d+$/;

// Issue "ventas nuevas en segundos" — de los temas reales de Mercado
// Libre, estos dos son los que de verdad mueven pedidos/despachos_ml;
// el resto (items, payments, user_products...) sigue con el
// comportamiento de la tarea 2.4 (solo confirma que el recurso es
// real y accesible) — alcance de esta tarea, no todos los temas a la vez.
const TOPICS_VENTA = new Set(["orders_v2", "shipments"]);

export type ResultadoTrabajador = {
  recibidosPendientes: number;
  procesados: number;
  fallidos: number;
};

// Tarea 2.4 + issue "ventas nuevas en segundos" (Refs #49) — la otra
// mitad del receptor de avisos (la primera, recibir y guardar rápido,
// ya estaba). Para "orders_v2"/"shipments" ahora SÍ escribe en
// pedidos/despachos_ml (antes solo confirmaba que el dato existía) —
// misma lógica real que sincronizarVentasCuenta (lib/ml/ventas-finanzas.ts)
// y el fix del PR #345 (shipmentId resuelto por guardarOrdenMl, nunca
// adivinado). Nunca se confía en el CONTENIDO del aviso para los
// datos de negocio — solo en la RUTA que trae, para pedirle a Mercado
// Libre el dato real; eso es justo lo que ya hacía esta función desde
// la tarea 2.4, nunca cambió.
export async function procesarAvisosPendientes(esperar: Esperar = esperarDeVerdad): Promise<ResultadoTrabajador> {
  const pendientes = await dbTrabajador
    .select()
    .from(avisosMl)
    .where(isNull(avisosMl.procesadoTs))
    .limit(TAMAÑO_LOTE);

  let procesados = 0;
  let fallidos = 0;

  for (let i = 0; i < pendientes.length; i++) {
    const aviso = pendientes[i];
    try {
      await procesarUnAviso(aviso, esperar);
      await dbTrabajador
        .update(avisosMl)
        .set({ procesadoTs: new Date() })
        .where(and(eq(avisosMl.id, aviso.id), isNull(avisosMl.procesadoTs)));
      procesados += 1;
    } catch (error) {
      // Un aviso que falla (cuenta sin token vigente, orden borrada en
      // ML, error de red) no debe tumbar el lote entero — se deja
      // pendiente (procesado_ts sigue null) para que el próximo paso
      // del trabajador lo reintente. La sincronización de cada hora
      // (lib/finanzas/traer-ventas-mes.ts) queda como respaldo de
      // todas formas, aunque esto se quedara pendiente para siempre.
      fallidos += 1;
      console.error(`Aviso ${aviso.id} (${aviso.topic}) no se pudo procesar:`, error instanceof Error ? error.message : error);
    }
    if (i < pendientes.length - 1) await esperar(PAUSA_ENTRE_AVISOS_MS);
  }

  return { recibidosPendientes: pendientes.length, procesados, fallidos };
}

async function procesarUnAviso(aviso: typeof avisosMl.$inferSelect, esperar: Esperar): Promise<void> {
  const cuentaId = await dbComoEmpresa(aviso.empresaId, async (tx) => {
    const [cuenta] = await tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, aviso.cuentaIdExterna));
    return cuenta?.id ?? null;
  });
  if (!cuentaId) throw new Error("La cuenta de Mercado Libre ya no está conectada a esta empresa.");

  const accessToken = await obtenerAccessTokenVigente(aviso.empresaId, cuentaId);

  // No te tragues un 429 en silencio: reintenta con espera creciente
  // (mismo patrón que leerConReintento en lib/ml/ventas-finanzas.ts).
  // Cubre las llamadas PROPIAS de esta función (abajo) — guardarOrdenMl
  // ya reintenta las suyas por su cuenta con el mismo `esperar`.
  for (let intento = 0; ; intento++) {
    try {
      if (TOPICS_VENTA.has(aviso.topic)) {
        await sincronizarVentaDesdeAviso(aviso.empresaId, cuentaId, accessToken, aviso.topic, aviso.resource, esperar);
      } else {
        await confirmarRecursoReal(aviso.resource, accessToken);
      }
      return;
    } catch (error) {
      if (!(error instanceof LimiteMercadoLibreError) || intento >= REINTENTOS_429) throw error;
      await esperar(msDeReintento429(ESPERA_BASE_429_MS * 2 ** intento, error.retryAfterMs ?? null));
    }
  }
}

// Comportamiento de siempre (tarea 2.4) para cualquier tema que no sea
// de venta — "procesar" significa "confirmar que el dato es real y
// accesible", honesto con el alcance de esos temas todavía. pedirLecturaMl
// (lib/ml/cliente.ts) en vez de un fetch suelto a mano — eso sí cambió,
// ver el comentario junto a TOPICS_VENTA.
async function confirmarRecursoReal(resource: string, accessToken: string): Promise<void> {
  const resp = await pedirLecturaMl<unknown>(resource, accessToken);
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Mercado Libre respondió ${resp.status} al consultar ${resource}.`);
  }
}

function idDeRecurso(resource: string, prefijo: string): string | null {
  if (!resource.startsWith(prefijo)) return null;
  const id = resource.slice(prefijo.length);
  return PATRON_ID_NUMERICO.test(id) ? id : null;
}

// Issue "ventas nuevas en segundos" — bug real corregido en el PR #345:
// sincronizarVentasCuenta decidía si sincronizar el despacho mirando
// orden.shipping?.id de la orden del LISTADO, que guardarOrdenMl
// reemplaza LOCALMENTE por la del DETALLE sin que el cambio se vea
// afuera. Acá nunca se repite ese error: se pide primero el DETALLE
// real de la orden (completo, nunca un objeto a medias armado con
// datos del aviso) y se usa guardada.shipmentIdExterno — el mismo que
// guardarOrdenMl ya resolvió y usó para traer envío/costos — para
// decidir si sincronizar el despacho, nunca una suposición propia.
//
// "shipments": el aviso no trae el pedido, solo el envío — se pide el
// envío real primero (únicamente para sacar el order_id real; no hay
// otra forma honesta de llegar del envío al pedido) y de ahí se sigue
// el mismo camino que "orders_v2".
async function sincronizarVentaDesdeAviso(
  empresaId: string,
  cuentaId: string,
  accessToken: string,
  topic: string,
  resource: string,
  esperar: Esperar
): Promise<void> {
  let orderId: string | null = null;

  if (topic === "orders_v2") {
    orderId = idDeRecurso(resource, "/orders/");
  } else {
    const shipmentId = idDeRecurso(resource, "/shipments/");
    if (!shipmentId) return; // recurso con forma rara — nada que hacer, no es un fallo real.
    const respEnvio = await pedirLecturaMl<{ order_id?: unknown }>(resource, accessToken);
    if (!respEnvio.ok) {
      if (respEnvio.status === 404) return; // envío de prueba que nunca existió — no es un fallo.
      throw new Error(`Mercado Libre respondió ${respEnvio.status} al consultar ${resource}.`);
    }
    orderId = respEnvio.data.order_id != null ? String(respEnvio.data.order_id) : null;
  }
  if (!orderId || !PATRON_ID_NUMERICO.test(orderId)) return;

  // Nunca un objeto a medias armado con lo que trajo el aviso: se pide
  // el pedido COMPLETO antes de guardarlo — si esta lectura fallara (no
  // 404) y se le pasara a guardarOrdenMl un objeto incompleto, su
  // propio reintento del detalle podría caer en el mismo incompleto
  // como respaldo (lib/ml/ventas-finanzas.ts, leerDetalleOrden) y
  // guardar datos a medias.
  const respOrden = await pedirLecturaMl<OrdenMl>(`/orders/${orderId}`, accessToken);
  if (!respOrden.ok) {
    if (respOrden.status === 404) return; // orden de prueba que nunca existió — no es un fallo.
    throw new Error(`Mercado Libre respondió ${respOrden.status} al consultar /orders/${orderId}.`);
  }

  const guardada = await guardarOrdenMl(empresaId, cuentaId, accessToken, respOrden.data, esperar);
  if (guardada.shipmentIdExterno) {
    await sincronizarDespacho(empresaId, cuentaId, guardada.pedidoId, guardada.shipmentIdExterno);
  }
}
