// Optimización, Fase 2 — datos del detalle de una publicación. Sin
// tablas nuevas:
// - Ventas: pedidos + pedido_items de esa publicación (brutas incluye
//   canceladas; concretadas, el criterio de Finanzas).
// - Costos y utilidad por línea: el MISMO motor de "Ventas y utilidad"
//   (armarVentaEntrada + calcularUtilidadVenta), así la ganancia cuadra
//   con Finanzas. Solo si quien mira tiene permiso de Finanzas.
// - Publicidad: publicidad_metricas_diarias de nivel "anuncio".
// - Visitas por día: Mercado Libre (hasta 150 días hacia atrás).

import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidoItems, pedidos, pedidosFinanzas, publicidadMetricasDiarias, ventasCorrecciones } from "@/db/schema";
import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import { aCentavos, CAMPOS_CORREGIBLES, calcularUtilidadVenta, desdeCentavos, diaBogota, EntradaUtilidadInvalidaError, type CampoCorregible } from "@/lib/finanzas/utilidad-venta";
import { armarVentaEntrada, type CabeceraVentaFila } from "@/lib/finanzas/ventas-pantalla";
import { limitesDiaBogota } from "@/lib/filtros-listado";
import { leerItemsOptimizacionMl, MAXIMO_DIAS_VISITAS, visitasPorDiaMl, type ItemOptimizacionMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import type { CostosLinea, DiaPublicidad, LineaVendida } from "@/lib/optimizacion/calculos";
import type { PeriodoDetalle } from "@/lib/optimizacion/periodo";
import { hoyBogota } from "@/lib/publicidad/plan";

export type DatosDetalle = {
  item: ItemOptimizacionMl;
  lineas: LineaVendida[];
  publicidad: DiaPublicidad[];
  visitasPorDia: Map<string, number> | null;
  // Primer día cubierto por las visitas (hoy − 149).
  visitasDesde: string;
};

function esCampoCorregible(campo: string): campo is CampoCorregible {
  return (CAMPOS_CORREGIBLES as readonly string[]).includes(campo);
}

export async function leerDatosDetalle(
  empresaId: string,
  cuenta: { id: string },
  itemId: string,
  periodo: PeriodoDetalle,
  opciones: { conFinanzas: boolean; ahora: Date }
): Promise<DatosDetalle | null> {
  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
  const [item] = await leerItemsOptimizacionMl([itemId], token);
  if (!item) return null;

  // Toda la historia de la publicación hasta hoy (no solo el período):
  // la tarjeta «Utilidad total» suma todo lo vendido. Los resúmenes del
  // período filtran por fecha en resumirPeriodo.
  const hoy = hoyBogota(opciones.ahora);
  const ultimoDia = periodo.hasta > hoy ? periodo.hasta : hoy;
  const fin = limitesDiaBogota(ultimoDia)?.finExclusivo;
  if (!fin) return null;

  const { filas, cabeceras, lineasPedido, correcciones, publicidad } = await dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({
        pedidoId: pedidos.id,
        fecha: pedidos.fecha,
        estado: pedidos.estado,
        cancelada: pedidosFinanzas.cancelada,
        conFoto: pedidosFinanzas.pedidoId,
        linea: pedidoItems.linea,
        cantidad: pedidoItems.cantidad,
        valor: pedidoItems.valorLinea,
      })
      .from(pedidoItems)
      .innerJoin(pedidos, and(eq(pedidos.id, pedidoItems.pedidoId), eq(pedidos.empresaId, pedidoItems.empresaId)))
      .leftJoin(pedidosFinanzas, and(eq(pedidosFinanzas.empresaId, pedidos.empresaId), eq(pedidosFinanzas.pedidoId, pedidos.id)))
      .where(
        and(
          eq(pedidoItems.empresaId, empresaId),
          eq(pedidos.cuentaMlId, cuenta.id),
          eq(pedidoItems.itemIdExterno, itemId),
          lt(pedidos.fecha, fin)
        )
      );

    // Para la utilidad hace falta la venta COMPLETA (todas sus líneas):
    // el motor reparte comisión, flete, empaque y envío del paquete.
    const conFoto = opciones.conFinanzas
      ? [...new Set(filas.filter((f) => f.conFoto !== null && !ESTADOS_QUE_NO_SON_VENTA.includes(f.estado) && f.cancelada === false).map((f) => f.pedidoId))]
      : [];
    const cabeceras =
      conFoto.length === 0
        ? []
        : await tx
            .select({
              pedidoId: pedidosFinanzas.pedidoId,
              cuentaMlId: pedidosFinanzas.cuentaMlId,
              formaEntrega: pedidosFinanzas.formaEntrega,
              fechaPagoAprobado: pedidosFinanzas.fechaPagoAprobado,
              valorVenta: pedidosFinanzas.valorVenta,
              comisionMl: pedidosFinanzas.comisionMl,
              fleteMl: pedidosFinanzas.fleteMl,
              empaqueCongelado: pedidosFinanzas.empaqueCongelado,
              envioAgenciaCongelado: pedidosFinanzas.envioAgenciaCongelado,
              fechaCreacion: pedidos.fecha,
            })
            .from(pedidosFinanzas)
            .innerJoin(pedidos, and(eq(pedidos.id, pedidosFinanzas.pedidoId), eq(pedidos.empresaId, pedidosFinanzas.empresaId)))
            .where(and(eq(pedidosFinanzas.empresaId, empresaId), inArray(pedidosFinanzas.pedidoId, conFoto)));
    const lineasPedido =
      conFoto.length === 0
        ? []
        : await tx
            .select({
              pedidoId: pedidoItems.pedidoId,
              linea: pedidoItems.linea,
              cantidad: pedidoItems.cantidad,
              valorLinea: pedidoItems.valorLinea,
              costoCongelado: pedidoItems.costoCongelado,
              empaqueCongelado: pedidoItems.empaqueCongelado,
              envioCongelado: pedidoItems.envioCongelado,
            })
            .from(pedidoItems)
            .where(and(eq(pedidoItems.empresaId, empresaId), inArray(pedidoItems.pedidoId, conFoto)));
    const correcciones =
      conFoto.length === 0
        ? []
        : await tx
            .select({
              pedidoId: ventasCorrecciones.pedidoId,
              linea: ventasCorrecciones.linea,
              campo: ventasCorrecciones.campo,
              valorNuevo: ventasCorrecciones.valorNuevo,
              anuladaTs: ventasCorrecciones.anuladaTs,
            })
            .from(ventasCorrecciones)
            .where(and(eq(ventasCorrecciones.empresaId, empresaId), inArray(ventasCorrecciones.pedidoId, conFoto)));

    const publicidad = await tx
      .select({ dia: publicidadMetricasDiarias.fecha, costo: publicidadMetricasDiarias.costo, monto: publicidadMetricasDiarias.montoTotal })
      .from(publicidadMetricasDiarias)
      .where(
        and(
          eq(publicidadMetricasDiarias.empresaId, empresaId),
          eq(publicidadMetricasDiarias.cuentaMlId, cuenta.id),
          eq(publicidadMetricasDiarias.nivel, "anuncio"),
          eq(publicidadMetricasDiarias.entidadIdMl, itemId),
          lte(publicidadMetricasDiarias.fecha, ultimoDia)
        )
      );
    return { filas, cabeceras, lineasPedido, correcciones, publicidad };
  });

  // Utilidad por línea con el motor de Finanzas; una venta que el motor
  // rechaza queda sin costos (la ganancia del período sale "—").
  const costosPorLinea = new Map<string, CostosLinea>();
  for (const cabecera of cabeceras) {
    const lineasVenta = lineasPedido.filter((l) => l.pedidoId === cabecera.pedidoId);
    const corr = correcciones
      .filter((c) => c.pedidoId === cabecera.pedidoId && esCampoCorregible(c.campo))
      .map((c) => ({ linea: c.linea, campo: c.campo as CampoCorregible, valorNuevo: c.valorNuevo, anuladaTs: c.anuladaTs }));
    try {
      const { entrada } = armarVentaEntrada(cabecera as CabeceraVentaFila, lineasVenta, corr);
      const resultado = calcularUtilidadVenta(entrada);
      for (const l of resultado.lineas) {
        costosPorLinea.set(`${cabecera.pedidoId}:${l.linea}`, {
          comision: l.comision_ml.valor,
          envio: desdeCentavos(aCentavos(l.flete_ml.valor) + aCentavos(l.envio.valor)),
          costoProducto: l.costo_producto?.valor ?? null,
          empaque: l.empaque.valor,
          utilidad: l.utilidad,
        });
      }
    } catch (error) {
      if (!(error instanceof EntradaUtilidadInvalidaError)) throw error;
    }
  }

  const lineas: LineaVendida[] = filas.map((f) => ({
    pedidoId: f.pedidoId,
    dia: diaBogota(f.fecha),
    cantidad: f.cantidad,
    valor: f.valor,
    valida: !ESTADOS_QUE_NO_SON_VENTA.includes(f.estado) && f.cancelada !== true,
    costos: costosPorLinea.get(`${f.pedidoId}:${f.linea}`) ?? null,
  }));

  // Visitas: una sola llamada con los 150 días que da Mercado Libre. Cubre
  // el período elegido, el anterior y la bitácora (semana antes y después
  // de cada cambio).
  const ultimos = MAXIMO_DIAS_VISITAS;
  const visitasPorDia = await visitasPorDiaMl(itemId, token, ultimos).catch(() => null);
  const visitasDesde = new Date(Date.parse(`${hoy}T00:00:00Z`) - (ultimos - 1) * 86_400_000).toISOString().slice(0, 10);

  return {
    item,
    lineas,
    publicidad: publicidad.map((p) => ({ dia: p.dia, inversion: p.costo ?? "0.00", ingresos: p.monto ?? "0.00" })),
    visitasPorDia,
    visitasDesde,
  };
}
