import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { costosSku, cuentasFalabella, movimientosMarketplace, pedidosFalabella, terceros } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { normalizarSkuCodigo } from "@/lib/sku-normalizar";
import { codigosParaMaestra, type MaestraSku } from "./combo-sku";
import { calcularUtilidadFalabella, type ResultadoUtilidadFalabella } from "./utilidad-falabella";

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

export type CuentaFalabellaSelector = { id: string; nickname: string; desconectada: boolean };

// También las desconectadas: sus ventas viejas siguen siendo plata real.
export async function listarCuentasFalabellaParaSelector(empresaId: string): Promise<CuentaFalabellaSelector[]> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: cuentasFalabella.id, nickname: cuentasFalabella.nickname, desconectadaTs: cuentasFalabella.desconectadaTs })
      .from(cuentasFalabella)
      .orderBy(asc(cuentasFalabella.nickname))
  );
  return filas.map((f) => ({ id: f.id, nickname: f.nickname, desconectada: f.desconectadaTs !== null }));
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
      .select({ cuentaId: m.cuentaFalabellaId, numeroOrden: m.numeroOrden, sku: m.sku, categoria: m.categoria, monto: m.monto, moneda: m.moneda })
      .from(m)
      .where(
        and(
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

    const skus = new Set<string>();
    for (const mov of movimientos) {
      if (mov.categoria !== "precio" || !mov.sku) continue;
      try {
        skus.add(normalizarSkuCodigo(mov.sku));
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
              costo: costosSku.costo,
              empaque: costosSku.empaque,
              envioAgencia: costosSku.envioAgencia,
              empaqueProveedor: terceros.empaque,
            })
            .from(costosSku)
            .leftJoin(terceros, and(eq(terceros.id, costosSku.terceroId), eq(terceros.empresaId, costosSku.empresaId)))
            .where(and(eq(costosSku.empresaId, empresaId), inArray(costosSku.skuCodigo, codigos)));
    const maestra = new Map<string, MaestraSku>(
      filasMaestra.map((f) => [f.sku, { costo: f.costo, empaque: f.empaque, envioAgencia: f.envioAgencia, empaqueProveedor: f.empaqueProveedor }])
    );

    const resultado = calcularUtilidadFalabella({
      pedidos: pedidos.map((x) => ({
        pedidoId: x.id,
        numeros: [x.pedidoIdExterno, x.numeroOrden].filter((n): n is string => !!n),
        // Se muestra el número que ve el cliente; el OrderId, en gris.
        numeroVisible: x.numeroOrden ?? x.pedidoIdExterno,
        numeroInterno: x.numeroOrden ? x.pedidoIdExterno : null,
        cuentaId: x.cuentaId,
        cuenta: x.cuenta,
        fecha: x.fecha,
        moneda: x.moneda,
      })),
      movimientos: movimientos
        .filter((mov): mov is typeof mov & { cuentaId: string } => mov.cuentaId !== null)
        .map((mov) => ({ cuentaId: mov.cuentaId, numeroOrden: mov.numeroOrden, sku: mov.sku, categoria: mov.categoria, monto: mov.monto })),
      maestra,
    });
    return { ok: true, moneda: monedaFinal, resultado, recortado };
  });
}
