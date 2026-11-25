import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { dbComoBodega } from "@/db/bodega-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas3pl, bodegas3plEmpresas, despachoItemsBodega3pl, despachosBodega3pl, despachosMl, empresas, pedidoItems, pedidos, stockBodega3pl } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { registrarAuditoriaBodega } from "./auditoria";

export class DespachoBodegaError extends Error {}

export class StockInsuficienteError extends DespachoBodegaError {
  constructor(public readonly sku: string, public readonly pedido: string) {
    super(`No alcanza el stock del SKU ${sku} para preparar el pedido ${pedido}. No se descontó nada.`);
  }
}

export type LineaDespacho = { sku: string; cantidad: number };

// Suma los SKU repetidos y rechaza cantidades inválidas: el stock se
// descuenta por SKU y la tabla exige cantidad > 0.
export function agruparLineas(lineas: LineaDespacho[]): LineaDespacho[] {
  const acumulado = new Map<string, number>();
  for (const l of lineas) {
    const sku = l.sku.trim();
    if (!sku) throw new DespachoBodegaError("Hay un producto del pedido sin SKU: asígnale uno antes de enviarlo a la bodega.");
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) throw new DespachoBodegaError("Las cantidades deben ser enteros mayores que 0.");
    acumulado.set(sku, (acumulado.get(sku) ?? 0) + l.cantidad);
  }
  if (acumulado.size === 0) throw new DespachoBodegaError("El pedido no tiene productos para enviar.");
  return [...acumulado].map(([sku, cantidad]) => ({ sku, cantidad }));
}

// VENDEDOR: copia el pedido (solo número, tipo de envío, SKU y cantidad;
// nunca datos del comprador ni precios) a su bodega 3PL ligada y activa.
// Lee pedidos/pedido_items/despachos_ml con su propia empresa; la bodega
// jamás los lee. Un pedido se envía una sola vez (índice único). No llama
// a Mercado Libre.
export async function enviarPedidoABodega(empresaId: string, usuarioId: string, pedidoIdExterno: string): Promise<{ despachoId: string }> {
  const numero = pedidoIdExterno.trim();
  if (!numero) throw new DespachoBodegaError("Falta el número del pedido.");
  return dbComoEmpresa(empresaId, async (tx) => {
    const [vinculo] = await tx
      .select({ bodegaId: bodegas3plEmpresas.bodegaId })
      .from(bodegas3plEmpresas)
      .where(and(eq(bodegas3plEmpresas.empresaId, empresaId), eq(bodegas3plEmpresas.estado, "activa")))
      .orderBy(asc(bodegas3plEmpresas.creadoTs))
      .limit(1);
    if (!vinculo) throw new DespachoBodegaError("Tu empresa no tiene una bodega ligada y activa.");

    const [pedido] = await tx.select({ id: pedidos.id }).from(pedidos).where(and(eq(pedidos.empresaId, empresaId), eq(pedidos.pedidoIdExterno, numero)));
    if (!pedido) throw new DespachoBodegaError("No se encontró el pedido.");

    const lineas = agruparLineas(
      (await tx.select({ sku: pedidoItems.skuCodigo, cantidad: pedidoItems.cantidad }).from(pedidoItems).where(and(eq(pedidoItems.empresaId, empresaId), eq(pedidoItems.pedidoId, pedido.id)))).map((i) => ({ sku: i.sku ?? "", cantidad: i.cantidad }))
    );
    const [envio] = await tx.select({ tipo: despachosMl.logisticType }).from(despachosMl).where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.pedidoId, pedido.id))).limit(1);

    const despachoId = randomUUID();
    const insertado = await tx
      .insert(despachosBodega3pl)
      .values({ id: despachoId, bodegaId: vinculo.bodegaId, empresaId, pedidoId: pedido.id, numeroPedido: numero, tipoEnvio: envio?.tipo ?? null, creadoPor: usuarioId })
      .onConflictDoNothing()
      .returning({ id: despachosBodega3pl.id });
    if (insertado.length === 0) throw new DespachoBodegaError("Ese pedido ya se envió a la bodega.");
    await tx.insert(despachoItemsBodega3pl).values(lineas.map((l) => ({ despachoId, empresaId, sku: l.sku, cantidad: l.cantidad })));
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "despacho_bodega.enviar",
      entidad: "despacho_bodega_3pl",
      entidadId: despachoId,
      detalle: `Pedido ${numero} enviado a la bodega (${lineas.length} SKU).`,
    });
    return { despachoId };
  });
}

export type DespachoBodegaListado = {
  id: string;
  empresaId: string;
  empresaNombre: string;
  numeroPedido: string;
  tipoEnvio: string | null;
  estado: "pendiente" | "preparado";
  preparadoTs: Date | null;
  creadoTs: Date;
  lineas: LineaDespacho[];
};

// BODEGA: solo lo necesario para preparar. Las dos tablas no tienen
// columnas del comprador; la lista de columnas es explícita a propósito.
export async function listarDespachosBodega(bodegaId: string, filtro: { estado?: "pendiente" | "preparado"; empresaId?: string } = {}, limite = 200): Promise<DespachoBodegaListado[]> {
  return dbComoBodega(bodegaId, async (tx) => {
    const condiciones = [eq(despachosBodega3pl.bodegaId, bodegaId)];
    if (filtro.estado) condiciones.push(eq(despachosBodega3pl.estado, filtro.estado));
    if (filtro.empresaId) condiciones.push(eq(despachosBodega3pl.empresaId, filtro.empresaId));
    const cabeceras = await tx
      .select({
        id: despachosBodega3pl.id,
        empresaId: despachosBodega3pl.empresaId,
        empresaNombre: empresas.nombre,
        numeroPedido: despachosBodega3pl.numeroPedido,
        tipoEnvio: despachosBodega3pl.tipoEnvio,
        estado: despachosBodega3pl.estado,
        preparadoTs: despachosBodega3pl.preparadoTs,
        creadoTs: despachosBodega3pl.creadoTs,
      })
      .from(despachosBodega3pl)
      .innerJoin(empresas, eq(empresas.id, despachosBodega3pl.empresaId))
      .where(and(...condiciones))
      .orderBy(asc(despachosBodega3pl.estado), desc(despachosBodega3pl.creadoTs))
      .limit(limite);
    if (cabeceras.length === 0) return [];
    const items = await tx
      .select({ despachoId: despachoItemsBodega3pl.despachoId, sku: despachoItemsBodega3pl.sku, cantidad: despachoItemsBodega3pl.cantidad })
      .from(despachoItemsBodega3pl)
      .where(inArray(despachoItemsBodega3pl.despachoId, cabeceras.map((c) => c.id)))
      .orderBy(asc(despachoItemsBodega3pl.sku));
    const porDespacho = new Map<string, LineaDespacho[]>();
    for (const i of items) porDespacho.set(i.despachoId, [...(porDespacho.get(i.despachoId) ?? []), { sku: i.sku, cantidad: i.cantidad }]);
    return cabeceras.map((c) => ({ ...c, lineas: porDespacho.get(c.id) ?? [] }));
  });
}

// BODEGA: marca «preparado» y descuenta stock en UNA transacción. El paso
// de pendiente→preparado es un UPDATE condicionado al estado (y RLS lo
// repite), así que dos clics a la vez descuentan una sola vez. Cada SKU se
// descuenta con `cantidad >= n`: si algún SKU no alcanza se lanza el error
// y la transacción entera se revierte (ni estado ni stock ni auditoría).
export async function marcarPreparado(bodegaId: string, usuarioId: string, despachoId: string, rol: string): Promise<void> {
  await dbComoBodega(
    bodegaId,
    async (tx) => {
      const [cabecera] = await tx
        .select({ empresaId: despachosBodega3pl.empresaId, numeroPedido: despachosBodega3pl.numeroPedido, estado: despachosBodega3pl.estado })
        .from(despachosBodega3pl)
        .where(and(eq(despachosBodega3pl.id, despachoId), eq(despachosBodega3pl.bodegaId, bodegaId)));
      if (!cabecera) throw new DespachoBodegaError("No se encontró el despacho.");
      if (cabecera.estado === "preparado") throw new DespachoBodegaError("Ese despacho ya estaba preparado.");

      const marcado = await tx
        .update(despachosBodega3pl)
        .set({ estado: "preparado", preparadoTs: new Date(), preparadoPor: usuarioId })
        .where(and(eq(despachosBodega3pl.id, despachoId), eq(despachosBodega3pl.estado, "pendiente")))
        .returning({ id: despachosBodega3pl.id });
      if (marcado.length === 0) throw new DespachoBodegaError("Ese despacho ya estaba preparado, o la empresa ya no está activa en esta bodega.");

      const items = await tx
        .select({ sku: despachoItemsBodega3pl.sku, cantidad: despachoItemsBodega3pl.cantidad })
        .from(despachoItemsBodega3pl)
        .where(eq(despachoItemsBodega3pl.despachoId, despachoId));
      for (const l of agruparLineas(items)) {
        const descontado = await tx
          .update(stockBodega3pl)
          .set({ cantidad: sql`${stockBodega3pl.cantidad} - ${l.cantidad}` })
          .where(and(eq(stockBodega3pl.bodegaId, bodegaId), eq(stockBodega3pl.empresaId, cabecera.empresaId), eq(stockBodega3pl.sku, l.sku), sql`${stockBodega3pl.cantidad} >= ${l.cantidad}`))
          .returning({ id: stockBodega3pl.id });
        if (descontado.length === 0) throw new StockInsuficienteError(l.sku, cabecera.numeroPedido);
      }
      const unidades = items.reduce((s, i) => s + i.cantidad, 0);
      await registrarAuditoriaBodega(tx, {
        bodegaId,
        empresaId: cabecera.empresaId,
        usuarioId,
        accion: "bodega.despacho.preparar",
        entidad: "despacho_bodega_3pl",
        entidadId: despachoId,
        valorAnterior: "pendiente",
        valorNuevo: "preparado",
        detalle: `Pedido ${cabecera.numeroPedido} preparado (${items.length} SKU, ${unidades} unidades). Stock descontado.`,
      });
    },
    rol
  );
}

export type DespachoBodegaDePedido = { numeroPedido: string; estado: "pendiente" | "preparado"; preparadoTs: Date | null; bodegaNombre: string };

// VENDEDOR: qué pedidos ya envió a la bodega y cuáles preparó (RLS por empresa).
export async function listarDespachosBodegaDePedidos(empresaId: string, numeros: string[]): Promise<DespachoBodegaDePedido[]> {
  if (numeros.length === 0) return [];
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ numeroPedido: despachosBodega3pl.numeroPedido, estado: despachosBodega3pl.estado, preparadoTs: despachosBodega3pl.preparadoTs, bodegaNombre: bodegas3pl.nombre })
      .from(despachosBodega3pl)
      .innerJoin(bodegas3pl, eq(bodegas3pl.id, despachosBodega3pl.bodegaId))
      .where(and(eq(despachosBodega3pl.empresaId, empresaId), inArray(despachosBodega3pl.numeroPedido, numeros)))
  );
}
