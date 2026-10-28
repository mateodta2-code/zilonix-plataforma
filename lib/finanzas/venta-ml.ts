// Issue #130 (Z-FIN-08) — de la respuesta de Mercado Libre a los datos
// financieros de una venta. Función pura (sin base, sin red): la usa
// lib/ml/ventas-finanzas.ts después de leer la orden, su envío y las
// publicaciones.
//
// Campos (hallazgos del Zilonix OS, comentario de Sharel del 22-oct en
// #129/#130; se ratifican en staging en #122):
// - valor_venta = suma de transaction_amount de los pagos aprobados
//   (también los que después se reembolsaron), SIN restar reembolsos.
// - reembolsos = suma de transaction_amount_refunded de esos pagos.
// - comision_ml = suma de marketplace_fee de esos pagos.
// - flete_ml = suma de `cost` de los senders de /shipments/{id}/costs.
//   Flex = $0 (regla del OS: ML lo revierte después).
// - forma de entrega = logistic_type del envío, nunca el prefijo del SKU.
// - SKU = item.seller_sku; si viene vacío, el atributo SELLER_SKU de la
//   publicación. seller_custom_field no se usa.
// - Montos: los números del JSON pasan a texto decimal sin aritmética
//   de float (lib/numeros/normalizar-decimal.ts).

import { aEscala, textoDeNumeroJson } from "@/lib/numeros/normalizar-decimal";
import { aCentavos, desdeCentavos, type FormaEntrega } from "./utilidad-venta";

const CERO = BigInt(0);

export type OrdenMl = {
  id: number | string;
  date_created: string;
  status: string;
  total_amount: number;
  currency_id: string;
  pack_id?: number | string | null;
  shipping?: { id?: number | string | null } | null;
  payments?: {
    status?: string;
    date_approved?: string | null;
    transaction_amount?: number | null;
    transaction_amount_refunded?: number | null;
    marketplace_fee?: number | null;
  }[];
  order_items?: {
    item?: { id?: string; title?: string | null; seller_sku?: string | null };
    quantity?: number;
    unit_price?: number;
  }[];
};

export type EnvioMl = {
  logistic_type?: string | null;
  status_history?: { date_shipped?: string | null; date_delivered?: string | null } | null;
};

export type CostosEnvioMl = { senders?: { cost?: number | null }[] | null };

// Lo que se sabe de cada publicación por /items?ids=.
export type PublicacionVentaMl = { imagenUrl: string | null; sellerSku: string | null };

export type LineaVentaMl = {
  itemIdExterno: string;
  // Tal cual vino (sin normalizar); la escritura lo normaliza.
  skuCodigo: string | null;
  cantidad: number;
  precioUnitario: string;
  titulo: string;
  imagenUrl: string | null;
};

export type VentaMl = {
  pedidoIdExterno: string;
  fecha: Date;
  total: string;
  moneda: string;
  estado: string;
  formaEntrega: FormaEntrega;
  logisticTypeMl: string | null;
  fechaPagoAprobado: Date | null;
  valorVenta: string;
  reembolsos: string;
  comisionMl: string | null;
  fleteMl: string | null;
  cancelada: boolean;
  shipmentIdExterno: string | null;
  packIdExterno: string | null;
  fechaDespacho: Date | null;
  fechaEntrega: Date | null;
  lineas: LineaVentaMl[];
};

export function formaEntregaDeLogistica(logisticType: string | null | undefined): FormaEntrega {
  switch (logisticType) {
    case "fulfillment":
      return "full_ml";
    case "self_service":
      return "flex";
    case "cross_docking":
    case "xd_drop_off":
    case "drop_off":
      return "agencia";
    default:
      return "desconocida";
  }
}

export function montoDeJson(valor: number | null | undefined): string | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  return aEscala(textoDeNumeroJson(valor), 2, { origenJson: true });
}

function sumarMontos(valores: (string | null)[]): string | null {
  const presentes = valores.filter((v): v is string => v !== null);
  if (presentes.length === 0) return null;
  return desdeCentavos(presentes.reduce((s, v) => s + aCentavos(v), CERO));
}

function fechaONull(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function textoONull(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto === "" ? null : texto;
}

export function ventaDesdeMl(
  orden: OrdenMl,
  envio: EnvioMl | null,
  costosEnvio: CostosEnvioMl | null,
  publicaciones: ReadonlyMap<string, PublicacionVentaMl>
): VentaMl {
  const pagos = (orden.payments ?? []).filter((p) => p.status === "approved" || p.status === "refunded");
  const valorVenta = sumarMontos(pagos.map((p) => montoDeJson(p.transaction_amount))) ?? "0.00";
  const reembolsos = sumarMontos(pagos.map((p) => montoDeJson(p.transaction_amount_refunded))) ?? "0.00";
  const comisionMl = sumarMontos(pagos.map((p) => montoDeJson(p.marketplace_fee)));
  const fechasPago = pagos.map((p) => fechaONull(p.date_approved)).filter((f): f is Date => f !== null);
  const fechaPagoAprobado = fechasPago.length ? new Date(Math.min(...fechasPago.map((f) => f.getTime()))) : null;

  const logisticTypeMl = envio?.logistic_type ?? null;
  const formaEntrega = formaEntregaDeLogistica(logisticTypeMl);
  const fleteMl =
    formaEntrega === "flex" ? "0.00" : costosEnvio ? sumarMontos((costosEnvio.senders ?? []).map((s) => montoDeJson(s.cost))) : null;

  // Reembolso total: la venta no cuenta (sale de las cifras). Una
  // orden cancelada en ML tampoco.
  const valor = aCentavos(valorVenta);
  const cancelada = orden.status === "cancelled" || (valor > CERO && aCentavos(reembolsos) >= valor);

  const lineas = (orden.order_items ?? []).map((item): LineaVentaMl => {
    const itemId = String(item.item?.id ?? "");
    const publicacion = publicaciones.get(itemId);
    const cantidad = item.quantity ?? 1;
    return {
      itemIdExterno: itemId,
      skuCodigo: textoONull(item.item?.seller_sku) ?? publicacion?.sellerSku ?? null,
      cantidad,
      precioUnitario: montoDeJson(item.unit_price) ?? "0.00",
      titulo: textoONull(item.item?.title) ?? itemId,
      imagenUrl: publicacion?.imagenUrl ?? null,
    };
  });

  return {
    pedidoIdExterno: String(orden.id),
    fecha: new Date(orden.date_created),
    total: montoDeJson(orden.total_amount) ?? "0.00",
    moneda: orden.currency_id,
    estado: orden.status,
    formaEntrega,
    logisticTypeMl,
    fechaPagoAprobado,
    valorVenta,
    reembolsos,
    comisionMl,
    fleteMl,
    cancelada,
    shipmentIdExterno: textoONull(orden.shipping?.id),
    packIdExterno: textoONull(orden.pack_id),
    fechaDespacho: fechaONull(envio?.status_history?.date_shipped),
    fechaEntrega: fechaONull(envio?.status_history?.date_delivered),
    lineas,
  };
}

// Respuesta de /items?ids=…&attributes=id,secure_thumbnail,thumbnail,attributes.
export function publicacionesDesdeItemsMl(respuesta: unknown): Map<string, PublicacionVentaMl> {
  const resultado = new Map<string, PublicacionVentaMl>();
  if (!Array.isArray(respuesta)) return resultado;
  for (const fila of respuesta as { code?: number; body?: Record<string, unknown> }[]) {
    if (fila?.code !== 200 || !fila.body || typeof fila.body.id !== "string") continue;
    const cuerpo = fila.body;
    const imagen = typeof cuerpo.secure_thumbnail === "string" && cuerpo.secure_thumbnail ? cuerpo.secure_thumbnail : typeof cuerpo.thumbnail === "string" && cuerpo.thumbnail ? cuerpo.thumbnail : null;
    const atributos = Array.isArray(cuerpo.attributes) ? (cuerpo.attributes as { id?: unknown; value_name?: unknown }[]) : [];
    const sellerSku = textoONull(atributos.find((a) => a?.id === "SELLER_SKU")?.value_name);
    resultado.set(cuerpo.id as string, { imagenUrl: imagen, sellerSku });
  }
  return resultado;
}
