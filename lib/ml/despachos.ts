import { and, asc, desc, eq, gte, ilike, isNull, lt, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl } from "@/db/schema";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { acotarPagina, limitesDiaBogota, parsearPagina, patronBusquedaLike } from "@/lib/filtros-listado";

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

type ShipmentMl = { status: string | null; substatus: string | null; logistic_type: string | null };

// Trae el envío real y guarda/actualiza la fila de despachos_ml — se
// llama al importar un pedido (tarea 2.5) y cuando llega un aviso de
// envío nuevo.
export async function sincronizarDespacho(empresaId: string, cuentaId: string, pedidoId: string, shipmentIdExterno: string): Promise<void> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/shipments/${shipmentIdExterno}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al traer el envío ${shipmentIdExterno}.`);
  const envio: ShipmentMl = await res.json();

  const logisticType = ["self_service", "xd_drop_off", "cross_docking", "fulfillment"].includes(envio.logistic_type ?? "")
    ? (envio.logistic_type as "self_service" | "xd_drop_off" | "cross_docking" | "fulfillment")
    : "otro";
  const imprimible = logisticType !== "fulfillment" && calcularImprimible(envio.status, envio.substatus);

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
      })
      .onConflictDoUpdate({
        target: [despachosMl.empresaId, despachosMl.shipmentIdExterno],
        set: { status: envio.status, substatus: envio.substatus, logisticType, imprimible, actualizadoTs: new Date() },
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
// armarla a mano pedido por pedido.
export async function obtenerEtiquetasPdf(empresaId: string, cuentaId: string, shipmentIdsExternos: string[]): Promise<ArrayBuffer> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${shipmentIdsExternos.join(",")}&response_type=pdf`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    let datos: { failed_shipments?: { cause?: string }[]; cause?: string } | null = null;
    try {
      datos = JSON.parse(texto);
    } catch {
      /* no era JSON */
    }
    const causa = datos?.failed_shipments?.[0]?.cause ?? datos?.cause;
    if (causa === "NOT_PRINTABLE_STATUS") throw new EtiquetaNoImprimibleError();
    throw new Error(`No se pudo traer la guía (HTTP ${res.status}): ${texto.slice(0, 300)}`);
  }
  return res.arrayBuffer();
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
