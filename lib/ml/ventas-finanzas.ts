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
import { sincronizarInventarioPedido } from "@/lib/inventario/pedidos-ml";
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
import { sincronizarDespacho } from "@/lib/ml/despachos";
import { registrarEventoPedido } from "@/lib/ml/pedidos";
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

// El listado /orders/search NO trae la orden completa: marketplace_fee
// llega vacío o en 0 (#123, #131). La comisión real está en el detalle
// GET /orders/{id}. Si el detalle falla se sigue con la orden del
// listado (venta-ml.ts usa sale_fee × cantidad o deja la comisión en
// null): una venta no se cae por esto. Un 429 persistente sí se
// propaga, para cortar la cuenta y retomarla.
async function leerDetalleOrden(token: string, orden: OrdenMl, esperar: Esperar): Promise<OrdenMl> {
  const id = String(orden.id ?? "");
  if (!PATRON_ID_NUMERICO.test(id)) return orden;
  try {
    const resp = await leerConReintento<OrdenMl>(`/orders/${id}`, token, undefined, esperar);
    if (resp.ok) return resp.data;
    console.error(`[ventas-finanzas] el detalle de la orden ${id} respondió ${resp.status}; se usa la del listado.`);
  } catch (error) {
    if (error instanceof LimiteMercadoLibreError) throw error;
    console.error(`[ventas-finanzas] el detalle de la orden ${id} no se pudo leer; se usa la del listado:`, error instanceof Error ? error.message : "error desconocido");
  }
  return orden;
}

// Una orden del listado: primero su detalle (comisión real), después
// su envío, los costos del envío y las publicaciones. La usan
// sincronizarVentasCuenta y la importación inicial (lib/ml/importacion.ts).
export async function guardarOrdenMl(
  empresaId: string,
  cuentaMlId: string,
  token: string,
  orden: OrdenMl,
  esperar: Esperar = esperarDeVerdad
): Promise<ResultadoGuardarVenta> {
  orden = await leerDetalleOrden(token, orden, esperar);
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
  const guardada = await guardarVentaFinanzas(empresaId, cuentaMlId, ventaDesdeMl(orden, envio, costos, publicaciones));
  // Issue #280 — reserva / confirma / libera stock con lo recién
  // guardado (idempotente). Un fallo del inventario no tumba la venta:
  // la próxima sincronización de esta orden lo vuelve a intentar.
  try {
    await sincronizarInventarioPedido(empresaId, guardada.pedidoId);
  } catch (error) {
    console.error(`[inventario] el stock de la orden ${orden.id} no se pudo actualizar:`, error instanceof Error ? error.message : "error desconocido");
  }
  // Issue "fechas equivocadas en Despachados" — bug real: la
  // importación inicial (lib/ml/importacion.ts) SÍ registraba estos dos
  // eventos (pedido_eventos, con la fecha real de status_history), pero
  // esta sincronización periódica nunca lo hacía — una venta sincronizada
  // después de la importación inicial se quedaba sin la fecha real de
  // despacho/entrega, y listarTarjetasDespacho (lib/ml/despachos.ts) no
  // tenía de dónde sacarla. Mismo dato ya leído arriba (envio), ninguna
  // llamada nueva a Mercado Libre. onConflictDoNothing (registrarEventoPedido)
  // hace esto idempotente igual que la importación inicial. Un fallo acá
  // no tumba la venta ya guardada: la próxima sincronización lo reintenta.
  if (envio?.status_history?.date_shipped) {
    await registrarEventoPedido(empresaId, guardada.pedidoId, "despacho", new Date(envio.status_history.date_shipped)).catch((error) => {
      console.error(`[ventas-finanzas] no se pudo registrar el evento de despacho de la orden ${orden.id}:`, error instanceof Error ? error.message : "error desconocido");
    });
  }
  if (envio?.status_history?.date_delivered) {
    await registrarEventoPedido(empresaId, guardada.pedidoId, "entrega", new Date(envio.status_history.date_delivered)).catch((error) => {
      console.error(`[ventas-finanzas] no se pudo registrar el evento de entrega de la orden ${orden.id}:`, error instanceof Error ? error.message : "error desconocido");
    });
  }
  return guardada;
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
          // Issue "Despachados (15 días)" — bug real: antes de esto,
          // despachos_ml SOLO se llenaba en la importación inicial
          // (lib/ml/importacion.ts, una sola vez al conectar la
          // cuenta) — cualquier venta que llegara después, por esta
          // sincronización periódica, nunca tenía fila en despachos_ml
          // y por eso jamás aparecía ni en Pendientes ni en
          // Despachados, sin importar su status real. Mismo patrón
          // que ya usa la importación inicial en su propio call site
          // (sincronizarDespacho, que SÍ guarda cualquier status,
          // incluido shipped/delivered — nunca filtra por estado al
          // guardar, solo al listar).
          if (orden.shipping?.id) {
            await sincronizarDespacho(empresaId, cuentaMlId, guardada.pedidoId, String(orden.shipping.id)).catch((error) => {
              console.error(`[ventas-finanzas] no se pudo sincronizar el despacho de la orden ${orden.id}:`, error instanceof Error ? error.message : "error desconocido");
            });
          }
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
