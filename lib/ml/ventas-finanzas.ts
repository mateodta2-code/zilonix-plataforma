// Issue #130 (Z-FIN-08) — trae de Mercado Libre lo que necesita la
// foto financiera de una venta y la guarda (lib/finanzas/guardar-venta.ts).
//
// Toda llamada pasa por pedirLecturaMl (lib/ml/cliente.ts): nada de
// fetch suelto acá. Un 429 se reintenta con espera creciente (respeta
// Retry-After); si se agota, se corta la cuenta y la próxima corrida
// la retoma desde el mismo `desde` (el guardado es idempotente).
// Los logs nunca llevan tokens ni datos del comprador.
//
// Fuera de este PR (anotado en #130): la cola genérica de trabajos
// (#49) con su ruta/cron y el botón "sincronizar ahora" (#131). Acá
// queda la función por cuenta que esa cola va a llamar, con el rango
// como parámetro para el relleno histórico.

import { dbComoEmpresa } from "@/db/empresa-context";
import { registrarAuditoria } from "@/lib/auditoria";
import { guardarVentaFinanzas, type ResultadoGuardarVenta } from "@/lib/finanzas/guardar-venta";
import {
  publicacionesDesdeItemsMl,
  ventaDesdeMl,
  type CostosEnvioMl,
  type EnvioMl,
  type OrdenMl,
  type PublicacionVentaMl,
} from "@/lib/finanzas/venta-ml";
import { LimiteMercadoLibreError, PATRON_ID_PRODUCTO_O_ITEM, pedirLecturaMl, type RespuestaLecturaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { msDeReintento429 } from "@/lib/ml/reintento-429";

const TAMANO_PAGINA = 50;
const TAMANO_LOTE_ITEMS = 20;
const REINTENTOS_429 = 4;
const ESPERA_BASE_429_MS = 1_000;
const PATRON_ID_NUMERICO = /^\d+$/;

export type Esperar = (ms: number) => Promise<void>;
const esperarDeVerdad: Esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function leerConReintento<T>(
  ruta: string,
  token: string,
  query: string | undefined,
  esperar: Esperar
): Promise<RespuestaLecturaMl<T>> {
  for (let intento = 0; ; intento++) {
    try {
      return await pedirLecturaMl<T>(ruta, token, query ? { query } : undefined);
    } catch (error) {
      if (!(error instanceof LimiteMercadoLibreError) || intento >= REINTENTOS_429) throw error;
      await esperar(msDeReintento429(ESPERA_BASE_429_MS * 2 ** intento, error.retryAfterMs ?? null));
    }
  }
}

async function leerPublicaciones(token: string, itemIds: string[], esperar: Esperar): Promise<Map<string, PublicacionVentaMl>> {
  const validos = [...new Set(itemIds.filter((id) => PATRON_ID_PRODUCTO_O_ITEM.test(id)))];
  const resultado = new Map<string, PublicacionVentaMl>();
  for (let i = 0; i < validos.length; i += TAMANO_LOTE_ITEMS) {
    const lote = validos.slice(i, i + TAMANO_LOTE_ITEMS);
    const resp = await leerConReintento<unknown>("/items", token, `?ids=${lote.join(",")}&attributes=id,secure_thumbnail,thumbnail,attributes`, esperar);
    // Sin foto no es un error: la venta se guarda igual con imagen vacía.
    if (resp.ok) for (const [id, datos] of publicacionesDesdeItemsMl(resp.data)) resultado.set(id, datos);
  }
  return resultado;
}

// Detalle de una orden ya traída (orders/search devuelve la orden
// completa): su envío, los costos del envío y las publicaciones.
export async function guardarOrdenMl(
  empresaId: string,
  cuentaMlId: string,
  token: string,
  orden: OrdenMl,
  esperar: Esperar = esperarDeVerdad
): Promise<ResultadoGuardarVenta> {
  const shipmentId = orden.shipping?.id != null ? String(orden.shipping.id) : null;
  let envio: EnvioMl | null = null;
  let costos: CostosEnvioMl | null = null;
  if (shipmentId && PATRON_ID_NUMERICO.test(shipmentId)) {
    const respEnvio = await leerConReintento<EnvioMl>(`/shipments/${shipmentId}`, token, undefined, esperar);
    envio = respEnvio.ok ? respEnvio.data : null;
    const respCostos = await leerConReintento<CostosEnvioMl>(`/shipments/${shipmentId}/costs`, token, undefined, esperar);
    costos = respCostos.ok ? respCostos.data : null;
  }
  const itemIds = (orden.order_items ?? []).map((i) => String(i.item?.id ?? ""));
  const publicaciones = itemIds.length ? await leerPublicaciones(token, itemIds, esperar) : new Map();
  return guardarVentaFinanzas(empresaId, cuentaMlId, ventaDesdeMl(orden, envio, costos, publicaciones));
}

export type ResultadoSyncVentas = {
  leidas: number;
  guardadas: number;
  congeladas: number;
  fallidas: number;
  // true si un 429 persistente cortó la cuenta: retomar con el mismo rango.
  cortadaPorLimite: boolean;
};

// Por cuenta: órdenes con fecha de ÚLTIMA ACTUALIZACIÓN en el rango (una
// orden nueva también se actualiza al crearse, y una con pago aprobado
// tarde vuelve a entrar). Un error de una venta no corta el lote; cada
// corrida deja una fila en auditoria con actor "sistema".
export async function sincronizarVentasCuenta(
  empresaId: string,
  cuentaMlId: string,
  cuentaIdExterna: string,
  rango: { desde: Date; hasta?: Date },
  esperar: Esperar = esperarDeVerdad
): Promise<ResultadoSyncVentas> {
  if (!PATRON_ID_NUMERICO.test(cuentaIdExterna)) throw new Error("cuentaIdExterna inválido — no se llamó a la API.");
  const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
  const resultado: ResultadoSyncVentas = { leidas: 0, guardadas: 0, congeladas: 0, fallidas: 0, cortadaPorLimite: false };

  const filtroHasta = rango.hasta ? `&order.date_last_updated.to=${encodeURIComponent(rango.hasta.toISOString())}` : "";
  try {
    for (let offset = 0; ; offset += TAMANO_PAGINA) {
      const query = `?seller=${cuentaIdExterna}&order.date_last_updated.from=${encodeURIComponent(rango.desde.toISOString())}${filtroHasta}&sort=date_asc&limit=${TAMANO_PAGINA}&offset=${offset}`;
      const resp = await leerConReintento<{ results?: OrdenMl[] }>("/orders/search", token, query, esperar);
      if (!resp.ok) throw new Error(`Mercado Libre respondió ${resp.status} al buscar ventas.`);
      const pagina = resp.data.results ?? [];
      for (const orden of pagina) {
        resultado.leidas += 1;
        try {
          const guardada = await guardarOrdenMl(empresaId, cuentaMlId, token, orden, esperar);
          resultado.guardadas += 1;
          if (guardada.recienCongelada) resultado.congeladas += 1;
        } catch (error) {
          if (error instanceof LimiteMercadoLibreError) throw error;
          resultado.fallidas += 1;
          console.error(`[ventas-finanzas] la orden ${orden.id} no se pudo guardar:`, error instanceof Error ? error.message : "error desconocido");
        }
      }
      if (pagina.length < TAMANO_PAGINA) break;
    }
  } catch (error) {
    if (!(error instanceof LimiteMercadoLibreError)) throw error;
    resultado.cortadaPorLimite = true;
  }

  await dbComoEmpresa(empresaId, (tx) =>
    registrarAuditoria(tx, {
      empresaId,
      usuarioId: null,
      actorTipo: "sistema",
      accion: "sincronizar_ventas",
      entidad: "pedidos_finanzas",
      entidadId: cuentaMlId,
      detalle:
        `Ventas leídas ${resultado.leidas}, guardadas ${resultado.guardadas}, congeladas ${resultado.congeladas}, con error ${resultado.fallidas}` +
        (resultado.cortadaPorLimite ? "; cortada por el límite de Mercado Libre, se retoma en la próxima corrida." : "."),
    })
  );
  return resultado;
}
