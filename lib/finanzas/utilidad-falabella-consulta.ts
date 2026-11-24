import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { costosSku, cuentasFalabella, movimientosMarketplace, pedidosFalabella, terceros } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { normalizarSkuCodigo } from "@/lib/sku-normalizar";
import { codigosParaMaestra } from "./combo-sku";
import { esProveedorDirecto } from "./envio-falabella";
import {
  calcularUtilidadFalabella,
  construirMaestraFalabella,
  construirReferenciasEstimacionFalabella,
  type ItemApiFalabella,
  type ResultadoUtilidadFalabella,
} from "./utilidad-falabella";

// Issue #422 — lecturas para la utilidad de Falabella (Finanzas → Ventas
// y utilidad, marketplace Falabella). Sin tablas nuevas: pedidos_falabella
// (órdenes de la API), movimientos_marketplace (cobros del reporte de
// transacciones) y costos_sku (la maestra que ya usa ML). Todo con RLS de
// la empresa (dbComoEmpresa) y finanzas.consultar también acá, para quien
// llame sin pasar por app/.

// Órdenes que no son venta. Mismos nombres de estado que guarda
// lib/falabella/pedidos.ts (Statuses de GetOrders v2).
const ESTADOS_QUE_NO_SON_VENTA = ["canceled", "failed"];

// Tope de órdenes por consulta: el rango ya es de máximo 31 días.
export const TOPE_ORDENES_UTILIDAD = 3000;

// Historial para estimar órdenes sin reporte: los últimos 120 días de
// cobros con Nº de orden, con tope de filas para no cargar años enteros.
const DIAS_HISTORIAL_ESTIMACION = 120;
const TOPE_MOVIMIENTOS_ESTIMACION = 20000;

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

// `items` es el JSONB de GetOrderItems tal como lo guarda
// lib/falabella/pedidos.ts (ItemPrice/PaidPrice ya normalizados a
// "78000.00"). Se lee a la defensiva: un campo que falta nunca rompe la
// pantalla. El precio es ItemPrice (el «Precio producto» del reporte) y,
// si no viene, PaidPrice.
export function parsearItemsApiFalabella(items: unknown): ItemApiFalabella[] {
  const lista = Array.isArray(items) ? items : items && typeof items === "object" ? [items] : [];
  const salida: ItemApiFalabella[] = [];
  for (const crudo of lista) {
    if (!crudo || typeof crudo !== "object") continue;
    const item = crudo as Record<string, unknown>;
    const estado = (texto(item.Status) ?? "").toLowerCase();
    if (ESTADOS_QUE_NO_SON_VENTA.includes(estado)) continue;
    // Campos de envío tal cual: la regla vive en clasificarEnvioFalabella.
    const envio = {
      tipoEnvio: texto(item.ShippingType),
      proveedor: texto(item.ShipmentProvider),
      tipoProveedor: texto(item.ShippingProviderType),
    };
    salida.push({
      sku: texto(item.Sku),
      nombre: texto(item.Name),
      precio: texto(item.ItemPrice) ?? texto(item.PaidPrice) ?? "0.00",
      ...envio,
      envioPropio: esProveedorDirecto(envio),
    });
  }
  return salida;
}

export type CuentaFalabellaSelector = {
  id: string;
  nickname: string;
  desconectada: boolean;
  // Respaldo para estimar cuentas sin reportes (issue #422).
  comisionPct: string | null;
  flete: string | null;
};

// También las desconectadas: sus ventas viejas siguen siendo plata real.
export async function listarCuentasFalabellaParaSelector(empresaId: string): Promise<CuentaFalabellaSelector[]> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: cuentasFalabella.id,
        nickname: cuentasFalabella.nickname,
        desconectadaTs: cuentasFalabella.desconectadaTs,
        comisionPct: cuentasFalabella.comisionDefectoPct,
        flete: cuentasFalabella.fleteDefecto,
      })
      .from(cuentasFalabella)
      .where(eq(cuentasFalabella.empresaId, empresaId))
      .orderBy(asc(cuentasFalabella.nickname))
  );
  return filas.map((f) => ({ id: f.id, nickname: f.nickname, desconectada: f.desconectadaTs !== null, comisionPct: f.comisionPct, flete: f.flete }));
}

export type FiltroUtilidadFalabella = {
  // null = todas. Tiene que venir de listarCuentasFalabellaParaSelector.
  cuentaId: string | null;
  // Días de Bogotá (AAAA-MM-DD) y sus límites en UTC (resolverRangoVentas).
  desde: string;
  hasta: string;
  inicio: Date;
  finExclusivo: Date;
};

export type ResultadoConsultaUtilidadFalabella =
  | { ok: true; moneda: string | null; resultado: ResultadoUtilidadFalabella; recortado: boolean }
  | { ok: false; error: string };

export async function listarUtilidadFalabella(
  empresaId: string,
  usuarioId: string,
  filtro: FiltroUtilidadFalabella
): Promise<ResultadoConsultaUtilidadFalabella> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const p = pedidosFalabella;
  const m = movimientosMarketplace;

  return dbComoEmpresa(empresaId, async (tx) => {
    const pedidos = await tx
      .select({
        id: p.id,
        pedidoIdExterno: p.pedidoIdExterno,
        // Issue #422: el «Nº de orden» del reporte es el OrderNumber de
        // GetOrders (columna numero_orden), no el OrderId. Se busca por
        // los dos: el OrderId queda de respaldo para filas que todavía no
        // tienen numero_orden (importadas antes de la columna).
        numeroOrden: p.numeroOrden,
        cuentaId: p.cuentaFalabellaId,
        cuenta: cuentasFalabella.nickname,
        fecha: p.fecha,
        moneda: p.moneda,
        items: p.items,
        costoManual: p.costoManual,
        fleteManual: p.fleteManual,
      })
      .from(p)
      .innerJoin(cuentasFalabella, eq(cuentasFalabella.id, p.cuentaFalabellaId))
      .where(
        and(
          gte(p.fecha, filtro.inicio),
          lt(p.fecha, filtro.finExclusivo),
          notInArray(p.estado, ESTADOS_QUE_NO_SON_VENTA),
          filtro.cuentaId ? eq(p.cuentaFalabellaId, filtro.cuentaId) : undefined
        )
      )
      .orderBy(desc(p.fecha))
      .limit(TOPE_ORDENES_UTILIDAD + 1);
    const recortado = pedidos.length > TOPE_ORDENES_UTILIDAD;
    if (recortado) pedidos.pop();

    const monedas = new Set(pedidos.map((x) => x.moneda));
    if (monedas.size > 1) {
      return { ok: false, error: "Las órdenes de este filtro están en más de una moneda. Elige una sola cuenta de Falabella." };
    }
    const moneda = pedidos[0]?.moneda ?? null;

    const numeros = [...new Set(pedidos.flatMap((x) => [x.pedidoIdExterno, x.numeroOrden].filter((n): n is string => !!n)))];
    const movimientos = await tx
      .select({
        cuentaId: m.cuentaFalabellaId,
        numeroOrden: m.numeroOrden,
        sku: m.sku,
        categoria: m.categoria,
        monto: m.monto,
        moneda: m.moneda,
        tipoTransaccion: m.tipoTransaccion,
      })
      .from(m)
      .where(
        and(
          eq(m.empresaId, empresaId),
          eq(m.marketplace, "falabella"),
          filtro.cuentaId ? eq(m.cuentaFalabellaId, filtro.cuentaId) : undefined,
          moneda ? eq(m.moneda, moneda) : undefined,
          or(
            numeros.length > 0 ? inArray(m.numeroOrden, numeros) : sql`false`,
            // Publicidad y servicios sin orden: por fecha de transacción.
            and(isNull(m.numeroOrden), gte(m.fechaTransaccion, filtro.desde), lte(m.fechaTransaccion, filtro.hasta))
          )
        )
      );

    // Sin órdenes en el rango igual puede haber publicidad del periodo.
    const monedasMovimientos = new Set(movimientos.map((x) => x.moneda));
    if (!moneda && monedasMovimientos.size > 1) {
      return { ok: false, error: "Los cobros de este filtro están en más de una moneda. Elige una sola cuenta de Falabella." };
    }
    const monedaFinal = moneda ?? [...monedasMovimientos][0] ?? null;

    const itemsPorPedido = new Map(pedidos.map((x) => [x.id, parsearItemsApiFalabella(x.items)]));

    // Historial de la misma empresa (y cuenta, si se filtró) para estimar
    // las órdenes que todavía no tienen reporte. Del más reciente al más
    // viejo: construirReferenciasEstimacionFalabella toma el primero de
    // cada SKU como su último reporte.
    const desdeHistorial = new Date(filtro.finExclusivo.getTime() - DIAS_HISTORIAL_ESTIMACION * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const historial = await tx
      .select({
        cuentaId: m.cuentaFalabellaId,
        numeroOrden: m.numeroOrden,
        sku: m.sku,
        categoria: m.categoria,
        monto: m.monto,
        tipoTransaccion: m.tipoTransaccion,
      })
      .from(m)
      .where(
        and(
          eq(m.empresaId, empresaId),
          eq(m.marketplace, "falabella"),
          isNotNull(m.numeroOrden),
          inArray(m.categoria, ["precio", "comision", "envio"]),
          gte(m.fechaTransaccion, desdeHistorial),
          filtro.cuentaId ? eq(m.cuentaFalabellaId, filtro.cuentaId) : undefined,
          moneda ? eq(m.moneda, moneda) : undefined
        )
      )
      .orderBy(desc(m.fechaTransaccion), desc(m.numeroOrden))
      .limit(TOPE_MOVIMIENTOS_ESTIMACION);
    const referenciasEstimacion = construirReferenciasEstimacionFalabella(
      historial
        .filter((mov): mov is typeof mov & { cuentaId: string } => mov.cuentaId !== null)
        .map((mov) => ({ ...mov, cuentaId: mov.cuentaId }))
    );

    // SKU del reporte y de los ítems de la API (para costear las órdenes
    // que todavía no tienen reporte).
    const skus = new Set<string>();
    const skusCrudos = [
      ...movimientos.filter((mov) => mov.categoria === "precio").map((mov) => mov.sku),
      ...[...itemsPorPedido.values()].flat().map((i) => i.sku),
    ];
    for (const sku of skusCrudos) {
      if (!sku) continue;
      try {
        skus.add(normalizarSkuCodigo(sku));
      } catch {
        // SKU vacío: queda como «Falta costo» en el motor.
      }
    }
    const codigos = codigosParaMaestra([...skus]);
    const filasMaestra =
      codigos.length === 0
        ? []
        : await tx
            .select({
              sku: costosSku.skuCodigo,
              skuFalabella: costosSku.skuFalabella,
              costo: costosSku.costo,
              empaque: costosSku.empaque,
              envioAgencia: costosSku.envioAgencia,
              empaqueProveedor: terceros.empaque,
            })
            .from(costosSku)
            .leftJoin(terceros, and(eq(terceros.id, costosSku.terceroId), eq(terceros.empresaId, costosSku.empresaId)))
            .where(
              and(
                eq(costosSku.empresaId, empresaId),
                // Por el código de la maestra o por su alias de Falabella
                // (ambos ya normalizados en la base).
                or(inArray(costosSku.skuCodigo, codigos), inArray(costosSku.skuFalabella, codigos))
              )
            );
    // Coincidencia exacta en sku_codigo primero; el alias, de respaldo.
    const maestra = construirMaestraFalabella(filasMaestra);

    // Respaldo por cuenta para estimar cuentas nuevas sin reportes.
    const cuentasIds = [...new Set(pedidos.map((x) => x.cuentaId))];
    const filasDefectos =
      cuentasIds.length === 0
        ? []
        : await tx
            .select({ id: cuentasFalabella.id, comisionPct: cuentasFalabella.comisionDefectoPct, flete: cuentasFalabella.fleteDefecto })
            .from(cuentasFalabella)
            .where(and(eq(cuentasFalabella.empresaId, empresaId), inArray(cuentasFalabella.id, cuentasIds)));
    const defectosCuenta = new Map(filasDefectos.map((f) => [f.id, { comisionPct: f.comisionPct, flete: f.flete }]));

    const resultado = calcularUtilidadFalabella({
      pedidos: pedidos.map((x) => ({
        pedidoId: x.id,
        // En orden de prioridad: OrderNumber y, de respaldo, el OrderId.
        numeros: [x.numeroOrden, x.pedidoIdExterno].filter((n): n is string => !!n),
        // Se muestra el número que ve el cliente; el OrderId, en gris.
        numeroVisible: x.numeroOrden ?? x.pedidoIdExterno,
        numeroInterno: x.numeroOrden ? x.pedidoIdExterno : null,
        cuentaId: x.cuentaId,
        cuenta: x.cuenta,
        fecha: x.fecha,
        moneda: x.moneda,
        itemsApi: itemsPorPedido.get(x.id) ?? [],
        costoManual: x.costoManual,
        fleteManual: x.fleteManual,
      })),
      movimientos: movimientos
        .filter((mov): mov is typeof mov & { cuentaId: string } => mov.cuentaId !== null)
        .map((mov) => ({
          cuentaId: mov.cuentaId,
          numeroOrden: mov.numeroOrden,
          sku: mov.sku,
          categoria: mov.categoria,
          monto: mov.monto,
          tipoTransaccion: mov.tipoTransaccion,
        })),
      maestra,
      referenciasEstimacion,
      defectosCuenta,
    });
    return { ok: true, moneda: monedaFinal, resultado, recortado };
  });
}
