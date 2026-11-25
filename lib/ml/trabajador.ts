import { and, eq, isNull, lt, notInArray, sql } from "drizzle-orm";
import { dbTrabajador } from "@/db/trabajador-context";
import { avisosMl, cuentasMl } from "@/db/schema";
import { dbComoEmpresa } from "@/db/empresa-context";
import { CuentaDesconectadaError, CuentaMlNoEncontradaError, EmpresaSuspendidaError, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { LimiteMercadoLibreError, pedirLecturaMl } from "@/lib/ml/cliente";
import { sincronizarDespacho } from "@/lib/ml/despachos";
import { guardarOrdenMl, type Esperar } from "@/lib/ml/ventas-finanzas";
import type { OrdenMl } from "@/lib/finanzas/venta-ml";
import { msDeReintento429 } from "@/lib/ml/reintento-429";

const TAMAÑO_LOTE = 50;
// 25-nov: el cron de GitHub dice «cada minuto» pero en staging corre cada
// 5-10 h (GitHub lo frena), y a 50 avisos por vuelta la cola nunca bajaba.
// Cada llamada sigue tomando lotes hasta este presupuesto; el workflow
// corta el curl a los 60 s, así que queda margen para responder.
const PRESUPUESTO_LLAMADA_MS = 40_000;
// Avisos que NO son de venta solo se «confirman» contra ML (no cambian
// ningún dato, ver confirmarRecursoReal): pasado un día ya no aportan
// nada y solo engordan la cola. Se omiten en bloque al empezar.
const HORAS_AVISO_SIN_VENTA_VIEJO = 24;
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

// Issue "despachos no aparecen solos" (Refs #319) — el webhook corre el
// intento síncrono con un solo intento (nunca el backoff de 429 de
// abajo, pensado para el cron) y nunca más de este tiempo: Mercado
// Libre espera un 200 rápido. Si se pasa, el webhook responde igual —
// el trabajo real sigue corriendo en segundo plano (ver
// intentarProcesarAvisoAhora) y es él quien decide si marca el aviso
// procesado o lo libera para el cron de respaldo.
const TIMEOUT_PROCESO_WEBHOOK_MS = 5_000;

export type ResultadoTrabajador = {
  recibidosPendientes: number;
  procesados: number;
  fallidos: number;
  // Avisos de una empresa suspendida: se marcan procesados sin tocar
  // Mercado Libre (si no, se reintentarían cada minuto para siempre y
  // ocuparían el lote de las demás empresas).
  omitidosSuspendida: number;
  // Avisos de una cuenta que ya no está conectada a la empresa (se
  // desconectó, se borró o pasó a otra empresa): nunca se van a poder
  // procesar, así que se marcan procesados en vez de reintentarse.
  omitidosSinCuenta: number;
  // Avisos que no son de venta con más de HORAS_AVISO_SIN_VENTA_VIEJO h.
  omitidosViejos: number;
  lotes: number;
};

// La cuenta del aviso ya no está conectada a su empresa — fallo permanente.
export class CuentaDelAvisoNoConectadaError extends Error {
  constructor() {
    super("La cuenta de Mercado Libre ya no está conectada a esta empresa.");
    this.name = "CuentaDelAvisoNoConectadaError";
  }
}

// Bug real (25-nov, logs de staging): la cola quedó trabada con 31.110
// avisos atrasados. El lote (TAMAÑO_LOTE, sin orden) tomaba en cada
// vuelta los MISMOS 50 avisos de cuentas ya desconectadas, que fallaban
// siempre y se dejaban pendientes: nunca llegaba a los demás. Estos
// fallos son permanentes: el aviso se marca procesado (omitido) y se
// cuenta aparte. Las ventas quedan cubiertas por la sincronización de
// respaldo cuando la cuenta se vuelva a conectar.
function motivoOmision(error: unknown): "suspendida" | "sin_cuenta" | null {
  if (error instanceof EmpresaSuspendidaError) return "suspendida";
  if (error instanceof CuentaDelAvisoNoConectadaError || error instanceof CuentaDesconectadaError || error instanceof CuentaMlNoEncontradaError) return "sin_cuenta";
  return null;
}

export type ResultadoProcesoInline = "procesado" | "pendiente" | "omitido";

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
export async function procesarAvisosPendientes(esperar: Esperar = esperarDeVerdad, presupuestoMs: number = PRESUPUESTO_LLAMADA_MS): Promise<ResultadoTrabajador> {
  const limite = Date.now() + presupuestoMs;

  // 1) Los avisos viejos que no son de venta se omiten de una vez.
  const viejos = await dbTrabajador
    .update(avisosMl)
    .set({ procesadoTs: new Date() })
    .where(
      and(
        isNull(avisosMl.procesadoTs),
        notInArray(avisosMl.topic, [...TOPICS_VENTA]),
        lt(avisosMl.recibidoTs, new Date(Date.now() - HORAS_AVISO_SIN_VENTA_VIEJO * 3600_000))
      )
    )
    .returning({ id: avisosMl.id });
  const omitidosViejos = viejos.length;

  let recibidosPendientes = 0;
  let procesados = 0;
  let fallidos = 0;
  let omitidosSuspendida = 0;
  let omitidosSinCuenta = 0;
  let lotes = 0;
  // Los que fallan en esta llamada no se vuelven a tomar en el lote siguiente.
  const intentados: string[] = [];

  // 2) Lotes hasta vaciar la cola o agotar el presupuesto de la llamada.
  while (Date.now() < limite) {
    const pendientes = await dbTrabajador
      .select()
      .from(avisosMl)
      .where(intentados.length > 0 ? and(isNull(avisosMl.procesadoTs), notInArray(avisosMl.id, intentados)) : isNull(avisosMl.procesadoTs))
      // Orden aleatorio (25-nov): sin orden, Postgres devolvía siempre las
      // mismas filas y 50 que fallaban tapaban toda la cola. Tampoco sirve
      // «el más viejo primero»: los que fallan por un motivo pasajero (p.
      // ej. 403 de ML, visto en staging) se quedarían siempre al frente.
      // Al azar, ningún grupo que falla puede trabar a los demás. El orden
      // no cambia el resultado: cada aviso le pide a ML el dato actual.
      .orderBy(sql`random()`)
      .limit(TAMAÑO_LOTE);
    if (pendientes.length === 0) break;
    lotes += 1;
    recibidosPendientes += pendientes.length;

    for (let i = 0; i < pendientes.length; i++) {
      if (Date.now() >= limite) break;
      const aviso = pendientes[i];
      intentados.push(aviso.id);
      try {
        try {
          await procesarUnAviso(aviso, esperar);
        } catch (error) {
          const motivo = motivoOmision(error);
          if (!motivo) throw error;
          await dbTrabajador
            .update(avisosMl)
            .set({ procesadoTs: new Date() })
            .where(and(eq(avisosMl.id, aviso.id), isNull(avisosMl.procesadoTs)));
          if (motivo === "suspendida") omitidosSuspendida += 1;
          else omitidosSinCuenta += 1;
          continue;
        }
        await dbTrabajador
          .update(avisosMl)
          .set({ procesadoTs: new Date() })
          .where(and(eq(avisosMl.id, aviso.id), isNull(avisosMl.procesadoTs)));
        procesados += 1;
      } catch (error) {
        // Un aviso que falla (cuenta sin token vigente, orden borrada en
        // ML, error de red) no debe tumbar el lote entero — se deja
        // pendiente (procesado_ts sigue null) para que la próxima llamada
        // del trabajador lo reintente. La sincronización de cada hora
        // (lib/finanzas/traer-ventas-mes.ts) queda como respaldo de
        // todas formas, aunque esto se quedara pendiente para siempre.
        fallidos += 1;
        console.error(`Aviso ${aviso.id} (${aviso.topic}) no se pudo procesar:`, error instanceof Error ? error.message : error);
      }
      if (i < pendientes.length - 1) await esperar(PAUSA_ENTRE_AVISOS_MS);
    }
  }

  if (omitidosViejos > 0) console.warn(`[lib/ml/trabajador] ${omitidosViejos} aviso(s) omitidos: no son de venta y tienen más de ${HORAS_AVISO_SIN_VENTA_VIEJO} h.`);
  if (omitidosSuspendida > 0) console.warn(`[lib/ml/trabajador] ${omitidosSuspendida} aviso(s) omitidos: empresa suspendida.`);
  if (omitidosSinCuenta > 0) console.warn(`[lib/ml/trabajador] ${omitidosSinCuenta} aviso(s) omitidos: la cuenta ya no está conectada.`);
  console.log(`[lib/ml/trabajador] llamada: ${lotes} lote(s), ${procesados} procesados, ${fallidos} con error.`);
  return { recibidosPendientes, procesados, fallidos, omitidosSuspendida, omitidosSinCuenta, omitidosViejos, lotes };
}

async function resolverCuentaYToken(aviso: typeof avisosMl.$inferSelect): Promise<{ cuentaId: string; accessToken: string }> {
  const cuentaId = await dbComoEmpresa(aviso.empresaId, async (tx) => {
    const [cuenta] = await tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, aviso.cuentaIdExterna));
    return cuenta?.id ?? null;
  });
  if (!cuentaId) throw new CuentaDelAvisoNoConectadaError();

  const accessToken = await obtenerAccessTokenVigente(aviso.empresaId, cuentaId);
  return { cuentaId, accessToken };
}

async function procesarUnAviso(aviso: typeof avisosMl.$inferSelect, esperar: Esperar): Promise<void> {
  const { cuentaId, accessToken } = await resolverCuentaYToken(aviso);

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

// Issue "despachos no aparecen solos" (Refs #319) — reclamo atómico:
// el UPDATE solo afecta la fila si procesado_ts todavía es null, en la
// misma instrucción que lo marca. Si el cron ya la reclamó (o ya la
// procesó) entre que el webhook la insertó y la llamó, este UPDATE no
// toca ninguna fila — nunca los dos procesan el mismo aviso.
async function reclamarAviso(avisoId: string): Promise<boolean> {
  const reclamadas = await dbTrabajador
    .update(avisosMl)
    .set({ procesadoTs: new Date() })
    .where(and(eq(avisosMl.id, avisoId), isNull(avisosMl.procesadoTs)))
    .returning({ id: avisosMl.id });
  return reclamadas.length > 0;
}

// Devuelve el aviso a pendiente cuando el trabajo real falla — nunca
// cuando solo se pasa del tope de tiempo (ver intentarProcesarAvisoAhora,
// Refs #319): el cron de respaldo lo vuelve a tomar con su propio
// backoff de 429.
// PR #360 (revisión de menores) — nunca propaga: la llama tanto el catch
// síncrono (línea arriba de esta función en intentarProcesarAvisoAhora)
// como el trabajo.catch() del trabajo huérfano que ya nadie espera. Si el
// UPDATE mismo falla (ej. Postgres caído) y esto no lo atrapara acá, el
// segundo caso quedaría como unhandled rejection suelto — nunca rompe el
// proceso, pero sí hay que dejar el error en el log en vez de perderlo.
async function liberarAviso(avisoId: string): Promise<void> {
  try {
    await dbTrabajador.update(avisosMl).set({ procesadoTs: null }).where(eq(avisosMl.id, avisoId));
  } catch (error) {
    console.error(`No se pudo liberar el aviso ${avisoId} para reintento:`, error instanceof Error ? error.message : error);
  }
}

// Issue "despachos no aparecen solos" (Refs #319) — la mitad síncrona:
// llamada desde el webhook (app/api/ml/webhooks/route.ts) justo después
// de guardar el aviso, para que una venta pagada se vea en Despachos en
// segundos en vez de esperar al cron. Un solo intento (nunca el backoff
// de 429, pensado para el cron) y acotado a TIMEOUT_PROCESO_WEBHOOK_MS —
// si no alcanza, el webhook responde 200 igual, pero el trabajo real
// SIGUE corriendo en segundo plano (nunca se cancela de verdad al
// perder la carrera: sigue vivo en el event loop). Liberar el aviso acá
// (como se hacía antes) era la causa de la carrera que reportó la
// revisión del PR #360: el cron podía reclamarlo y procesarlo una
// segunda vez en paralelo, y si el trabajo huérfano terminaba bien
// DESPUÉS de liberarlo, nadie volvía a marcar procesado_ts — el cron lo
// reprocesaba para siempre. Por eso ahora, al vencer el tope, nunca se
// libera: el aviso se queda "reclamado" (procesado_ts, puesto por
// reclamarAviso) y es el propio trabajo, cuando de verdad termine,
// quien decide — si sale bien no hace falta nada más (procesado_ts ya
// quedó puesto desde el reclamo); si falla, recién ahí se libera para
// que el cron de respaldo lo reintente con su propio backoff de 429.
export async function intentarProcesarAvisoAhora(avisoId: string, timeoutMs: number = TIMEOUT_PROCESO_WEBHOOK_MS): Promise<ResultadoProcesoInline> {
  const [aviso] = await dbTrabajador.select().from(avisosMl).where(eq(avisosMl.id, avisoId));
  if (!aviso || !TOPICS_VENTA.has(aviso.topic)) return "omitido";

  const reclamado = await reclamarAviso(avisoId);
  if (!reclamado) return "omitido";

  const trabajo = resolverCuentaYToken(aviso).then(({ cuentaId, accessToken }) =>
    sincronizarVentaDesdeAviso(aviso.empresaId, cuentaId, accessToken, aviso.topic, aviso.resource, esperarDeVerdad)
  );

  // El Promise executor corre sincrónico, así que timer siempre queda
  // asignado antes de que el resto de la función lo use (TS no lo sabe).
  let timer!: ReturnType<typeof setTimeout>;
  const tiempoAgotado = new Promise<"tiempo_agotado">((resolve) => {
    timer = setTimeout(() => resolve("tiempo_agotado"), timeoutMs);
  });

  let resultado: "listo" | "tiempo_agotado";
  try {
    resultado = await Promise.race([trabajo.then((): "listo" => "listo"), tiempoAgotado]);
  } catch (error) {
    clearTimeout(timer);
    // Empresa suspendida o cuenta ya no conectada: el aviso se queda
    // reclamado (procesado_ts ya puesto por reclamarAviso) y no se reintenta.
    if (motivoOmision(error)) return "omitido";
    // El trabajo falló de verdad ANTES del tope — nunca hace falta
    // esperar el resto del timeout para liberar el aviso.
    await liberarAviso(avisoId);
    console.error(`Aviso ${avisoId} (${aviso.topic}) no se pudo procesar al instante desde el webhook:`, error instanceof Error ? error.message : error);
    return "pendiente";
  }
  clearTimeout(timer);

  if (resultado === "listo") return "procesado";

  // Venció el tope: el aviso sigue "reclamado" (nunca se libera acá).
  // Cuando el trabajo de fondo por fin termine, decide él mismo —
  // nunca queda como unhandled rejection suelto porque este .catch lo
  // cubre.
  trabajo.catch(async (error) => {
    await liberarAviso(avisoId);
    console.error(`Aviso ${avisoId} (${aviso.topic}) no se pudo procesar en segundo plano tras el tope del webhook:`, error instanceof Error ? error.message : error);
  });
  return "pendiente";
}

// Comportamiento de siempre (tarea 2.4) para cualquier tema que no sea
// de venta — "procesar" significa "confirmar que el dato es real y
// accesible", honesto con el alcance de esos temas todavía. pedirLecturaMl
// (lib/ml/cliente.ts) en vez de un fetch suelto a mano — eso sí cambió,
// ver el comentario junto a TOPICS_VENTA.
async function confirmarRecursoReal(resource: string, accessToken: string): Promise<void> {
  const resp = await pedirLecturaMl<unknown>(resource, accessToken);
  // 400 cuenta como 404 (25-nov, logs de staging): avisos de promociones
  // (/seller-promotions/offers|candidates/…) vencidas responden 400 y se
  // reintentaban para siempre. No es de venta: no hay dato que perder.
  if (!resp.ok && resp.status !== 404 && resp.status !== 400) {
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
