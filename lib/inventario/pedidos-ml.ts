import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, bodegas, kardexMovimientos, pedidoItems, pedidos, pedidosFinanzas, stockBodega } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { decidirAccionPedido, elegirBodegaParaReserva, StockInsuficienteError, type AccionPedido } from "@/lib/inventario/calculos";
import { leerConfiguracionInventarioTx } from "@/lib/inventario/configuracion";
import { aplicarMovimientosTx, expandirKitsTx, SkuNoValidoParaStockError } from "@/lib/inventario/movimientos";

// Issue #280 — un pedido de ML mueve el stock en tres pasos:
// reserva (pagado) → confirmación (despachado) o liberación (cancelado).
// Idempotente: cada paso tiene su clave en el kardex
// ("pedido:<id>:reserva" ...), así que volver a sincronizar la misma
// orden cien veces mueve el stock una sola vez.
//
// Supuestos de Fase 1 (preguntas abiertas del issue, sin confirmar):
// 1. Reserva al quedar "paid" (status de la orden de ML), no antes: un
//    payment_required / payment_in_process todavía puede no pagarse.
// 2. Confirma cuando el envío tiene fecha de despacho
//    (pedidos_finanzas.fecha_despacho), el mismo dato que ya usa
//    finanzas. Si llega despachado sin haber reservado nunca, reserva y
//    confirma en la misma pasada.
// 3. Cancelado = pedidos_finanzas.cancelada (cancelled o reembolso
//    total, lib/finanzas/venta-ml.ts). Libera solo lo reservado; lo ya
//    confirmado (salió de la bodega) no vuelve solo: una devolución se
//    registra a mano como entrada.
// 4. Full (forma_entrega full_ml) no toca el stock propio: ML despacha
//    de su bodega.
// 5. Rechazo total: si una línea no tiene SKU propio o el pedido no
//    alcanza entero en una sola bodega, no se reserva nada y queda en
//    auditoría (una sola vez por pedido).

type Tx = typeof db;

export type ResultadoInventarioPedido =
  | { resultado: "aplicado"; accion: Exclude<AccionPedido, "nada"> }
  | { resultado: "sin_cambios" }
  | { resultado: "omitido"; motivo: "reserva_apagada" | "anterior_al_inicio" | "full" | "sin_cabecera" }
  | { resultado: "rechazado"; motivo: "sku_sin_vincular" | "sin_stock" };

const clave = (pedidoId: string, paso: "reserva" | "confirmacion" | "liberacion") => `pedido:${pedidoId}:${paso}`;

async function lineasDelPaso(tx: Tx, empresaId: string, pedidoId: string, paso: "reserva" | "confirmacion" | "liberacion") {
  return tx
    .select({ bodegaId: kardexMovimientos.bodegaId, skuId: kardexMovimientos.skuId, reservado: kardexMovimientos.deltaReservado })
    .from(kardexMovimientos)
    .where(and(eq(kardexMovimientos.empresaId, empresaId), eq(kardexMovimientos.claveIdempotencia, clave(pedidoId, paso))))
    .orderBy(asc(kardexMovimientos.linea));
}

async function rechazar(
  tx: Tx,
  empresaId: string,
  pedidoId: string,
  motivo: "sku_sin_vincular" | "sin_stock"
): Promise<ResultadoInventarioPedido> {
  const accion = `inventario.reserva_rechazada.${motivo}`;
  const [ya] = await tx
    .select({ id: auditoria.id })
    .from(auditoria)
    .where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.entidadId, pedidoId), eq(auditoria.accion, accion)))
    .limit(1);
  if (!ya) {
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId: null,
      actorTipo: "sistema",
      accion,
      entidad: "pedidos",
      entidadId: pedidoId,
      detalle:
        motivo === "sin_stock"
          ? "No se reservó: ninguna bodega tiene todo el pedido (Fase 1 no parte pedidos)."
          : "No se reservó: una línea del pedido no tiene SKU propio vinculado.",
    });
  }
  return { resultado: "rechazado", motivo };
}

async function reservarTx(tx: Tx, empresaId: string, pedidoId: string): Promise<ResultadoInventarioPedido | null> {
  const lineas = await tx
    .select({ skuId: pedidoItems.skuId, cantidad: pedidoItems.cantidad })
    .from(pedidoItems)
    .where(and(eq(pedidoItems.empresaId, empresaId), eq(pedidoItems.pedidoId, pedidoId)));
  if (lineas.length === 0 || lineas.some((l) => !l.skuId)) return rechazar(tx, empresaId, pedidoId, "sku_sin_vincular");

  let expandidas: { skuId: string; cantidad: number }[];
  try {
    expandidas = await expandirKitsTx(tx, lineas.map((l) => ({ skuId: l.skuId!, cantidad: l.cantidad })));
  } catch (error) {
    if (error instanceof SkuNoValidoParaStockError) return rechazar(tx, empresaId, pedidoId, "sku_sin_vincular");
    throw error;
  }

  const candidatas = await tx
    .select({ id: bodegas.id })
    .from(bodegas)
    .where(and(eq(bodegas.empresaId, empresaId), eq(bodegas.activa, true), ne(bodegas.tipo, "fulfillment_ml")))
    .orderBy(desc(bodegas.esPrincipal), asc(bodegas.nombre));
  const skuIds = [...new Set(expandidas.map((l) => l.skuId))];
  const saldos = candidatas.length
    ? await tx
        .select({ bodegaId: stockBodega.bodegaId, skuId: stockBodega.skuId, disponible: stockBodega.disponible })
        .from(stockBodega)
        .where(and(eq(stockBodega.empresaId, empresaId), inArray(stockBodega.skuId, skuIds)))
    : [];
  const disponible = new Map(saldos.map((s) => [`${s.bodegaId}|${s.skuId}`, s.disponible]));
  const bodegaId = elegirBodegaParaReserva(
    expandidas,
    candidatas.map((b) => b.id),
    (b, s) => disponible.get(`${b}|${s}`) ?? 0
  );
  if (!bodegaId) return rechazar(tx, empresaId, pedidoId, "sin_stock");

  await aplicarMovimientosTx(tx, empresaId, {
    claveIdempotencia: clave(pedidoId, "reserva"),
    origen: "pedido_ml",
    referenciaId: pedidoId,
    actor: { tipo: "sistema" },
    lineas: expandidas.map((l) => ({ tipo: "reserva" as const, bodegaId, skuId: l.skuId, cantidad: l.cantidad })),
  });
  return null;
}

async function cerrarReservaTx(tx: Tx, empresaId: string, pedidoId: string, paso: "confirmacion" | "liberacion"): Promise<void> {
  const reservadas = await lineasDelPaso(tx, empresaId, pedidoId, "reserva");
  await aplicarMovimientosTx(tx, empresaId, {
    claveIdempotencia: clave(pedidoId, paso),
    origen: "pedido_ml",
    referenciaId: pedidoId,
    actor: { tipo: "sistema" },
    lineas: reservadas.map((r) => ({ tipo: paso, bodegaId: r.bodegaId, skuId: r.skuId, cantidad: r.reservado })),
  });
}

export async function sincronizarInventarioPedido(empresaId: string, pedidoId: string): Promise<ResultadoInventarioPedido> {
  try {
    return await dbComoEmpresa(empresaId, async (tx) => {
      const config = await leerConfiguracionInventarioTx(tx, empresaId);
      if (!config.reservaPedidosDesdeTs) return { resultado: "omitido", motivo: "reserva_apagada" };

      const [pedido] = await tx
        .select({ fecha: pedidos.fecha, estado: pedidos.estado })
        .from(pedidos)
        .where(and(eq(pedidos.empresaId, empresaId), eq(pedidos.id, pedidoId)));
      if (!pedido) throw new Error("Ese pedido no existe en esta empresa.");
      if (pedido.fecha < config.reservaPedidosDesdeTs) return { resultado: "omitido", motivo: "anterior_al_inicio" };

      const [cabecera] = await tx
        .select({ cancelada: pedidosFinanzas.cancelada, fechaDespacho: pedidosFinanzas.fechaDespacho, formaEntrega: pedidosFinanzas.formaEntrega })
        .from(pedidosFinanzas)
        .where(and(eq(pedidosFinanzas.empresaId, empresaId), eq(pedidosFinanzas.pedidoId, pedidoId)));
      if (!cabecera) return { resultado: "omitido", motivo: "sin_cabecera" };
      if (cabecera.formaEntrega === "full_ml") return { resultado: "omitido", motivo: "full" };

      const [reserva, confirmacion, liberacion] = await Promise.all([
        lineasDelPaso(tx, empresaId, pedidoId, "reserva"),
        lineasDelPaso(tx, empresaId, pedidoId, "confirmacion"),
        lineasDelPaso(tx, empresaId, pedidoId, "liberacion"),
      ]);
      const accion = decidirAccionPedido({
        pagado: pedido.estado.toLowerCase() === "paid",
        despachado: cabecera.fechaDespacho !== null,
        cancelado: cabecera.cancelada,
        tieneReserva: reserva.length > 0,
        cerrado: confirmacion.length > 0 || liberacion.length > 0,
      });
      if (accion === "nada") return { resultado: "sin_cambios" };

      if (accion === "reservar" || accion === "reservar_y_confirmar") {
        const rechazo = await reservarTx(tx, empresaId, pedidoId);
        if (rechazo) return rechazo;
      }
      if (accion === "confirmar" || accion === "reservar_y_confirmar") await cerrarReservaTx(tx, empresaId, pedidoId, "confirmacion");
      if (accion === "liberar") await cerrarReservaTx(tx, empresaId, pedidoId, "liberacion");
      return { resultado: "aplicado", accion };
    });
  } catch (error) {
    // Otra venta ganó la última unidad entre la lectura y el bloqueo:
    // la transacción se deshizo entera, es un rechazo por stock.
    if (error instanceof StockInsuficienteError) {
      return dbComoEmpresa(empresaId, (tx) => rechazar(tx, empresaId, pedidoId, "sin_stock"));
    }
    throw error;
  }
}
