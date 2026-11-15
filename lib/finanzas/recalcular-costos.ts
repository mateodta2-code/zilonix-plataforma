// Issue #130 (Z-FIN-08) — recálculo masivo del costo congelado
// (decisión de Sharel, pregunta 18). Lo usa la pantalla de #131.
//
// Las ventas congeladas no cambian solas al cambiar la maestra. Esto:
// 1. previsualiza, para las ventas de un SKU o de un rango de fechas
//    (pedidos.fecha), el costo congelado actual → el de la maestra hoy;
// 2. al confirmar, recalcula de nuevo dentro de la transacción y, si
//    coincide con lo que la persona vio, reescribe SOLO costo_congelado
//    (ni empaque, ni envío, ni comisión). Si algo cambió entre la vista
//    y la confirmación, no escribe nada (todo o nada).
//
// Una corrección manual activa de costo_producto (de la línea o de toda
// la orden) siempre gana: esa línea no se toca. Un SKU que hoy no tiene
// costo en la maestra tampoco: no se "des-costea" una venta.
// Cada venta cambiada deja una fila en auditoria (antes → después).
//
// SKU combo (Sharel, 29-oct-2026): el costo se resuelve con la misma
// regla del congelado (resolverCostoSku de combo-sku.ts), así BASEX2 sin
// fila exacta con costo toma BASE × 2. Filtrar por BASE trae también
// BASEX2 y BASEX3, para que un cambio del costo base alcance sus combos.

import { and, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { costosSku, pedidoItems, pedidos, pedidosFinanzas, ventasCorrecciones } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { normalizarSkuCodigo } from "@/lib/costos-sku";
import { requierePermiso } from "@/lib/permisos";
import { codigosParaMaestra, parsearComboSku, resolverCostoSku, type MaestraSku, type OrigenCosto } from "./combo-sku";
import { aCentavos, desdeCentavos } from "./utilidad-venta";

type Tx = typeof db;

export type FiltroRecalculo = { skuCodigo?: string; desde?: Date; hasta?: Date };

export type CambioCosto = {
  pedidoId: string;
  pedidoIdExterno: string;
  linea: number;
  skuCodigo: string;
  antes: string | null;
  despues: string;
  origen: OrigenCosto;
};

export type OmitidoRecalculo = {
  pedidoId: string;
  linea: number;
  skuCodigo: string | null;
  motivo: "correccion_manual" | "sin_costo_en_maestra";
};

export type VistaRecalculo = { cambios: CambioCosto[]; omitidos: OmitidoRecalculo[] };

export class FiltroRecalculoInvalidoError extends Error {
  constructor() {
    super("Elige un SKU o un rango de fechas para recalcular.");
    this.name = "FiltroRecalculoInvalidoError";
  }
}

export class RecalculoDesactualizadoError extends Error {
  constructor(readonly vista: VistaRecalculo) {
    super("Los costos cambiaron desde la vista previa. Revisa de nuevo antes de confirmar.");
    this.name = "RecalculoDesactualizadoError";
  }
}

async function calcularVista(tx: Tx, empresaId: string, filtro: FiltroRecalculo): Promise<VistaRecalculo> {
  const sku = filtro.skuCodigo !== undefined ? normalizarSkuCodigo(filtro.skuCodigo) : undefined;
  if (sku === undefined && !filtro.desde && !filtro.hasta) throw new FiltroRecalculoInvalidoError();

  const condiciones = [eq(pedidoItems.empresaId, empresaId), isNotNull(pedidosFinanzas.congeladoTs)];
  // El SKU y sus combos X2/X3, que pueden tomar su costo de él.
  if (sku !== undefined) condiciones.push(inArray(pedidoItems.skuCodigo, [sku, `${sku}X2`, `${sku}X3`]));
  if (filtro.desde) condiciones.push(gte(pedidos.fecha, filtro.desde));
  if (filtro.hasta) condiciones.push(lt(pedidos.fecha, filtro.hasta));

  const lineas = await tx
    .select({
      pedidoId: pedidoItems.pedidoId,
      pedidoIdExterno: pedidos.pedidoIdExterno,
      linea: pedidoItems.linea,
      skuCodigo: pedidoItems.skuCodigo,
      cantidad: pedidoItems.cantidad,
      costoCongelado: pedidoItems.costoCongelado,
    })
    .from(pedidoItems)
    .innerJoin(pedidosFinanzas, eq(pedidosFinanzas.pedidoId, pedidoItems.pedidoId))
    .innerJoin(pedidos, eq(pedidos.id, pedidoItems.pedidoId))
    .where(and(...condiciones))
    .orderBy(pedidos.fecha, pedidoItems.pedidoId, pedidoItems.linea);

  // Una sola lectura de la maestra: cada SKU y la base de los combos.
  const codigos = codigosParaMaestra([...new Set(lineas.flatMap((l) => (l.skuCodigo === null ? [] : [l.skuCodigo])))]);
  const filasMaestra = codigos.length
    ? await tx
        .select({ sku: costosSku.skuCodigo, costo: costosSku.costo })
        .from(costosSku)
        .where(and(eq(costosSku.empresaId, empresaId), inArray(costosSku.skuCodigo, codigos)))
    : [];
  // Solo importa el costo: el recálculo no toca empaque ni envío.
  const maestra = new Map<string, MaestraSku>(
    filasMaestra.map((f) => [f.sku, { costo: f.costo, empaque: null, empaqueProveedor: null, envioAgencia: null }])
  );

  const idsPedidos = [...new Set(lineas.map((l) => l.pedidoId))];
  const corregidas = idsPedidos.length
    ? await tx
        .select({ pedidoId: ventasCorrecciones.pedidoId, linea: ventasCorrecciones.linea })
        .from(ventasCorrecciones)
        .where(
          and(
            inArray(ventasCorrecciones.pedidoId, idsPedidos),
            eq(ventasCorrecciones.campo, "costo_producto"),
            isNull(ventasCorrecciones.anuladaTs)
          )
        )
    : [];
  const conCorreccion = (pedidoId: string, linea: number) => corregidas.some((c) => c.pedidoId === pedidoId && (c.linea === null || c.linea === linea));

  const vista: VistaRecalculo = { cambios: [], omitidos: [] };
  for (const l of lineas) {
    if (conCorreccion(l.pedidoId, l.linea)) {
      vista.omitidos.push({ pedidoId: l.pedidoId, linea: l.linea, skuCodigo: l.skuCodigo, motivo: "correccion_manual" });
      continue;
    }
    const { costoUnitario, origen } = resolverCostoSku(l.skuCodigo, maestra);
    if (l.skuCodigo === null || costoUnitario === null || origen === null) {
      vista.omitidos.push({ pedidoId: l.pedidoId, linea: l.linea, skuCodigo: l.skuCodigo, motivo: "sin_costo_en_maestra" });
      continue;
    }
    const despues = desdeCentavos(aCentavos(costoUnitario) * BigInt(l.cantidad));
    if (l.costoCongelado === despues) continue;
    vista.cambios.push({ pedidoId: l.pedidoId, pedidoIdExterno: l.pedidoIdExterno, linea: l.linea, skuCodigo: l.skuCodigo, antes: l.costoCongelado, despues, origen });
  }
  return vista;
}

// No escribe nada.
export async function previsualizarRecalculoCostos(empresaId: string, usuarioId: string, filtro: FiltroRecalculo): Promise<VistaRecalculo> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  return dbComoEmpresa(empresaId, (tx) => calcularVista(tx, empresaId, filtro));
}

// "BASEX2, costo de BASE × 2" para las que toman el costo de la base.
function etiquetaSku(c: Pick<CambioCosto, "skuCodigo" | "origen">): string {
  const combo = c.origen === "combo_base" ? parsearComboSku(c.skuCodigo) : null;
  return combo ? `${c.skuCodigo}, costo de ${combo.base} × ${combo.multiplicador}` : c.skuCodigo;
}

function claveCambio(c: Pick<CambioCosto, "pedidoId" | "linea" | "antes" | "despues">): string {
  return `${c.pedidoId}|${c.linea}|${c.antes ?? ""}|${c.despues}`;
}

// `vistos` = los cambios que la persona aprobó en la vista previa.
export async function confirmarRecalculoCostos(
  empresaId: string,
  usuarioId: string,
  filtro: FiltroRecalculo,
  vistos: Pick<CambioCosto, "pedidoId" | "linea" | "antes" | "despues">[]
): Promise<{ ventas: number; lineas: number }> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  return dbComoEmpresa(empresaId, async (tx) => {
    const vista = await calcularVista(tx, empresaId, filtro);
    const actuales = vista.cambios.map(claveCambio).sort();
    const esperados = vistos.map(claveCambio).sort();
    if (actuales.length !== esperados.length || actuales.some((c, i) => c !== esperados[i])) {
      throw new RecalculoDesactualizadoError(vista);
    }

    const porVenta = new Map<string, CambioCosto[]>();
    for (const cambio of vista.cambios) {
      const filas = await tx
        .update(pedidoItems)
        .set({ costoCongelado: cambio.despues })
        .where(
          and(
            eq(pedidoItems.pedidoId, cambio.pedidoId),
            eq(pedidoItems.linea, cambio.linea),
            cambio.antes === null ? isNull(pedidoItems.costoCongelado) : eq(pedidoItems.costoCongelado, cambio.antes)
          )
        )
        .returning({ id: pedidoItems.id });
      // Otra escritura se metió en el medio: se deshace todo.
      if (filas.length !== 1) throw new RecalculoDesactualizadoError(vista);
      porVenta.set(cambio.pedidoId, [...(porVenta.get(cambio.pedidoId) ?? []), cambio]);
    }

    for (const [pedidoId, cambios] of porVenta) {
      await registrarAuditoria(tx, {
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "recalcular_costo_congelado",
        entidad: "pedido_items",
        entidadId: pedidoId,
        valorAnterior: cambios.map((c) => `línea ${c.linea} (${c.skuCodigo}): ${c.antes ?? "sin costo"}`).join("; "),
        valorNuevo: cambios.map((c) => `línea ${c.linea} (${etiquetaSku(c)}): ${c.despues}`).join("; "),
        detalle: `Recálculo del costo congelado de la venta ${cambios[0].pedidoIdExterno} con la tabla maestra.`,
      });
    }
    return { ventas: porVenta.size, lineas: vista.cambios.length };
  });
}
