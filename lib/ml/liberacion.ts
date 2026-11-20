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
// (vía el lector con reintento de 429 que pasa quien llama). Ningún log
// de este archivo lleva el token: solo ids de orden y de cuenta.

import { and, eq } from "drizzle-orm";
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

// montoPorLiberar null = algún pago pendiente llegó sin neto: la venta
// sigue por cobrar, pero el monto no se adivina.
export type LiberacionVenta = { estado: string; fecha: Date | null; montoPorLiberar: string | null };

// Une los pagos de una venta: liberada solo si TODOS están liberados.
// Si falta alguno, la fecha es la más tardía de los pendientes (la plata
// completa entra ese día) y el monto es el neto de los pendientes.
export function combinarLiberaciones(pagos: LiberacionPago[]): LiberacionVenta | null {
  if (pagos.length === 0) return null;
  const pendientes = pagos.filter((p) => p.estado !== ESTADO_LIBERADO);
  const fechas = (lista: LiberacionPago[]) => lista.map((p) => p.fecha).filter((f): f is string => f !== null);
  const masTardia = (lista: string[]) => (lista.length ? new Date(Math.max(...lista.map((f) => Date.parse(f)))) : null);
  if (pendientes.length === 0) {
    return { estado: ESTADO_LIBERADO, fecha: masTardia(fechas(pagos)), montoPorLiberar: "0.00" };
  }
  const sinNeto = pendientes.some((p) => p.neto === null);
  return {
    estado: pendientes.find((p) => p.estado)?.estado ?? "pending",
    fecha: masTardia(fechas(pendientes)),
    montoPorLiberar: sinNeto ? null : desdeCentavos(pendientes.reduce((s, p) => s + aCentavos(p.neto!), BigInt(0))),
  };
}

// ---------- Permisos recordados por cuenta ----------
//
// Revisión del PR #486 (Pablo): un 403 de /v1/payments es del permiso de
// la app, no de la orden: se repite en TODAS. Se recuerda por cuenta para
// ir directo a /collections y no gastar dos llamadas por orden; si las
// dos rutas dan 403, la cuenta no se consulta más y queda UN solo log.
// En memoria del proceso y por unas horas: si Mateo habilita el permiso,
// la cuenta se vuelve a probar sola. Un 401 (token vencido) NO se
// recuerda: es de ese momento, no del permiso.

const OLVIDAR_PERMISO_MS = 6 * 60 * 60 * 1000;

type PermisoCuenta = { v1Prohibido: boolean; sinPermiso: boolean; desde: number };
const permisosPorCuenta = new Map<string, PermisoCuenta>();

function permisoDe(cuentaMlId: string, ahora: number): PermisoCuenta {
  const actual = permisosPorCuenta.get(cuentaMlId);
  if (actual && ahora - actual.desde < OLVIDAR_PERMISO_MS) return actual;
  const nuevo = { v1Prohibido: false, sinPermiso: false, desde: ahora };
  permisosPorCuenta.set(cuentaMlId, nuevo);
  return nuevo;
}

// Solo para pruebas.
export function olvidarPermisosLiberacion(): void {
  permisosPorCuenta.clear();
}

// status: el HTTP no-ok que devolvió ML (404, 400…), para poder loguearlo.
export type ResultadoPago = { tipo: "ok"; liberacion: LiberacionPago } | { tipo: "sin_permiso" } | { tipo: "sin_dato"; status?: number };

// Un pago: /v1/payments/{id} (salvo que la cuenta ya dio 403 ahí); con
// 401/403, /collections/{id}. Un 429 persistente se propaga (lo corta el
// lector de quien llama).
export async function leerLiberacionPago(
  leer: LectorMl,
  pagoId: string,
  cuentaMlId: string,
  ahora: number = Date.now()
): Promise<ResultadoPago> {
  if (!PATRON_ID_NUMERICO.test(pagoId)) return { tipo: "sin_dato" };
  const permiso = permisoDe(cuentaMlId, ahora);
  if (permiso.sinPermiso) return { tipo: "sin_permiso" };

  const rutas = [
    ...(permiso.v1Prohibido ? [] : [{ ruta: `/v1/payments/${pagoId}`, v1: true }]),
    { ruta: `/collections/${pagoId}`, v1: false },
  ];
  for (const { ruta, v1 } of rutas) {
    try {
      const resp = await leer<unknown>(ruta);
      if (!resp.ok) return { tipo: "sin_dato", status: resp.status };
      const liberacion = liberacionDesdePago(resp.data);
      return liberacion ? { tipo: "ok", liberacion } : { tipo: "sin_dato" };
    } catch (error) {
      if (error instanceof MlSinPermisoAppError) {
        if (v1) permiso.v1Prohibido = true;
        continue;
      }
      if (error instanceof MlNoAutorizadoError) continue;
      throw error;
    }
  }
  // Las dos con 403 = permiso de la app: se recuerda y se avisa UNA vez.
  if (permiso.v1Prohibido && !permiso.sinPermiso) {
    permiso.sinPermiso = true;
    console.warn(
      `[liberacion] la cuenta ${cuentaMlId}: ni /v1/payments ni /collections dejan leer pagos con el token de Mercado Libre (depende de la app de Mercado Pago). No se consulta más por ${OLVIDAR_PERMISO_MS / 3_600_000} h.`
    );
  }
  return { tipo: "sin_permiso" };
}

// Qué pasó con la liberación de UNA orden. La sync de la cuenta los
// cuenta y deja una línea de resumen (lib/ml/ventas-finanzas.ts).
export type ResultadoLiberacion =
  | "pendiente"
  | "liberada"
  | "ya_liberada"
  | "cancelada"
  | "sin_pagos"
  | "sin_fila"
  | "sin_permiso"
  | "sin_dato";

// Paso de la sync (guardarOrdenMl): consulta los pagos sin liberar de la
// venta y guarda fecha, estado y monto. Un pago sin permiso o sin dato
// deja la venta como estaba: la próxima sync lo reintenta.
//
// Bug real en staging (19-nov, commit 5bfe58f): «Traer ventas de este
// mes» guardaba las ventas pero por-cobrar quedaba en 0 y en Railway no
// había NI UNA línea de /v1/payments, /collections ni de este archivo:
// tres salidas (sin fila, sin pagos aprobados con id, ML respondiendo un
// 4xx distinto de 401/403) volvían sin dejar rastro. Ahora cada una deja
// un aviso con solo el id de la cuenta y de la orden (nunca el token).
export async function sincronizarLiberacion(
  empresaId: string,
  cuentaMlId: string,
  pedidoId: string,
  orden: { id: number | string; status: string; payments?: PagoOrden[] },
  leer: LectorMl
): Promise<ResultadoLiberacion> {
  const aviso = (texto: string) => console.warn(`[liberacion] cuenta ${cuentaMlId}, orden ${orden.id}: ${texto}`);
  const deLaVenta = and(eq(pedidosFinanzas.empresaId, empresaId), eq(pedidosFinanzas.pedidoId, pedidoId));
  const [actual] = await dbComoEmpresa(empresaId, (tx) =>
    tx.select({ estado: pedidosFinanzas.estadoLiberacion }).from(pedidosFinanzas).where(deLaVenta)
  );
  if (!actual) {
    aviso("la venta no tiene fila en pedidos_finanzas; no se consultó la liberación.");
    return "sin_fila";
  }
  const pagos = orden.payments ?? [];
  const ids = pagosPorConsultar(orden.status, pagos, actual.estado);
  if (ids.length === 0) {
    if (orden.status === "cancelled") return "cancelada";
    if (actual.estado === ESTADO_LIBERADO) return "ya_liberada";
    const aprobados = pagos.filter((p) => p.status === "approved");
    if (aprobados.length > 0 && aprobados.every((p) => p.money_release_status === ESTADO_LIBERADO)) return "ya_liberada";
    // Solo estados y cantidades: nada del comprador.
    const estados = pagos.map((p) => `${p.status ?? "sin estado"}${PATRON_ID_NUMERICO.test(String(p.id ?? "")) ? "" : " sin id"}`);
    aviso(`ningún pago aprobado con id para consultar (orden ${orden.status}, pagos: ${estados.join(", ") || "ninguno"}).`);
    return "sin_pagos";
  }

  const leidos: LiberacionPago[] = [];
  for (const id of ids) {
    const resultado = await leerLiberacionPago(leer, id, cuentaMlId);
    if (resultado.tipo === "sin_permiso") return "sin_permiso";
    if (resultado.tipo === "sin_dato") {
      aviso(
        resultado.status
          ? `Mercado Libre respondió ${resultado.status} al pedir el pago; queda sin fecha y se reintenta en la próxima sync.`
          : "el pago no trajo datos de liberación; queda sin fecha y se reintenta en la próxima sync."
      );
      return "sin_dato";
    }
    leidos.push(resultado.liberacion);
  }
  const venta = combinarLiberaciones(leidos);
  if (!venta) return "sin_dato";
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(pedidosFinanzas)
      .set({ estadoLiberacion: venta.estado, fechaLiberacion: venta.fecha, montoPorLiberar: venta.montoPorLiberar })
      .where(deLaVenta)
  );
  return venta.estado === ESTADO_LIBERADO ? "liberada" : "pendiente";
}
