// Issue #422 (cuentas por cobrar) — cuándo libera Mercado Libre la plata
// de una venta. Lo confiable es el PAGO, no la orden: /orders/{id} no
// siempre trae money_release_date (decisión con Mateo/Sharel, 19-nov). Se
// pide /v1/payments/{id} con el payment id que ya trae payments[] de la
// orden; si el token de ML no tiene permiso (401/403), /collections/{id}.
// Si ninguno de los dos deja, depende de la app de Mercado Pago: se avisa
// en el log y la venta queda sin fecha (no se inventa).
//
// Solo se consulta lo que sigue sin liberar: una venta ya «released» no
// vuelve a gastar llamadas. Toda llamada pasa por lib/ml/cliente.ts
// (vía el lector con reintento de 429 que pasa quien llama).

import { eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidosFinanzas } from "@/db/schema";
import { aCentavos, desdeCentavos } from "@/lib/finanzas/utilidad-venta";
import { montoDeJson } from "@/lib/finanzas/venta-ml";
import { MlNoAutorizadoError, MlSinPermisoAppError, type RespuestaLecturaMl } from "@/lib/ml/cliente";

const PATRON_ID_NUMERICO = /^\d+$/;
export const ESTADO_LIBERADO = "released";

export type LectorMl = <T>(ruta: string) => Promise<RespuestaLecturaMl<T>>;

export type LiberacionPago = {
  estado: string | null;
  // ISO tal cual la manda Mercado Libre (con su zona horaria).
  fecha: string | null;
  // Neto que recibe el vendedor (net_received_amount), 2 decimales.
  neto: string | null;
};

type PagoJson = {
  money_release_date?: unknown;
  money_release_status?: unknown;
  net_received_amount?: unknown;
  transaction_details?: { net_received_amount?: unknown } | null;
};

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const fechaValida = (v: unknown): string | null => {
  const t = texto(v);
  return t && !Number.isNaN(Date.parse(t)) ? t : null;
};
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Lee las dos formas: /v1/payments/{id} trae el neto en
// transaction_details; /collections/{id} lo trae arriba y puede venir
// envuelto en { collection: {...} }. null si no es un objeto.
export function liberacionDesdePago(json: unknown): LiberacionPago | null {
  if (!json || typeof json !== "object") return null;
  const envuelto = (json as { collection?: unknown }).collection;
  const pago = (envuelto && typeof envuelto === "object" ? envuelto : json) as PagoJson;
  const neto = numero(pago.transaction_details?.net_received_amount) ?? numero(pago.net_received_amount);
  return {
    estado: texto(pago.money_release_status),
    fecha: fechaValida(pago.money_release_date),
    neto: neto === null ? null : montoDeJson(neto),
  };
}

export type PagoOrden = { id?: number | string | null; status?: string; money_release_status?: string | null };

// Pagos aprobados que todavía hay que consultar. Una orden cancelada no
// se cobra; si la venta ya quedó liberada, o el pago de la orden ya
// dice «released», no se pide nada.
export function pagosPorConsultar(estadoOrden: string, pagos: PagoOrden[], estadoGuardado: string | null): string[] {
  if (estadoOrden === "cancelled" || estadoGuardado === ESTADO_LIBERADO) return [];
  return [
    ...new Set(
      pagos
        .filter((p) => p.status === "approved" && p.money_release_status !== ESTADO_LIBERADO)
        .map((p) => String(p.id ?? ""))
        .filter((id) => PATRON_ID_NUMERICO.test(id))
    ),
  ];
}

export type LiberacionVenta = { estado: string; fecha: Date | null; montoPorLiberar: string };

// Une los pagos de una venta: liberada solo si TODOS están liberados.
// Si falta alguno, la fecha es la más tardía de los pendientes (la plata
// completa entra ese día) y el monto es el neto de los pendientes. Un
// pendiente sin neto deja el monto en 0: no se adivina.
export function combinarLiberaciones(pagos: LiberacionPago[]): LiberacionVenta | null {
  if (pagos.length === 0) return null;
  const pendientes = pagos.filter((p) => p.estado !== ESTADO_LIBERADO);
  const fechas = (lista: LiberacionPago[]) => lista.map((p) => p.fecha).filter((f): f is string => f !== null);
  const masTardia = (lista: string[]) => (lista.length ? new Date(Math.max(...lista.map((f) => Date.parse(f)))) : null);
  if (pendientes.length === 0) {
    return { estado: ESTADO_LIBERADO, fecha: masTardia(fechas(pagos)), montoPorLiberar: "0.00" };
  }
  const monto = pendientes.reduce((s, p) => s + (p.neto === null ? BigInt(0) : aCentavos(p.neto)), BigInt(0));
  return {
    estado: pendientes.find((p) => p.estado)?.estado ?? "pending",
    fecha: masTardia(fechas(pendientes)),
    montoPorLiberar: desdeCentavos(monto),
  };
}

export type ResultadoPago = { tipo: "ok"; liberacion: LiberacionPago } | { tipo: "sin_permiso" } | { tipo: "sin_dato" };

// Un pago: /v1/payments/{id}; con 401/403, /collections/{id}. Un 429
// persistente se propaga (lo corta el lector de quien llama).
export async function leerLiberacionPago(leer: LectorMl, pagoId: string): Promise<ResultadoPago> {
  if (!PATRON_ID_NUMERICO.test(pagoId)) return { tipo: "sin_dato" };
  for (const ruta of [`/v1/payments/${pagoId}`, `/collections/${pagoId}`]) {
    try {
      const resp = await leer<unknown>(ruta);
      if (!resp.ok) return { tipo: "sin_dato" };
      const liberacion = liberacionDesdePago(resp.data);
      return liberacion ? { tipo: "ok", liberacion } : { tipo: "sin_dato" };
    } catch (error) {
      if (error instanceof MlNoAutorizadoError || error instanceof MlSinPermisoAppError) continue;
      throw error;
    }
  }
  return { tipo: "sin_permiso" };
}

// Paso de la sync (guardarOrdenMl): consulta los pagos sin liberar de la
// venta y guarda fecha, estado y monto. Un pago sin permiso o sin dato
// deja la venta como estaba: la próxima sync lo reintenta.
export async function sincronizarLiberacion(
  empresaId: string,
  pedidoId: string,
  orden: { id: number | string; status: string; payments?: PagoOrden[] },
  leer: LectorMl
): Promise<void> {
  const [actual] = await dbComoEmpresa(empresaId, (tx) =>
    tx.select({ estado: pedidosFinanzas.estadoLiberacion }).from(pedidosFinanzas).where(eq(pedidosFinanzas.pedidoId, pedidoId))
  );
  if (!actual) return;
  const ids = pagosPorConsultar(orden.status, orden.payments ?? [], actual.estado);
  if (ids.length === 0) return;

  const leidos: LiberacionPago[] = [];
  for (const id of ids) {
    const resultado = await leerLiberacionPago(leer, id);
    if (resultado.tipo === "sin_permiso") {
      console.warn(
        `[liberacion] la orden ${orden.id}: ni /v1/payments ni /collections dejan leer el pago con el token de Mercado Libre (depende de la app de Mercado Pago).`
      );
      return;
    }
    if (resultado.tipo === "sin_dato") return;
    leidos.push(resultado.liberacion);
  }
  const venta = combinarLiberaciones(leidos);
  if (!venta) return;
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(pedidosFinanzas)
      .set({ estadoLiberacion: venta.estado, fechaLiberacion: venta.fecha, montoPorLiberar: venta.montoPorLiberar })
      .where(eq(pedidosFinanzas.pedidoId, pedidoId))
  );
}
