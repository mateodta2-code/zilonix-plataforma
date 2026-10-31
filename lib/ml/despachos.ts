import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas, cuentasMl, despachosMl, pedidoEventos, pedidoItems, pedidos, stockBodega } from "@/db/schema";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { obtenerEtiquetaPdfMl, obtenerShipmentMl, obtenerSlaEnvioMl } from "@/lib/ml/cliente";
import { acotarPagina, limitesDiaBogota, parsearPagina, patronBusquedaLike, rangoUltimosNDiasBogota } from "@/lib/filtros-listado";

// Tarea 2.10 — formato de petición y reglas de negocio confirmados
// contra el código real ya en producción del Zilonix OS actual
// (lib/mercadolibre-despachos.js) — no inventado.

// Solo en estos estados Mercado Libre deja imprimir/reimprimir la
// guía. Una vez el transportador recoge el paquete, es un bloqueo
// real y permanente de ML, no algo que se pueda evitar por API.
const ESTADOS_IMPRIMIBLES = ["pending", "handling", "ready_to_ship"];
// El "status" puede quedarse en ready_to_ship un buen rato DESPUÉS de
// que ya lo recogieron — lo que cambia de inmediato es el substatus.
const SUBESTADOS_YA_SALIO = ["picked_up", "dropped_off", "out_for_delivery", "at_the_door"];
// Issue "Despachados" (15 días) — un envío puede llegar a estos dos
// status SIN pasar antes por un substatus de SUBESTADOS_YA_SALIO (ej.
// Full o una venta de acuerdo directo con el comprador) — "ya salió
// de la tienda" también es cierto por status solo, no solo por
// substatus.
const STATUS_YA_SALIO = ["shipped", "delivered"];

function calcularImprimible(status: string | null, substatus: string | null): boolean {
  if (status && !ESTADOS_IMPRIMIBLES.includes(status)) return false;
  if (substatus && SUBESTADOS_YA_SALIO.includes(substatus)) return false;
  return true;
}

// Traducción de los estados reales de /shipments/{id} — portada tal
// cual del Zilonix OS actual (lib/mercadolibre-despachos.js,
// ESTADO_ENVIO_LABELS/SUBESTADO_ENVIO_LABELS), confirmada contra la
// tabla OFICIAL de developers.mercadolibre.com (GET
// /shipment_statuses) — no son nombres adivinados, son los IDs reales
// que manda la API. Solo se traducen los que de verdad importan para
// despachar; un status/substatus nuevo que no esté acá se muestra tal
// cual (con "_" cambiado por espacio), nunca se inventa una traducción.
const ESTADO_ENVIO_LABELS: Record<string, string> = {
  pending: "Pendiente",
  handling: "En preparación",
  ready_to_ship: "Listo para despachar",
  shipped: "En camino",
  delivered: "Entregado",
  not_delivered: "No se pudo entregar",
  not_verified: "Sin verificar",
  cancelled: "Cancelado",
};
const SUBESTADO_ENVIO_LABELS: Record<string, string> = {
  ready_to_print: "listo para imprimir la guía",
  invoice_pending: "falta la factura",
  printed: "guía impresa, todavía no se ha entregado",
  ready_for_dropoff: "lista para dejar en la agencia",
  dropped_off: "ya se entregó en la agencia",
  in_pickup_list: "en lista de recogida",
  ready_for_pickup: "lista para que la recoja el transportador",
  on_route_to_pickup: "el transportador va en camino a recogerla",
  picking_up: "el transportador está recogiendo la carga",
  picked_up: "el transportador/domiciliario ya la recogió",
  authorized_by_carrier: "autorizada por el transportador",
  in_hub: "en centro de distribución de Mercado Libre",
  in_warehouse: "en bodega de Mercado Libre",
  in_transit: "en tránsito por la red de Mercado Libre",
  delayed: "con demora",
  waiting_for_withdrawal: "esperando que la retiren",
  contact_with_carrier_required: "hay que contactar al transportador",
  out_for_delivery: "el domiciliario va en camino al comprador",
  at_the_door: "el domiciliario está en la puerta del comprador",
  soon_deliver: "a punto de entregarse",
  receiver_absent: "el destinatario no estaba",
  refused_delivery: "el comprador rechazó la entrega",
  bad_address: "dirección incorrecta",
  changed_address: "el comprador cambió la dirección",
  delivery_failed: "intento de entrega fallido",
  delivery_blocked: "entrega bloqueada",
  claimed_me: "con reclamo del comprador",
  returning_to_sender: "regresando al remitente",
  returning_to_hub: "regresando al centro de distribución",
  returned_to_hub: "devuelto al centro de distribución",
  returned_to_agency: "devuelto a la agencia",
  returned: "devuelto al remitente",
  destroyed: "destruido",
  lost: "extraviado",
  stolen: "robado",
  damaged: "dañado",
};

export function etiquetaEstadoEnvio(status: string | null, substatus: string | null): string | null {
  if (!status) return null;
  const base = ESTADO_ENVIO_LABELS[status] ?? status.replace(/_/g, " ");
  // No siempre el substatus agrega información útil (a veces repite el
  // status) — solo se muestra si de verdad suma algo.
  const sub = substatus ? SUBESTADO_ENVIO_LABELS[substatus] ?? substatus.replace(/_/g, " ") : null;
  return sub ? `${base} — ${sub}` : base;
}

// Fase 1 de Despachos — issue "Despachos": las dos llamadas a Mercado
// Libre (shipment + su SLA) ahora pasan por lib/ml/cliente.ts
// (obtenerShipmentMl/obtenerSlaEnvioMl), nunca un fetch directo acá —
// regla del repo ("Toda llamada a la API de Mercado Libre pasa por
// lib/ml/cliente.ts"), antes violada en este archivo.
//
// Trae el envío real y guarda/actualiza la fila de despachos_ml — se
// llama al importar un pedido (tarea 2.5) y cuando llega un aviso de
// envío nuevo. El SLA es un dato COMPLEMENTARIO (obtenerSlaEnvioMl ya
// tolera su propia falla devolviendo null): nunca bloquea guardar el
// resto del envío.
export async function sincronizarDespacho(empresaId: string, cuentaId: string, pedidoId: string, shipmentIdExterno: string): Promise<void> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const envio = await obtenerShipmentMl(shipmentIdExterno, accessToken);
  const sla = await obtenerSlaEnvioMl(shipmentIdExterno, accessToken);

  const logisticType = ["self_service", "xd_drop_off", "cross_docking", "fulfillment"].includes(envio.logisticType ?? "")
    ? (envio.logisticType as "self_service" | "xd_drop_off" | "cross_docking" | "fulfillment")
    : "otro";
  const imprimible = logisticType !== "fulfillment" && calcularImprimible(envio.status, envio.substatus);
  const slaExpectedDate = sla.expectedDate ? new Date(sla.expectedDate) : null;

  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(despachosMl)
      .values({
        empresaId,
        pedidoId,
        cuentaMlId: cuentaId,
        shipmentIdExterno,
        logisticType,
        status: envio.status,
        substatus: envio.substatus,
        imprimible,
        slaExpectedDate,
      })
      .onConflictDoUpdate({
        target: [despachosMl.empresaId, despachosMl.shipmentIdExterno],
        set: { status: envio.status, substatus: envio.substatus, logisticType, imprimible, slaExpectedDate, actualizadoTs: new Date() },
      })
  );
}

export async function listarDespachosPendientes(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx.select().from(despachosMl).where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.imprimible, true), isNull(despachosMl.etiquetaImpresaTs)))
  );
}

// Issue "tabla completa de despachos" — count(*) con EXACTAMENTE el
// mismo WHERE que listarDespachosPendientes(), para el KPI del panel
// (lib/panel-kpis.ts): ese solo necesita el número, nunca las filas
// completas. lib/ml/despachos.test.ts prueba que da el mismo resultado
// que listarDespachosPendientes(...).length con los mismos datos.
export async function contarDespachosPendientes(empresaId: string): Promise<number> {
  const [{ total }] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(despachosMl)
      .where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.imprimible, true), isNull(despachosMl.etiquetaImpresaTs)))
  );
  return total;
}

// Issue "tabla completa de despachos" — valores reales de
// despachos_ml.status: son justo los 3 de ESTADOS_IMPRIMIBLES (arriba),
// los únicos que puede tener un despacho que aparece en esta pantalla
// ("pendientes de imprimir") — el filtro de Estado nunca deja elegir
// uno que no podría aparecer.
export const ESTADOS_DESPACHO_FILTRO = [
  { valor: "pending", etiqueta: "Pendiente" },
  { valor: "handling", etiqueta: "En preparación" },
  { valor: "ready_to_ship", etiqueta: "Listo para despachar" },
] as const;

// despachos_ml no tiene una "fecha del despacho" propia (Mercado Libre
// no la manda en el shipment) — actualizado_ts es lo único real que
// hay: el momento en que ESTA fila se sincronizó o actualizó por
// última vez. Se ordena/filtra por eso — documentado acá y en el
// changelog, nunca inventando una columna de fecha que no existe.
export const ORDENES_DESPACHO_FILTRO = ["actualizado_desc", "actualizado_asc"] as const;
export type OrdenDespachos = (typeof ORDENES_DESPACHO_FILTRO)[number];

export type FiltroDespachos = {
  busqueda?: string; // número de envío (shipmentIdExterno) — el único texto libre real en esta tabla
  estado?: string;
  desde?: string; // "YYYY-MM-DD", hora de Colombia
  hasta?: string; // "YYYY-MM-DD", hora de Colombia
  orden?: string;
  // La página llega como string (o el primer valor de un string[]);
  // las pruebas la pasan como número. parsearPagina acepta los dos.
  pagina?: number | string;
};

export type ResultadoDespachos = {
  despachos: (typeof despachosMl.$inferSelect)[];
  total: number;
  pagina: number;
  totalPaginas: number;
};

export const TAMANO_PAGINA_DESPACHOS = 25;

// Issue "tabla completa de despachos" — MISMO alcance de siempre
// (imprimible=true y sin etiqueta impresa, igual que
// listarDespachosPendientes): esta pantalla sigue siendo "qué hay para
// imprimir ahora", nunca "todos los despachos alguna vez
// sincronizados" — el form de impresión masiva de la página depende de
// que acá solo aparezca lo realmente imprimible.
//
// Página, fechas y búsqueda: validados con lib/filtros-listado.ts
// (compartido con lib/ml/pedidos.ts, PR #107) — mismo criterio en los
// dos listados, un solo lugar para corregir si hace falta. ilike() de
// Drizzle ya parametriza el valor (nunca SQL armado a mano);
// patronBusquedaLike() además escapa \, % y _ (el escape por defecto de
// LIKE/ILIKE en Postgres), para que un comodín que venga en el texto
// nunca cambie lo que se busca.
//
// Orden con desempate por id EN LA MISMA DIRECCIÓN que la columna
// principal: sin eso, varias filas con el mismo actualizado_ts podrían
// repartirse distinto entre una página y la siguiente según decida
// Postgres, no según un orden real y estable.
export async function listarDespachosFiltrados(empresaId: string, filtro: FiltroDespachos = {}): Promise<ResultadoDespachos> {
  const condiciones = [eq(despachosMl.empresaId, empresaId), eq(despachosMl.imprimible, true), isNull(despachosMl.etiquetaImpresaTs)];

  const patron = patronBusquedaLike(filtro.busqueda);
  if (patron) {
    condiciones.push(ilike(despachosMl.shipmentIdExterno, patron));
  }
  if (filtro.estado && ESTADOS_DESPACHO_FILTRO.some((e) => e.valor === filtro.estado)) {
    condiciones.push(eq(despachosMl.status, filtro.estado));
  }
  const desde = limitesDiaBogota(filtro.desde);
  if (desde) condiciones.push(gte(despachosMl.actualizadoTs, desde.inicio));
  // hasta es exclusivo: < 00:00 del día siguiente en Bogotá (05:00 UTC),
  // no <= 23:59:59.999 — mismo criterio que lib/ml/pedidos.ts.
  const hasta = limitesDiaBogota(filtro.hasta);
  if (hasta) condiciones.push(lt(despachosMl.actualizadoTs, hasta.finExclusivo));

  const ordenValido: OrdenDespachos =
    filtro.orden && (ORDENES_DESPACHO_FILTRO as readonly string[]).includes(filtro.orden) ? (filtro.orden as OrdenDespachos) : "actualizado_desc";
  const descendente = ordenValido.endsWith("_desc");
  const ordenId = descendente ? desc(despachosMl.id) : asc(despachosMl.id);
  const columnaOrden = descendente ? desc(despachosMl.actualizadoTs) : asc(despachosMl.actualizadoTs);

  const paginaPedida = parsearPagina(filtro.pagina);

  return dbComoEmpresa(empresaId, async (tx) => {
    const condicion = and(...condiciones);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(despachosMl)
      .where(condicion);
    const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA_DESPACHOS));
    // El offset se calcula con la página ya acotada: con paginaPedida a
    // secas, ?pagina=9999 con solo 2 páginas reales devolvería 0 filas y
    // la pantalla diría que no hay despachos.
    const pagina = acotarPagina(paginaPedida, totalPaginas);

    const filas = await tx
      .select()
      .from(despachosMl)
      .where(condicion)
      .orderBy(columnaOrden, ordenId)
      .limit(TAMANO_PAGINA_DESPACHOS)
      .offset((pagina - 1) * TAMANO_PAGINA_DESPACHOS);

    return { despachos: filas, total, pagina, totalPaginas };
  });
}

export class EtiquetaNoImprimibleError extends Error {
  constructor() {
    super("Mercado Libre ya no deja imprimir esta guía porque el transportador ya la recogió — es un bloqueo de Mercado Libre, no hay forma de saltarlo.");
    this.name = "EtiquetaNoImprimibleError";
  }
}

// API real: GET /shipment_labels?shipment_ids=X,Y,Z&response_type=pdf
// — acepta varios shipment_ids de una vez, confirmado en producción:
// esto ES la "impresión masiva" que pide la tarea, no hace falta
// armarla a mano pedido por pedido. Ahora pasa por
// lib/ml/cliente.ts (obtenerEtiquetaPdfMl) — el fetch directo que
// tenía esta función se movió para allá.
export async function obtenerEtiquetasPdf(empresaId: string, cuentaId: string, shipmentIdsExternos: string[]): Promise<ArrayBuffer> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const resp = await obtenerEtiquetaPdfMl(shipmentIdsExternos, accessToken);
  if (!resp.ok) {
    let datos: { failed_shipments?: { cause?: string }[]; cause?: string } | null = null;
    try {
      datos = JSON.parse(resp.textoCrudo);
    } catch {
      /* no era JSON */
    }
    const causa = datos?.failed_shipments?.[0]?.cause ?? datos?.cause;
    if (causa === "NOT_PRINTABLE_STATUS") throw new EtiquetaNoImprimibleError();
    throw new Error(`No se pudo traer la guía (HTTP ${resp.status}): ${resp.textoCrudo.slice(0, 300)}`);
  }
  return resp.data;
}

export async function marcarEtiquetasImpresas(empresaId: string, cuentaId: string, shipmentIdsExternos: string[]): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    for (const shipmentId of shipmentIdsExternos) {
      await tx
        .update(despachosMl)
        .set({ etiquetaImpresaTs: new Date() })
        .where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.shipmentIdExterno, shipmentId), eq(despachosMl.cuentaMlId, cuentaId)));
    }
  });
}

export async function obtenerCuentaIdExterna(empresaId: string, cuentaId: string): Promise<string> {
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) => tx.select({ cuentaIdExterna: cuentasMl.cuentaIdExterna }).from(cuentasMl).where(eq(cuentasMl.id, cuentaId)));
  if (!cuenta) throw new Error("Cuenta de Mercado Libre no encontrada.");
  return cuenta.cuentaIdExterna;
}

// ───────────────────────────────────────────────────────────────────
// Fase 1 de Despachos (issue "Despachos") — tarjetas agrupadas por
// día, plazo, gate de guía vista y marcar/deshacer despachado.
// ───────────────────────────────────────────────────────────────────

export const ETIQUETA_TIPO_DESPACHO: Record<string, string> = {
  self_service: "Flex",
  xd_drop_off: "Agencia",
  cross_docking: "Colecta",
  fulfillment: "Full",
  otro: "Otro",
};

// Full (fulfillment) nunca aparece en Despachos — lo despacha Mercado
// Libre desde su propia bodega, confirmado en producción
// (INVALID_SHIPMENT_FF_PUBLIC si se intenta imprimir su guía). Los
// únicos 3 tipos que de verdad empaca el equipo son estos.
export const TIPOS_DESPACHO_FILTRO = ["self_service", "xd_drop_off", "cross_docking"] as const;
export type TipoDespachoFiltro = (typeof TIPOS_DESPACHO_FILTRO)[number];

export function esFlex(logisticType: string | null): boolean {
  return logisticType === "self_service";
}

// Chip "⏰ Plazo: vie, 04:00 p. m." — hora de Bogotá, nunca la del
// servidor (Railway corre en UTC). Sin plazo (sla_expected_date
// null): la tarjeta no muestra chip, nunca se inventa una hora.
export function formatoPlazoChip(slaExpectedDate: Date | null): string | null {
  if (!slaExpectedDate) return null;
  const texto = slaExpectedDate.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `⏰ Plazo: ${texto}`;
}

export function esPlazoVencido(slaExpectedDate: Date | null, ahora: Date): boolean {
  return slaExpectedDate != null && slaExpectedDate.getTime() < ahora.getTime();
}

const VENTANA_POR_VENCER_MS = 2 * 60 * 60 * 1000;

// 3 estados para el color del chip: "vencido" (rojo, ya pasó),
// "por_vencer" (ámbar, faltan menos de 2 horas — pedido explícito de
// la tarea para que no agarre por sorpresa) y "normal" (plata, el
// resto). null cuando no hay plazo (sin chip que colorear).
export type EstadoPlazo = "vencido" | "por_vencer" | "normal";

export function estadoPlazo(slaExpectedDate: Date | null, ahora: Date): EstadoPlazo | null {
  if (!slaExpectedDate) return null;
  const faltanMs = slaExpectedDate.getTime() - ahora.getTime();
  if (faltanMs < 0) return "vencido";
  if (faltanMs < VENTANA_POR_VENCER_MS) return "por_vencer";
  return "normal";
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function ymdBogota(fecha: Date): string {
  return new Date(fecha.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Mismo algoritmo de diffDias por YMD que ya usa el Zilonix OS actual
// (components/negocio/MercadoLibreDespachos.js: fechaColombiaYMD +
// etiquetaFecha, confirmado contra ese código real) — bug reportado
// por Mateo en staging: la Fase 1 agrupaba por PLAZO
// (sla_expected_date), así que un pedido viejo sin plazo caía en "Sin
// plazo definido" sin importar hace cuánto se vendió. Ahora se agrupa
// por la FECHA DE VENTA (pedidos.fecha), siempre en el pasado — mismo
// criterio que OS, sin el caso "Mañana" (que ahí no existe).
export function etiquetaDiaVenta(fecha: Date, ahora: Date): string {
  const hoyYmd = ymdBogota(ahora);
  const ymd = ymdBogota(fecha);
  const diffDias = Math.round((Date.parse(`${hoyYmd}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000);
  if (diffDias === 0) return "Hoy";
  if (diffDias === 1) return "Ayer";
  if (diffDias === 2) return "Antier";
  const [anio, mes, dia] = ymd.split("-").map(Number);
  const diaSemana = DIAS_SEMANA[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
  return `${diaSemana.charAt(0).toUpperCase()}${diaSemana.slice(1)} ${dia} de ${MESES[mes - 1]}`;
}

export type ItemTarjetaDespacho = {
  itemIdExterno: string;
  titulo: string;
  cantidad: number;
  skuCodigo: string | null;
  imagenUrl: string | null;
  // "Vendido a: $129.000" — precio real de la venta (pedido_items.
  // precio_unitario), no el de la publicación actual (que puede haber
  // cambiado desde entonces). numeric de Postgres llega como string.
  precioUnitario: string;
  // Suma de stock_bodega.disponible en bodegas ACTIVAS para este SKU
  // (WMS de Seller) — null si el ítem no tiene sku_id resuelto (ML no
  // trajo SKU o no existe en la maestra), nunca 0 inventado.
  stockDisponible: number | null;
};

export type TarjetaDespacho = {
  id: string;
  shipmentIdExterno: string;
  logisticType: string | null;
  status: string | null;
  substatus: string | null;
  slaExpectedDate: Date | null;
  guiaVistaTs: Date | null;
  despachadoTs: Date | null;
  // Para la casilla de impresión masiva (se mantiene igual que antes:
  // solo lo realmente imprimible y sin etiqueta impresa entra a esa
  // selección — ver listarDespachosPendientes).
  imprimible: boolean;
  etiquetaImpresaTs: Date | null;
  cuentaMlId: string;
  cuentaNickname: string;
  pedidoIdExterno: string;
  fechaPedido: Date;
  // Última vez que esta fila se sincronizó de verdad (sincronizarDespacho,
  // o el propio refrescarEstadoViejo de más abajo) — define qué tan
  // "vieja" está para el refresco de status/substatus en vivo. No es
  // la fecha de venta (fechaPedido, la de arriba).
  actualizadoTs: Date;
  // Comprador y bodega asignada: ninguna de las dos existe hoy en el
  // esquema (confirmado: no hay nickname de comprador en pedidos/
  // despachos_ml, y la asignación de bodega a un pedido es la fase 3,
  // "Cambiar a mano…" todavía deshabilitado) — nunca se inventa el
  // dato, quedan null hasta que esas tareas aparte las traigan.
  comprador: null;
  bodegaAsignada: null;
  items: ItemTarjetaDespacho[];
  // Solo tiene sentido en la pestaña "despachados" (null en
  // "pendientes") — cuál de las dos cosas reales lo puso ahí: lo
  // marcó una persona en Seller, o Mercado Libre ya confirmó que el
  // transportador lo recogió, sin que nadie lo marcara acá todavía.
  origenDespacho: "marcado_en_seller" | "recogido_transportadora" | null;
  // Issue "fechas equivocadas en Despachados" — fecha real en que
  // Mercado Libre confirmó el despacho (pedido_eventos, paso
  // "despacho", sourced from status_history.date_shipped — ver
  // guardarOrdenMl en lib/ml/ventas-finanzas.ts). null si todavía no
  // existe ese evento (p. ej. una venta que nunca se volvió a
  // sincronizar después de marcarse). Solo lo usa fechaDespachoDe, más
  // abajo — nunca actualizado_ts, que se pisa en cada sincronización.
  fechaEventoDespacho: Date | null;
};

export type PestañaDespachos = "pendientes" | "despachados";

export type FiltroTarjetasDespacho = {
  cuentaId?: string; // undefined = todas las cuentas
  tipo?: string; // self_service/xd_drop_off/cross_docking — cualquier otro valor se ignora
  pestaña?: PestañaDespachos; // default "pendientes"
};

// Issue "Despachados" — Mateo pidió 15 días (antes era solo "hoy").
// Exportada para que la prueba de "una fila de hace 16 días no
// aparece" use el mismo número, nunca un literal aparte que se
// pueda desincronizar del código real.
export const DIAS_VENTANA_DESPACHADOS = 15;

// Bug real encontrado por Mateo en staging: la pantalla mostraba
// pedidos ya ENTREGADOS (delivered, de meses atrás) en "Pendientes",
// con "Sin plazo definido" — porque el único filtro era despachado_ts
// IS NULL (columna nueva, siempre null en filas viejas). Confirmado
// contra el Zilonix OS actual (lib/mercadolibre-despachos.js,
// obtenerDespachosPendientes): ahí la búsqueda real contra Mercado
// Libre es orders/search con shipping.status=ready_to_ship — "qué
// está listo para despachar" es, literalmente, ready_to_ship, nunca
// "lo que no esté marcado despachado en esta base". Se agrega ese
// mismo filtro acá (sobre el status ya sincronizado en despachos_ml)
// para la pestaña "pendientes" — "despachados" (antes "despachados
// hoy") sigue sin filtrar por status: una vez algo deja de estar
// ready_to_ship (lo marcó una persona o ya lo recogió el
// transportador), importa poco qué diga ahora el status en vivo.
const STATUS_PENDIENTES = "ready_to_ship";

// Tarjetas de la Fase 1: a diferencia de listarDespachosPendientes
// (que es "qué queda por IMPRIMIR"), esto es "qué queda por
// DESPACHAR" — el criterio es despachado_ts, no etiqueta_impresa_ts.
// Full nunca entra (ver TIPOS_DESPACHO_FILTRO). Dos consultas (filas +
// sus items) en vez de un JOIN con pedido_items: un despacho puede
// tener varias líneas y un solo JOIN duplicaría toda la fila del
// despacho por cada línea — más simple traerlas aparte y acomodarlas.
//
// Orden en "pendientes": por fecha de VENTA descendente (pedido de
// Mateo, corrige la Fase 1 que ordenaba por plazo). Orden en
// "despachados": por la fecha REAL del despacho (fechaRealDespacho,
// más abajo — despachado_ts si una persona lo marcó, si no el evento
// real de Mercado Libre, si no la fecha de la orden; nunca
// actualizado_ts, que se pisa en cada sincronización), también
// descendente — bug real reportado
// por Mateo: pedidos que la transportadora ya recogió, pero que nadie
// marcó en Seller, desaparecían por completo (ni Pendientes, que ya
// los excluye por status/substatus, ni Despachados, que antes solo
// miraba despachado_ts) — ahora entran a Despachados con su propia
// etiqueta ("Recogido por la transportadora"), ventana de
// DIAS_VENTANA_DESPACHADOS días en vez de solo "hoy".
export async function listarTarjetasDespacho(empresaId: string, filtro: FiltroTarjetasDespacho = {}): Promise<TarjetaDespacho[]> {
  const esDespachados = filtro.pestaña === "despachados";
  const tarjetas = await dbComoEmpresa(empresaId, async (tx) => {
    const condiciones = [eq(despachosMl.empresaId, empresaId), ne(despachosMl.logisticType, "fulfillment"), isNotNull(despachosMl.logisticType)];

    if (filtro.cuentaId) condiciones.push(eq(despachosMl.cuentaMlId, filtro.cuentaId));
    if (filtro.tipo && (TIPOS_DESPACHO_FILTRO as readonly string[]).includes(filtro.tipo)) {
      condiciones.push(eq(despachosMl.logisticType, filtro.tipo as TipoDespachoFiltro));
    }

    // Issue "fechas equivocadas en Despachados" — bug real reportado por
    // Mateo en staging: acá se usaba actualizado_ts (se pisa en CADA
    // sincronización, incluida la periódica) como "fecha real de
    // salida" — por eso un envío ENTREGADO hacía semanas podía aparecer
    // agrupado en "Hoy", y una orden vieja caía en cualquier día según
    // cuándo se refrescó por última vez. La fecha real es: despachado_ts
    // si una persona lo marcó en Seller; si no, la fecha del evento
    // "despacho" en pedido_eventos (status_history.date_shipped,
    // confirmado real — ver guardarOrdenMl en lib/ml/ventas-finanzas.ts,
    // escrito tanto por la importación inicial como por esta misma
    // sincronización periódica); si tampoco existe ese evento todavía,
    // la fecha de la orden. Nunca actualizado_ts.
    const fechaRealDespacho = sql`coalesce(${despachosMl.despachadoTs}, ${pedidoEventos.ts}, ${pedidos.fecha})`;

    if (esDespachados) {
      const { inicio, finExclusivo } = rangoUltimosNDiasBogota(new Date(), DIAS_VENTANA_DESPACHADOS);
      // "!" en los or()/and(): siempre se les pasan 2+ argumentos
      // definidos, drizzle solo contempla undefined para un or()/and()
      // vacío.
      const marcadoEnSeller = and(isNotNull(despachosMl.despachadoTs), gte(despachosMl.despachadoTs, inicio), lt(despachosMl.despachadoTs, finExclusivo))!;
      const yaSalioDeLaTienda = or(inArray(despachosMl.substatus, SUBESTADOS_YA_SALIO), inArray(despachosMl.status, STATUS_YA_SALIO))!;
      // despachado_ts ya es null en este caso (por el isNull de abajo),
      // así que fechaRealDespacho se reduce a coalesce(evento, fecha
      // de la orden) — el mismo criterio de 3 niveles de más arriba.
      // .toISOString(): a diferencia de gte()/lt() (que conocen el tipo
      // de la columna y serializan el Date solas), un parámetro suelto
      // dentro de un sql`` crudo se lo pasa tal cual al driver — postgres.js
      // no acepta un Date ahí (bug real encontrado en CI: "Received an
      // instance of Date"). Postgres igual lo castea bien a timestamptz
      // por el contexto (se compara contra fechaRealDespacho, timestamptz).
      const recogidoSinMarcar = and(
        isNull(despachosMl.despachadoTs),
        yaSalioDeLaTienda,
        sql`${fechaRealDespacho} >= ${inicio.toISOString()} and ${fechaRealDespacho} < ${finExclusivo.toISOString()}`
      )!;
      condiciones.push(or(marcadoEnSeller, recogidoSinMarcar)!);
    } else {
      // Bug real reportado por Mateo en staging: pedidos ya recogidos
      // por el transportador (substatus picked_up/dropped_off/...)
      // seguían en Pendientes porque el status guardado todavía decía
      // ready_to_ship — confirmado contra Zilonix OS actual
      // (yaSalioDeLaTienda, lib/mercadolibre-despachos.js): el
      // substatus es lo que cambia primero, antes que el status.
      // SUBESTADOS_YA_SALIO atrapa eso cuando la fila YA tiene el
      // substatus correcto guardado; refrescarEstadoViejo (más abajo)
      // cubre el caso en que ni siquiera eso es cierto todavía.
      condiciones.push(
        isNull(despachosMl.despachadoTs),
        eq(despachosMl.status, STATUS_PENDIENTES),
        or(isNull(despachosMl.substatus), notInArray(despachosMl.substatus, SUBESTADOS_YA_SALIO))!
      );
    }

    const filas = await tx
      .select({
        id: despachosMl.id,
        shipmentIdExterno: despachosMl.shipmentIdExterno,
        logisticType: despachosMl.logisticType,
        status: despachosMl.status,
        substatus: despachosMl.substatus,
        slaExpectedDate: despachosMl.slaExpectedDate,
        guiaVistaTs: despachosMl.guiaVistaTs,
        despachadoTs: despachosMl.despachadoTs,
        imprimible: despachosMl.imprimible,
        etiquetaImpresaTs: despachosMl.etiquetaImpresaTs,
        cuentaMlId: despachosMl.cuentaMlId,
        cuentaNickname: cuentasMl.nickname,
        pedidoId: despachosMl.pedidoId,
        pedidoIdExterno: pedidos.pedidoIdExterno,
        fechaPedido: pedidos.fecha,
        actualizadoTs: despachosMl.actualizadoTs,
        fechaEventoDespacho: pedidoEventos.ts,
      })
      .from(despachosMl)
      .innerJoin(pedidos, eq(despachosMl.pedidoId, pedidos.id))
      .innerJoin(cuentasMl, eq(despachosMl.cuentaMlId, cuentasMl.id))
      // Revisión de Pablo (PR #310, mismo criterio aplicado acá): el
      // join nunca depende solo de la FK — empresa_id explícito también
      // en la condición, aunque pedido_eventos_pedido_paso_unico ya
      // garantiza a lo sumo una fila por (pedido, paso).
      .leftJoin(pedidoEventos, and(eq(pedidoEventos.pedidoId, despachosMl.pedidoId), eq(pedidoEventos.paso, "despacho"), eq(pedidoEventos.empresaId, empresaId)))
      .where(and(...condiciones))
      .orderBy(esDespachados ? desc(fechaRealDespacho) : desc(pedidos.fecha), desc(despachosMl.id));

    if (filas.length === 0) return [];

    const pedidoIds = [...new Set(filas.map((f) => f.pedidoId))];
    const items = await tx
      .select({
        pedidoId: pedidoItems.pedidoId,
        itemIdExterno: pedidoItems.itemIdExterno,
        titulo: pedidoItems.titulo,
        cantidad: pedidoItems.cantidad,
        skuCodigo: pedidoItems.skuCodigo,
        skuId: pedidoItems.skuId,
        imagenUrl: pedidoItems.imagenUrl,
        precioUnitario: pedidoItems.precioUnitario,
      })
      .from(pedidoItems)
      .where(and(eq(pedidoItems.empresaId, empresaId), inArray(pedidoItems.pedidoId, pedidoIds)));

    // Stock real (WMS de Seller, issue #280) — sumado solo entre
    // bodegas ACTIVAS: una bodega desactivada no debe seguir
    // "aportando" unidades a lo que ve quien empaca.
    const skuIds = [...new Set(items.map((i) => i.skuId).filter((id): id is string => id != null))];
    const stockPorSku = new Map<string, number>();
    if (skuIds.length > 0) {
      const filasStock = await tx
        .select({ skuId: stockBodega.skuId, total: sql<number>`sum(${stockBodega.disponible})`.mapWith(Number) })
        .from(stockBodega)
        // Revisión de Pablo — bodegas.empresa_id explícito en el join
        // (no solo stock_bodega.empresa_id en el WHERE): aunque la FK
        // compuesta stock_bodega_bodega_misma_empresa_fk ya garantiza
        // que las dos empresa_id coinciden, el join mismo nunca debe
        // depender de esa garantía implícita para quedar correcto —
        // mismo criterio de "nunca confiar en una sola capa" del resto
        // del repo.
        .innerJoin(bodegas, and(eq(stockBodega.bodegaId, bodegas.id), eq(bodegas.empresaId, empresaId)))
        .where(and(eq(stockBodega.empresaId, empresaId), eq(bodegas.activa, true), inArray(stockBodega.skuId, skuIds)))
        .groupBy(stockBodega.skuId);
      for (const f of filasStock) stockPorSku.set(f.skuId, f.total);
    }

    const itemsPorPedido = new Map<string, ItemTarjetaDespacho[]>();
    for (const item of items) {
      const lista = itemsPorPedido.get(item.pedidoId) ?? [];
      lista.push({
        itemIdExterno: item.itemIdExterno,
        titulo: item.titulo,
        cantidad: item.cantidad,
        skuCodigo: item.skuCodigo,
        imagenUrl: item.imagenUrl,
        precioUnitario: item.precioUnitario,
        stockDisponible: item.skuId ? stockPorSku.get(item.skuId) ?? 0 : null,
      });
      itemsPorPedido.set(item.pedidoId, lista);
    }

    return filas.map((f) => ({
      id: f.id,
      shipmentIdExterno: f.shipmentIdExterno,
      logisticType: f.logisticType,
      status: f.status,
      substatus: f.substatus,
      slaExpectedDate: f.slaExpectedDate,
      guiaVistaTs: f.guiaVistaTs,
      despachadoTs: f.despachadoTs,
      imprimible: f.imprimible,
      etiquetaImpresaTs: f.etiquetaImpresaTs,
      cuentaMlId: f.cuentaMlId,
      cuentaNickname: f.cuentaNickname,
      pedidoIdExterno: f.pedidoIdExterno,
      fechaPedido: f.fechaPedido,
      actualizadoTs: f.actualizadoTs,
      fechaEventoDespacho: f.fechaEventoDespacho,
      comprador: null,
      bodegaAsignada: null,
      items: itemsPorPedido.get(f.pedidoId) ?? [],
      origenDespacho: (esDespachados ? (f.despachadoTs != null ? "marcado_en_seller" : "recogido_transportadora") : null) as TarjetaDespacho["origenDespacho"],
    }));
  });

  // El refresco de estado corre ANTES del backfill de plazo: si un
  // despacho resulta que ya salió de la tienda, no tiene sentido
  // gastar una llamada de SLA en algo que está a punto de salir de la
  // lista.
  const vigentes = await refrescarEstadoViejo(empresaId, tarjetas);
  await backfillSlaFaltante(empresaId, vigentes);

  return vigentes;
}

// Revisión de Pablo (PR #310) — 3 correcciones reales al backfill de
// arriba:
// 1) Sin tope, una carga con muchos "ready_to_ship" sin plazo podía
//    disparar decenas de llamadas simultáneas a Mercado Libre. Ahora:
//    máximo MAX_BACKFILL_SLA_POR_CARGA por carga (el resto se intenta
//    en la siguiente), con a lo sumo CONCURRENCIA_BACKFILL_SLA en
//    vuelo a la vez.
// 2) Sin registrar el intento, una cuenta con error (o un envío sin
//    SLA real) se reintentaba en CADA carga de la pantalla — ida y
//    vuelta a Mercado Libre por nada. ultimoIntentoSla frena eso por
//    COOLDOWN_INTENTO_SLA_MS. Es un Map en memoria del PROCESO, nunca
//    persistido: ninguna columna existente de despachos_ml puede
//    cargar "último intento de SLA" sin pisar el significado real de
//    otra feature (guia_vista_ts/despachado_ts son el gate de Marcar
//    despachado; etiqueta_impresa_ts es de impresión; actualizado_ts
//    correría el filtro de fecha de la impresión masiva sin que nada
//    real haya cambiado) — agregar una columna solo para esto es una
//    migración nueva, decisión de Mateo, no de esta revisión. Se
//    reinicia con cada redeploy: en ese lapso se reintenta una vez
//    más de lo ideal, nunca rompe nada.
const MAX_BACKFILL_SLA_POR_CARGA = 20;
const CONCURRENCIA_BACKFILL_SLA = 4;
const COOLDOWN_INTENTO_SLA_MS = 30 * 60 * 1000;
const ultimoIntentoSla = new Map<string, number>();

function puedeIntentarSla(despachoId: string, ahoraMs: number): boolean {
  const ultimo = ultimoIntentoSla.get(despachoId);
  return ultimo === undefined || ahoraMs - ultimo >= COOLDOWN_INTENTO_SLA_MS;
}

// Pool de trabajadores con tope de concurrencia — sin librería nueva:
// cada "trabajador" toma el siguiente ítem disponible hasta que se
// acaben, nunca más de `limite` promesas en vuelo a la vez.
async function conLimiteDeConcurrencia<T>(items: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let indice = 0;
  async function trabajador(): Promise<void> {
    while (indice < items.length) {
      const miIndice = indice++;
      await fn(items[miIndice]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, () => trabajador()));
}

// Bug real reportado por Mateo en staging: pedidos del 22/23 de
// octubre con status ready_to_ship y substatus "picked_up" (ya
// recogidos por el transportador/domiciliario) seguían en Pendientes
// — sincronizarDespacho corre UNA SOLA VEZ al importar el pedido,
// nunca de nuevo, así que un despacho viejo puede tener guardado un
// status/substatus que ya no es real. El filtro de SUBESTADOS_YA_SALIO
// en la consulta (arriba) atrapa el caso en que la fila YA tiene el
// substatus correcto guardado; esto cubre el caso en que ni siquiera
// eso es cierto todavía — se refresca contra Mercado Libre (mismo
// tope/concurrencia/freno de 30 min que backfillSlaFaltante, Map en
// memoria del proceso aparte, mismo motivo de por qué no se persiste)
// y, si el envío real ya no está ready_to_ship o su substatus real es
// "ya salió" (yaSalioDeLaTienda, mismo criterio que Zilonix OS
// actual), sale de la lista en esta misma carga.
const MAX_REFRESCO_ESTADO_POR_CARGA = 20;
const CONCURRENCIA_REFRESCO_ESTADO = 4;
const COOLDOWN_REFRESCO_ESTADO_MS = 30 * 60 * 1000;
// "Viejas" (pedido literal de la tarea) — un despacho recién
// sincronizado (ej. al importar el pedido, hace segundos) no
// necesita un chequeo en vivo todavía; solo lo que lleva más de 1h
// sin confirmarse es candidato. Esto también evita revisar en vivo
// algo que ni siquiera tuvo tiempo de cambiar de estado real.
const UMBRAL_VIEJO_MS = 60 * 60 * 1000;
const ultimoIntentoRefrescoEstado = new Map<string, number>();

function puedeRefrescarEstado(despachoId: string, ahoraMs: number): boolean {
  const ultimo = ultimoIntentoRefrescoEstado.get(despachoId);
  return ultimo === undefined || ahoraMs - ultimo >= COOLDOWN_REFRESCO_ESTADO_MS;
}

async function refrescarEstadoViejo(empresaId: string, tarjetas: TarjetaDespacho[]): Promise<TarjetaDespacho[]> {
  const ahoraMs = Date.now();
  const candidatos = tarjetas
    .filter(
      (t) =>
        // Bug real encontrado al revisar la tarea "Despachados (15
        // días)": esta función solo miraba el status, nunca
        // despachado_ts — una fila que una persona YA marcó
        // despachada, pero cuyo status seguía ready_to_ship (todavía
        // sin refrescar), podía terminar excluida de la pestaña
        // Despachados si Mercado Libre confirmaba que ya salió — el
        // mismo evento que la persona ya había registrado a mano.
        // despachado_ts, puesto por una persona, nunca se pisa con lo
        // que diga el refresco en vivo.
        t.despachadoTs === null &&
        t.status === STATUS_PENDIENTES &&
        ahoraMs - t.actualizadoTs.getTime() >= UMBRAL_VIEJO_MS &&
        puedeRefrescarEstado(t.id, ahoraMs)
    )
    .slice(0, MAX_REFRESCO_ESTADO_POR_CARGA);

  if (candidatos.length === 0) return tarjetas;
  const idsExcluir = new Set<string>();

  await conLimiteDeConcurrencia(candidatos, CONCURRENCIA_REFRESCO_ESTADO, async (t) => {
    // Mismo criterio que backfillSlaFaltante: se registra el intento
    // ANTES de llamar, así una cuenta con error también frena el
    // reintento por 30 minutos.
    ultimoIntentoRefrescoEstado.set(t.id, Date.now());
    try {
      const token = await obtenerAccessTokenVigente(empresaId, t.cuentaMlId);
      const envio = await obtenerShipmentMl(t.shipmentIdExterno, token);
      if (envio.status === t.status && envio.substatus === t.substatus) return; // sin cambios reales

      const yaSalio = (envio.status != null && !ESTADOS_IMPRIMIBLES.includes(envio.status)) || (envio.substatus != null && SUBESTADOS_YA_SALIO.includes(envio.substatus));
      await dbComoEmpresa(empresaId, (tx) =>
        tx
          .update(despachosMl)
          .set({ status: envio.status, substatus: envio.substatus, imprimible: !yaSalio, actualizadoTs: new Date() })
          .where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.id, t.id)))
      );
      t.status = envio.status;
      t.substatus = envio.substatus;
      if (envio.status !== STATUS_PENDIENTES || yaSalio) idsExcluir.add(t.id);
    } catch {
      // Cuenta desconectada, candado de renovación, o la consulta
      // falló — se queda como estaba, no bloquea el resto de la lista.
    }
  });

  return idsExcluir.size === 0 ? tarjetas : tarjetas.filter((t) => !idsExcluir.has(t.id));
}

// FUERA de la transacción de listarTarjetasDespacho a propósito:
// llamar a Mercado Libre desde adentro de un dbComoEmpresa dejaría la
// conexión de Postgres abierta mientras se espera la red. Solo aplica
// a lo que está "listo para despachar" y todavía no tiene el plazo
// guardado. Una cuenta con error (token vencido) no frena a las
// demás — ya sale en el aviso de arriba (listarCuentasConErrorDespacho).
async function backfillSlaFaltante(empresaId: string, tarjetas: TarjetaDespacho[]): Promise<void> {
  const ahoraMs = Date.now();
  const candidatos = tarjetas
    // despachado_ts === null: issue "Despachados (15 días)" — una fila
    // que una persona ya marcó despachada no necesita (ni debe)
    // seguir gastando una llamada de SLA; mismo criterio que el fix de
    // refrescarEstadoViejo, más abajo.
    .filter((t) => t.despachadoTs === null && t.status === STATUS_PENDIENTES && t.slaExpectedDate === null && puedeIntentarSla(t.id, ahoraMs))
    .slice(0, MAX_BACKFILL_SLA_POR_CARGA);

  await conLimiteDeConcurrencia(candidatos, CONCURRENCIA_BACKFILL_SLA, async (t) => {
    // Se registra el intento ANTES de llamar — así una respuesta sin
    // expected_date, un error, o una cuenta desconectada igual frenan
    // el reintento por 30 minutos (el punto real de esta revisión).
    ultimoIntentoSla.set(t.id, Date.now());
    try {
      const token = await obtenerAccessTokenVigente(empresaId, t.cuentaMlId);
      const sla = await obtenerSlaEnvioMl(t.shipmentIdExterno, token);
      if (!sla.expectedDate) return;
      const fecha = new Date(sla.expectedDate);
      await dbComoEmpresa(empresaId, (tx) =>
        tx.update(despachosMl).set({ slaExpectedDate: fecha }).where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.id, t.id)))
      );
      t.slaExpectedDate = fecha;
    } catch {
      // Cuenta desconectada, candado de renovación, o el SLA no vino
      // — no bloquea el resto de la lista.
    }
  });
}

export type GrupoTarjetasDespacho = { etiqueta: string; despachos: TarjetaDespacho[] };

// listarTarjetasDespacho ya ordena por fecha de venta descendente — se
// agrupa por día (etiquetaDiaVenta) conservando ese mismo orden: el
// grupo de "Hoy" primero, el más viejo al final, y dentro de cada
// grupo lo más nuevo arriba (igual que pidió Mateo, punto 3).
// obtenerFecha: por cuál fecha agrupar/ordenar — por defecto la de
// venta (fechaPedido, Pendientes). Issue "Despachados" (15 días): esa
// pestaña agrupa por la fecha REAL del despacho (fechaDespachoDe,
// abajo), no por cuándo se vendió — un pedido vendido hace 10 días
// pero despachado hoy tiene que caer en "Hoy", no en el grupo de
// hace 10 días.
export function agruparDespachosPorDia(
  despachos: TarjetaDespacho[],
  ahora: Date,
  obtenerFecha: (d: TarjetaDespacho) => Date = (d) => d.fechaPedido
): GrupoTarjetasDespacho[] {
  const porEtiqueta = new Map<string, TarjetaDespacho[]>();
  for (const despacho of despachos) {
    const etiqueta = etiquetaDiaVenta(obtenerFecha(despacho), ahora);
    const lista = porEtiqueta.get(etiqueta) ?? [];
    lista.push(despacho);
    porEtiqueta.set(etiqueta, lista);
  }

  // Los despachos ya llegan ordenados por esa misma fecha
  // descendente (la consulta de listarTarjetasDespacho, según la
  // pestaña) — el primer elemento de cada grupo es el más nuevo de
  // ese día, así que ordenar los grupos por esa misma fecha alcanza
  // para que el grupo más reciente quede primero, sin recalcular nada.
  const etiquetas = [...porEtiqueta.keys()].sort((a, b) => {
    const fechaA = obtenerFecha(porEtiqueta.get(a)![0]).getTime();
    const fechaB = obtenerFecha(porEtiqueta.get(b)![0]).getTime();
    return fechaB - fechaA;
  });

  return etiquetas.map((etiqueta) => ({
    etiqueta: etiqueta === "Hoy" ? `Hoy (${porEtiqueta.get(etiqueta)!.length})` : etiqueta,
    despachos: porEtiqueta.get(etiqueta)!,
  }));
}

// Fecha real del despacho — la que marcó la persona si lo marcó en
// Seller; si no, la fecha en que Mercado Libre confirmó que salió
// (pedido_eventos, paso "despacho" — status_history.date_shipped real,
// ver guardarOrdenMl en lib/ml/ventas-finanzas.ts); si ninguna de las
// dos existe todavía, la fecha de la orden. Nunca actualizado_ts (bug
// real reportado por Mateo: esa columna se pisa en cada sincronización
// y no tiene ninguna relación con cuándo salió de verdad el pedido —
// por eso un entregado de hace semanas podía aparecer agrupado en
// "Hoy"). Mismo criterio de 3 niveles que usa la consulta SQL de
// listarTarjetasDespacho — ver fechaRealDespacho ahí.
export function fechaDespachoDe(d: TarjetaDespacho): Date {
  return d.despachadoTs ?? d.fechaEventoDespacho ?? d.fechaPedido;
}

// Gate "Abre la guía arriba primero" — Marcar despachado nunca llama a
// Mercado Libre (el task lo pide explícito), pero sí exige que la guía
// ya se haya abierto en ESTA sesión de trabajo, para que no se marque
// un despacho como listo sin haber ni visto la etiqueta.
export class GuiaNoVistaError extends Error {
  constructor() {
    super("Abre la guía arriba primero.");
    this.name = "GuiaNoVistaError";
  }
}

export class DespachoNoEncontradoError extends Error {
  constructor() {
    super("Despacho no encontrado.");
    this.name = "DespachoNoEncontradoError";
  }
}

export function puedeMarcarDespachado(guiaVistaTs: Date | null): boolean {
  return guiaVistaTs != null;
}

// coalesce: la PRIMERA vez que se abre la guía es la que cuenta — abrir
// de nuevo una guía ya vista (ej. para reimprimir el sticker) nunca
// debe correr guia_vista_ts hacia adelante.
export async function marcarGuiaVista(empresaId: string, despachoId: string): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(despachosMl)
      .set({ guiaVistaTs: sql`coalesce(${despachosMl.guiaVistaTs}, now())` })
      .where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.id, despachoId)))
  );
}

export async function marcarDespachado(empresaId: string, despachoId: string, usuarioId: string): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx.select({ guiaVistaTs: despachosMl.guiaVistaTs }).from(despachosMl).where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.id, despachoId)));
    if (!fila) throw new DespachoNoEncontradoError();
    if (!puedeMarcarDespachado(fila.guiaVistaTs)) throw new GuiaNoVistaError();
    await tx
      .update(despachosMl)
      .set({ despachadoTs: new Date(), despachadoPor: usuarioId })
      .where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.id, despachoId)));
  });
}

export const VENTANA_DESHACER_MS = 10 * 60 * 1000;

export class VentanaDeshacerVencidaError extends Error {
  constructor() {
    super("Ya pasaron más de 10 minutos desde que se marcó — no se puede deshacer.");
    this.name = "VentanaDeshacerVencidaError";
  }
}

export async function deshacerDespachado(empresaId: string, despachoId: string): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx.select({ despachadoTs: despachosMl.despachadoTs }).from(despachosMl).where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.id, despachoId)));
    if (!fila) throw new DespachoNoEncontradoError();
    if (!fila.despachadoTs) return; // ya no estaba marcado — no-op, nunca un error
    if (Date.now() - fila.despachadoTs.getTime() > VENTANA_DESHACER_MS) throw new VentanaDeshacerVencidaError();
    await tx
      .update(despachosMl)
      .set({ despachadoTs: null, despachadoPor: null })
      .where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.id, despachoId)));
  });
}

export type DespachoParaGuia = { cuentaMlId: string; shipmentIdExterno: string; logisticType: string | null };

// Resuelve lo mínimo que necesita /api/ml/despachos/etiqueta (singular,
// botones "Ver guía"/"Ver guía (sticker)" de una sola tarjeta) a partir
// del id interno — nunca recibe el shipmentId ni la cuenta desde la
// URL/el cliente, para que no se pueda pedir la guía de un despacho de
// otra empresa con solo adivinar un shipmentId.
export async function obtenerDespachoParaGuia(empresaId: string, despachoId: string): Promise<DespachoParaGuia | null> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ cuentaMlId: despachosMl.cuentaMlId, shipmentIdExterno: despachosMl.shipmentIdExterno, logisticType: despachosMl.logisticType })
      .from(despachosMl)
      .where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.id, despachoId)))
  );
  return fila ?? null;
}

export type CuentaConErrorDespacho = { cuentaId: string; nickname: string; motivo: string };

// Aviso "cuentas que no se pudieron revisar" (punto 6, como en OS):
// desde la Fase 1-1 (rama mateo/feat-despachos-fase1-1), listar
// tarjetas SÍ puede llamar a Mercado Libre (el backfill del plazo,
// arriba) — pero esta función sigue siendo puramente local: una
// cuenta desconectada (confirmado por desconectada_ts, nunca un dato
// en vivo) ya es, por sí sola, el motivo más persistente y accionable
// ("hay que reconectarla") — un fallo transitorio de un backfill
// puntual no amerita bajarle el ánimo al aviso de arriba con ruido.
export async function listarCuentasConErrorDespacho(empresaId: string): Promise<CuentaConErrorDespacho[]> {
  const cuentas = await listarCuentasConectadas(empresaId);
  return cuentas
    .filter((c) => c.desconectadaTs != null)
    .map((c) => ({ cuentaId: c.id, nickname: c.nickname, motivo: "Token vencido — hay que reconectar la cuenta." }));
}
