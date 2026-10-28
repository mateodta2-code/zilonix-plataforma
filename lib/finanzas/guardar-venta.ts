// Issue #130 (Z-FIN-08) — escritura idempotente de una venta en
// pedidos_finanzas + pedido_items, en una sola transacción.
//
// Orden: pedido → cabecera → líneas (las líneas cuelgan de la cabecera
// por FK compuesta, #129).
//
// Qué se actualiza en cada sincronización: valor, reembolsos, comisión,
// flete, cancelada, forma de entrega, envío y pack, y las fechas de
// pago, despacho y entrega (una fecha ya guardada nunca se borra si ML
// no la manda). Lo congelado (costo, empaque, envío, título, imagen)
// no se toca nunca una vez escrito: solo el recálculo masivo confirmado
// (lib/finanzas/recalcular-costos.ts) cambia un costo congelado.
//
// Mientras la venta no está congelada se reevalúa en cada pasada: al
// cargar el costo en la maestra, la próxima sincronización la congela.

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { configuracionFinanzas, costosSku, pedidoItems, pedidos, pedidosFinanzas, publicaciones, skus, terceros } from "@/db/schema";
import { normalizarSkuCodigo } from "@/lib/costos-sku";
import { congelarPaquete, type AlertaCongelado, type EstadoCosteo, type MaestraSku, type OrdenACongelar } from "./congelar";
import { aCentavos, desdeCentavos, repartirProporcional } from "./utilidad-venta";
import type { VentaMl } from "./venta-ml";

type Tx = typeof db;

export type ResultadoGuardarVenta = {
  pedidoId: string;
  estadoCosteo: EstadoCosteo;
  congelada: boolean;
  // Venta congelada en esta pasada (y no antes).
  recienCongelada: boolean;
  alertas: AlertaCongelado[];
};

function skuNormalizadoONull(codigo: string | null): string | null {
  if (codigo === null) return null;
  const limpio = codigo.trim();
  return limpio ? normalizarSkuCodigo(limpio) : null;
}

function repartirONull(total: string | null, pesos: bigint[]): (string | null)[] {
  if (total === null || pesos.length === 0) return pesos.map(() => null);
  return repartirProporcional(aCentavos(total), pesos).map(desdeCentavos);
}

function sumaONull(valores: (string | null)[]): string | null {
  const presentes = valores.filter((v): v is string => v !== null);
  return presentes.length ? desdeCentavos(presentes.reduce((s, v) => s + aCentavos(v), BigInt(0))) : null;
}

export async function guardarVentaFinanzas(empresaId: string, cuentaMlId: string, venta: VentaMl): Promise<ResultadoGuardarVenta> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [pedido] = await tx
      .insert(pedidos)
      .values({
        empresaId,
        cuentaMlId,
        pedidoIdExterno: venta.pedidoIdExterno,
        fecha: venta.fecha,
        total: venta.total,
        moneda: venta.moneda,
        estado: venta.estado,
      })
      .onConflictDoUpdate({ target: [pedidos.empresaId, pedidos.pedidoIdExterno], set: { estado: venta.estado } })
      .returning({ id: pedidos.id });
    const pedidoId = pedido.id;

    const [cabecera] = await tx
      .insert(pedidosFinanzas)
      .values({
        empresaId,
        pedidoId,
        cuentaMlId,
        formaEntrega: venta.formaEntrega,
        fechaPagoAprobado: venta.fechaPagoAprobado,
        valorVenta: venta.valorVenta,
        reembolsos: venta.reembolsos,
        comisionMl: venta.comisionMl,
        fleteMl: venta.fleteMl,
        cancelada: venta.cancelada,
        shipmentIdExterno: venta.shipmentIdExterno,
        packIdExterno: venta.packIdExterno,
        fechaDespacho: venta.fechaDespacho,
        fechaEntrega: venta.fechaEntrega,
      })
      .onConflictDoUpdate({
        target: pedidosFinanzas.pedidoId,
        set: {
          formaEntrega: venta.formaEntrega,
          valorVenta: venta.valorVenta,
          reembolsos: venta.reembolsos,
          comisionMl: venta.comisionMl,
          fleteMl: venta.fleteMl,
          cancelada: venta.cancelada,
          sincronizadoTs: new Date(),
          // Nunca se borra un dato que ML deje de mandar.
          fechaPagoAprobado: sql`coalesce(excluded.fecha_pago_aprobado, ${pedidosFinanzas.fechaPagoAprobado})`,
          shipmentIdExterno: sql`coalesce(excluded.shipment_id_externo, ${pedidosFinanzas.shipmentIdExterno})`,
          packIdExterno: sql`coalesce(excluded.pack_id_externo, ${pedidosFinanzas.packIdExterno})`,
          fechaDespacho: sql`coalesce(excluded.fecha_despacho, ${pedidosFinanzas.fechaDespacho})`,
          fechaEntrega: sql`coalesce(excluded.fecha_entrega, ${pedidosFinanzas.fechaEntrega})`,
        },
      })
      .returning({
        congeladoTs: pedidosFinanzas.congeladoTs,
        estadoCosteo: pedidosFinanzas.estadoCosteo,
        shipmentIdExterno: pedidosFinanzas.shipmentIdExterno,
        formaEntrega: pedidosFinanzas.formaEntrega,
      });

    await guardarLineas(tx, empresaId, pedidoId, venta);

    if (cabecera.congeladoTs) {
      return { pedidoId, estadoCosteo: cabecera.estadoCosteo, congelada: true, recienCongelada: false, alertas: [] };
    }
    return congelarSiCorresponde(tx, empresaId, pedidoId, cabecera.shipmentIdExterno, cabecera.formaEntrega);
  });
}

async function guardarLineas(tx: Tx, empresaId: string, pedidoId: string, venta: VentaMl): Promise<void> {
  if (venta.lineas.length === 0) return;
  const valores = venta.lineas.map((l) => desdeCentavos(aCentavos(l.precioUnitario) * BigInt(l.cantidad)));
  const pesos = valores.map(aCentavos);
  // Comisión y flete se reparten por peso entre las líneas (suma exacta).
  const comisiones = repartirONull(venta.comisionMl, pesos);
  const fletes = repartirONull(venta.fleteMl, pesos);

  const codigos = venta.lineas.map((l) => skuNormalizadoONull(l.skuCodigo));
  const codigosUnicos = [...new Set(codigos.filter((c): c is string => c !== null))];
  const enCatalogo = codigosUnicos.length
    ? await tx
        .select({ id: skus.id, codigo: sql<string>`upper(btrim(${skus.codigo}))` })
        .from(skus)
        .where(and(eq(skus.empresaId, empresaId), inArray(sql`upper(btrim(${skus.codigo}))`, codigosUnicos)))
    : [];
  const idsItems = [...new Set(venta.lineas.map((l) => l.itemIdExterno).filter(Boolean))];
  const enPublicaciones = idsItems.length
    ? await tx
        .select({ id: publicaciones.id, externo: publicaciones.publicacionIdExterno })
        .from(publicaciones)
        .where(and(eq(publicaciones.empresaId, empresaId), inArray(publicaciones.publicacionIdExterno, idsItems)))
    : [];
  const skuIdPorCodigo = new Map(enCatalogo.map((s) => [s.codigo, s.id]));
  const publicacionPorItem = new Map(enPublicaciones.map((p) => [p.externo, p.id]));

  for (const [i, linea] of venta.lineas.entries()) {
    const codigo = codigos[i];
    await tx
      .insert(pedidoItems)
      .values({
        empresaId,
        pedidoId,
        linea: i + 1,
        publicacionId: publicacionPorItem.get(linea.itemIdExterno) ?? null,
        itemIdExterno: linea.itemIdExterno,
        skuCodigo: codigo,
        skuId: codigo ? (skuIdPorCodigo.get(codigo) ?? null) : null,
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        valorLinea: valores[i],
        comisionMl: comisiones[i],
        fleteMl: fletes[i],
        titulo: linea.titulo,
        imagenUrl: linea.imagenUrl,
      })
      .onConflictDoUpdate({
        target: [pedidoItems.pedidoId, pedidoItems.linea],
        // Solo lo que ML sigue moviendo. Título e imagen quedan como
        // se guardaron la primera vez.
        set: { comisionMl: comisiones[i], fleteMl: fletes[i] },
      });
  }
}

async function leerMaestra(tx: Tx, empresaId: string, codigos: string[]): Promise<Map<string, MaestraSku>> {
  if (codigos.length === 0) return new Map();
  const filas = await tx
    .select({
      sku: costosSku.skuCodigo,
      costo: costosSku.costo,
      empaque: costosSku.empaque,
      envioAgencia: costosSku.envioAgencia,
      empaqueProveedor: terceros.empaque,
    })
    .from(costosSku)
    .leftJoin(terceros, and(eq(terceros.id, costosSku.terceroId), eq(terceros.empresaId, costosSku.empresaId)))
    .where(and(eq(costosSku.empresaId, empresaId), inArray(costosSku.skuCodigo, codigos)));
  return new Map(filas.map((f) => [f.sku, { costo: f.costo, empaque: f.empaque, envioAgencia: f.envioAgencia, empaqueProveedor: f.empaqueProveedor }]));
}

async function congelarSiCorresponde(
  tx: Tx,
  empresaId: string,
  pedidoId: string,
  shipmentIdExterno: string | null,
  formaEntrega: VentaMl["formaEntrega"]
): Promise<ResultadoGuardarVenta> {
  // Paquete = el envío. Entran las órdenes del mismo envío que tampoco
  // están congeladas; las ya congeladas solo aportan lo que ya cobraron.
  const hermanas = shipmentIdExterno
    ? await tx
        .select({ pedidoId: pedidosFinanzas.pedidoId, congeladoTs: pedidosFinanzas.congeladoTs, empaque: pedidosFinanzas.empaqueCongelado, envio: pedidosFinanzas.envioAgenciaCongelado })
        .from(pedidosFinanzas)
        .where(and(eq(pedidosFinanzas.empresaId, empresaId), eq(pedidosFinanzas.shipmentIdExterno, shipmentIdExterno), ne(pedidosFinanzas.pedidoId, pedidoId)))
    : [];
  const congeladas = hermanas.filter((h) => h.congeladoTs);
  const idsOrdenes = [pedidoId, ...hermanas.filter((h) => !h.congeladoTs).map((h) => h.pedidoId)];

  const lineas = await tx
    .select({ pedidoId: pedidoItems.pedidoId, linea: pedidoItems.linea, cantidad: pedidoItems.cantidad, valorLinea: pedidoItems.valorLinea, skuCodigo: pedidoItems.skuCodigo })
    .from(pedidoItems)
    .where(and(eq(pedidoItems.empresaId, empresaId), inArray(pedidoItems.pedidoId, idsOrdenes)))
    .orderBy(pedidoItems.linea);
  const ordenes: OrdenACongelar[] = idsOrdenes.map((id) => ({ pedidoId: id, lineas: lineas.filter((l) => l.pedidoId === id) }));

  const codigos = [...new Set(lineas.map((l) => l.skuCodigo).filter((c): c is string => c !== null))];
  const maestra = await leerMaestra(tx, empresaId, codigos);
  const [config] = await tx.select({ flexValor: configuracionFinanzas.flexValor }).from(configuracionFinanzas).where(eq(configuracionFinanzas.empresaId, empresaId));

  const resultado = congelarPaquete({
    formaEntrega,
    flexValor: config?.flexValor ?? null,
    maestra,
    ordenes,
    yaCobrado: congeladas.length
      ? { empaque: sumaONull(congeladas.map((c) => c.empaque)), envio: sumaONull(congeladas.map((c) => c.envio)) }
      : undefined,
  });

  const ahora = new Date();
  for (const orden of resultado.ordenes) {
    if (!orden.congelar) {
      await tx
        .update(pedidosFinanzas)
        .set({ estadoCosteo: orden.estadoCosteo })
        .where(and(eq(pedidosFinanzas.pedidoId, orden.pedidoId), isNull(pedidosFinanzas.congeladoTs)));
      continue;
    }
    const marcadas = await tx
      .update(pedidosFinanzas)
      .set({ estadoCosteo: "completo", empaqueCongelado: orden.empaque, envioAgenciaCongelado: orden.envio, congeladoTs: ahora })
      .where(and(eq(pedidosFinanzas.pedidoId, orden.pedidoId), isNull(pedidosFinanzas.congeladoTs)))
      .returning({ id: pedidosFinanzas.id });
    if (marcadas.length === 0) continue;
    for (const linea of orden.lineas) {
      await tx
        .update(pedidoItems)
        .set({ costoCongelado: linea.costo, empaqueCongelado: linea.empaque, envioCongelado: linea.envio })
        .where(and(eq(pedidoItems.pedidoId, orden.pedidoId), eq(pedidoItems.linea, linea.linea)));
    }
  }

  const propia = resultado.ordenes.find((o) => o.pedidoId === pedidoId)!;
  return {
    pedidoId,
    estadoCosteo: propia.estadoCosteo,
    congelada: propia.congelar,
    recienCongelada: propia.congelar,
    alertas: resultado.alertas,
  };
}

