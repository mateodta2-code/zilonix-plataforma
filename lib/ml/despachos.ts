import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl, pedidoItems, pedidos } from "@/db/schema";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { obtenerEtiquetaPdfMl, obtenerShipmentMl, obtenerSlaEnvioMl } from "@/lib/ml/cliente";
import { acotarPagina, limitesDiaBogota, parsearPagina, patronBusquedaLike, rangoDiaBogota } from "@/lib/filtros-listado";

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

function calcularImprimible(status: string | null, substatus: string | null): boolean {
  if (status && !ESTADOS_IMPRIMIBLES.includes(status)) return false;
  if (substatus && SUBESTADOS_YA_SALIO.includes(substatus)) return false;
  return true;
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

// Chip "Plazo: vie, 04:00 p. m." — hora de Bogotá, nunca la del
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
  return `Plazo: ${texto}`;
}

export function esPlazoVencido(slaExpectedDate: Date | null, ahora: Date): boolean {
  return slaExpectedDate != null && slaExpectedDate.getTime() < ahora.getTime();
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function ymdBogota(fecha: Date): string {
  return new Date(fecha.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Mismo algoritmo de diffDias por YMD que ya usa el Zilonix OS actual
// (components/negocio/MercadoLibreDespachos.js: fechaColombiaYMD +
// etiquetaFecha, confirmado contra ese código real) — extendido para
// días FUTUROS porque acá se agrupa por el PLAZO (sla_expected_date),
// que puede caer mañana o más adelante, no solo hoy/ayer/antier como
// en OS (que agrupa por la fecha del pedido, ya pasada). Un plazo ya
// vencido (diffDias negativo) va todo a un solo grupo "Vencidos": lo
// que importa ahí no es CUÁNTO atrasado, sino despacharlo ya — cada
// tarjeta ya muestra su propio chip rojo con el detalle.
export function etiquetaDiaPlazo(slaExpectedDate: Date | null, ahora: Date): string {
  if (!slaExpectedDate) return "Sin plazo definido";
  const hoyYmd = ymdBogota(ahora);
  const ymd = ymdBogota(slaExpectedDate);
  const diffDias = Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${hoyYmd}T00:00:00Z`)) / 86_400_000);
  if (diffDias < 0) return "Vencidos";
  if (diffDias === 0) return "Hoy";
  if (diffDias === 1) return "Mañana";
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
  // "Vendido a" (comprador): despachos_ml/pedidos no guardan ningún
  // nickname de comprador hoy (confirmado: no existe esa columna en
  // db/schema.ts) — nunca se inventa el dato, queda null hasta que
  // una tarea aparte lo traiga y lo guarde de verdad.
  comprador: null;
  items: ItemTarjetaDespacho[];
};

export type PestañaDespachos = "pendientes" | "despachados_hoy";

export type FiltroTarjetasDespacho = {
  cuentaId?: string; // undefined = todas las cuentas
  tipo?: string; // self_service/xd_drop_off/cross_docking — cualquier otro valor se ignora
  pestaña?: PestañaDespachos; // default "pendientes"
};

// Tarjetas de la Fase 1: a diferencia de listarDespachosPendientes
// (que es "qué queda por IMPRIMIR"), esto es "qué queda por
// DESPACHAR" — el criterio es despachado_ts, no etiqueta_impresa_ts.
// Full nunca entra (ver TIPOS_DESPACHO_FILTRO). Dos consultas (filas +
// sus items) en vez de un JOIN con pedido_items: un despacho puede
// tener varias líneas y un solo JOIN duplicaría toda la fila del
// despacho por cada línea — más simple traerlas aparte y acomodarlas.
export async function listarTarjetasDespacho(empresaId: string, filtro: FiltroTarjetasDespacho = {}): Promise<TarjetaDespacho[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const condiciones = [eq(despachosMl.empresaId, empresaId), ne(despachosMl.logisticType, "fulfillment"), isNotNull(despachosMl.logisticType)];

    if (filtro.cuentaId) condiciones.push(eq(despachosMl.cuentaMlId, filtro.cuentaId));
    if (filtro.tipo && (TIPOS_DESPACHO_FILTRO as readonly string[]).includes(filtro.tipo)) {
      condiciones.push(eq(despachosMl.logisticType, filtro.tipo as TipoDespachoFiltro));
    }

    if (filtro.pestaña === "despachados_hoy") {
      const { inicio, finExclusivo } = rangoDiaBogota(new Date());
      condiciones.push(isNotNull(despachosMl.despachadoTs), gte(despachosMl.despachadoTs, inicio), lt(despachosMl.despachadoTs, finExclusivo));
    } else {
      condiciones.push(isNull(despachosMl.despachadoTs));
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
      })
      .from(despachosMl)
      .innerJoin(pedidos, eq(despachosMl.pedidoId, pedidos.id))
      .innerJoin(cuentasMl, eq(despachosMl.cuentaMlId, cuentasMl.id))
      .where(and(...condiciones))
      .orderBy(asc(despachosMl.slaExpectedDate), desc(despachosMl.actualizadoTs));

    if (filas.length === 0) return [];

    const pedidoIds = [...new Set(filas.map((f) => f.pedidoId))];
    const items = await tx
      .select({
        pedidoId: pedidoItems.pedidoId,
        itemIdExterno: pedidoItems.itemIdExterno,
        titulo: pedidoItems.titulo,
        cantidad: pedidoItems.cantidad,
        skuCodigo: pedidoItems.skuCodigo,
        imagenUrl: pedidoItems.imagenUrl,
      })
      .from(pedidoItems)
      .where(and(eq(pedidoItems.empresaId, empresaId), inArray(pedidoItems.pedidoId, pedidoIds)));

    const itemsPorPedido = new Map<string, ItemTarjetaDespacho[]>();
    for (const item of items) {
      const lista = itemsPorPedido.get(item.pedidoId) ?? [];
      lista.push({ itemIdExterno: item.itemIdExterno, titulo: item.titulo, cantidad: item.cantidad, skuCodigo: item.skuCodigo, imagenUrl: item.imagenUrl });
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
      comprador: null,
      items: itemsPorPedido.get(f.pedidoId) ?? [],
    }));
  });
}

export type GrupoTarjetasDespacho = { etiqueta: string; despachos: TarjetaDespacho[] };

const ORDEN_GRUPOS_ESPECIALES = ["Vencidos", "Hoy", "Mañana"];

// listarTarjetasDespacho ya ordena por slaExpectedDate ascendente —
// agruparDespachosPorDia solo junta lo que ya viene en ese orden, el
// primer elemento de cada grupo de días futuros alcanza para ordenar
// los grupos entre sí.
export function agruparDespachosPorDia(despachos: TarjetaDespacho[], ahora: Date): GrupoTarjetasDespacho[] {
  const porEtiqueta = new Map<string, TarjetaDespacho[]>();
  for (const despacho of despachos) {
    const etiqueta = etiquetaDiaPlazo(despacho.slaExpectedDate, ahora);
    const lista = porEtiqueta.get(etiqueta) ?? [];
    lista.push(despacho);
    porEtiqueta.set(etiqueta, lista);
  }

  const etiquetas = [...porEtiqueta.keys()].sort((a, b) => {
    if (a === "Sin plazo definido") return 1;
    if (b === "Sin plazo definido") return -1;
    const ia = ORDEN_GRUPOS_ESPECIALES.indexOf(a);
    const ib = ORDEN_GRUPOS_ESPECIALES.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    const fechaA = porEtiqueta.get(a)![0].slaExpectedDate!.getTime();
    const fechaB = porEtiqueta.get(b)![0].slaExpectedDate!.getTime();
    return fechaA - fechaB;
  });

  return etiquetas.map((etiqueta) => ({
    etiqueta: etiqueta === "Hoy" ? `Hoy (${porEtiqueta.get(etiqueta)!.length})` : etiqueta,
    despachos: porEtiqueta.get(etiqueta)!,
  }));
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
// Despachos en esta plataforma nunca llama a Mercado Libre al cargar
// la pantalla (los datos ya están sincronizados en despachos_ml,
// punto 1) — así que el único error real y persistente que esta
// pantalla puede detectar sin hacer una llamada nueva es una cuenta ya
// desconectada (token vencido, confirmado por desconectada_ts, nunca
// un dato en vivo). Errores transitorios de un solo sync quedan en el
// log de esa sincronización, no acá.
export async function listarCuentasConErrorDespacho(empresaId: string): Promise<CuentaConErrorDespacho[]> {
  const cuentas = await listarCuentasConectadas(empresaId);
  return cuentas
    .filter((c) => c.desconectadaTs != null)
    .map((c) => ({ cuentaId: c.id, nickname: c.nickname, motivo: "Token vencido — hay que reconectar la cuenta." }));
}
