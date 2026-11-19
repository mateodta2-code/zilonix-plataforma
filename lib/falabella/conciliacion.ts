import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasFalabella, movimientosMarketplace, type CategoriaMovimiento } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoDeNombre, TAMANO_MAXIMO_ARCHIVO } from "@/lib/importar-archivo";
import { requierePermiso } from "@/lib/permisos";
import { leerReporteTransacciones, type LineaNoReconocida } from "./reporte-transacciones";

// Issue #422 — importar el «Reporte de transacciones» de Falabella y
// leerlo para la pantalla de conciliación (Finanzas → Conciliación
// Falabella). requierePermiso va acá además de en la acción/página, para
// quien llame estas funciones sin pasar por app/.

export class ReporteFalabellaInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ReporteFalabellaInvalidoError";
  }
}

export type ResultadoImportacionReporte = {
  cuenta: string;
  nuevas: number;
  repetidas: number;
  noReconocidas: LineaNoReconocida[];
  // Tipos de transacción que entraron como «otro»: se guardan, pero hay
  // que revisar si Falabella sumó un cobro nuevo.
  tiposSinCategoria: string[];
};

const TAMANO_LOTE = 500;

export async function importarReporteFalabella(
  empresaId: string,
  usuarioId: string,
  archivo: { nombre: string; contenido: Buffer }
): Promise<ResultadoImportacionReporte> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");

  if (formatoDeNombre(archivo.nombre) !== "xlsx") {
    throw new ReporteFalabellaInvalidoError("Sube el reporte en .xlsx, tal como lo descargas de Falabella Seller Center.");
  }
  if (archivo.contenido.length > TAMANO_MAXIMO_ARCHIVO) {
    throw new ReporteFalabellaInvalidoError(`El archivo supera el tamaño máximo de ${TAMANO_MAXIMO_ARCHIVO / (1024 * 1024)} MB.`);
  }
  const reporte = leerReporteTransacciones(archivo.contenido);
  if (!reporte.ok) throw new ReporteFalabellaInvalidoError(reporte.mensaje);
  if (reporte.lineas.length === 0) throw new ReporteFalabellaInvalidoError("El reporte no tiene líneas que se puedan leer.");
  // Un reporte es de una sola cuenta: si mezcla Seller ID, algo raro
  // pasó con el archivo y no se adivina a cuál pertenece cada línea.
  if (reporte.sellerIds.length !== 1) {
    throw new ReporteFalabellaInvalidoError("El reporte trae líneas de más de un Seller ID. Descarga el reporte de una sola cuenta.");
  }
  const sellerId = reporte.sellerIds[0];

  return dbComoEmpresa(empresaId, async (tx) => {
    // Solo las cuentas de ESTA empresa (RLS). También una desconectada:
    // sus cortes viejos siguen siendo plata real de la empresa.
    const cuentas = await tx
      .select({ id: cuentasFalabella.id, nickname: cuentasFalabella.nickname })
      .from(cuentasFalabella)
      .where(eq(cuentasFalabella.sellerId, sellerId));
    if (cuentas.length !== 1) {
      throw new ReporteFalabellaInvalidoError(
        cuentas.length === 0
          ? `Este reporte es del Seller ID ${sellerId}, que no está conectado a esta empresa. Conecta esa cuenta de Falabella primero.`
          : `Hay más de una cuenta de Falabella con el Seller ID ${sellerId} en esta empresa. Escríbenos a soporte.`
      );
    }
    const cuenta = cuentas[0];

    let nuevas = 0;
    let repetidas = 0;
    for (let i = 0; i < reporte.lineas.length; i += TAMANO_LOTE) {
      const lote = reporte.lineas.slice(i, i + TAMANO_LOTE);
      const existentes = await tx
        .select({ huella: movimientosMarketplace.huella })
        .from(movimientosMarketplace)
        .where(
          and(
            eq(movimientosMarketplace.marketplace, "falabella"),
            inArray(
              movimientosMarketplace.huella,
              lote.map((l) => l.huella)
            )
          )
        );
      const yaEstaban = new Set(existentes.map((e) => e.huella));
      repetidas += lote.filter((l) => yaEstaban.has(l.huella)).length;
      nuevas += lote.filter((l) => !yaEstaban.has(l.huella)).length;

      // Una línea repetida solo actualiza lo que cambia del periodo al
      // corte (estado de pago, estado de cuenta, referencia); el monto y
      // la categoría son parte de la huella o no cambian.
      await tx
        .insert(movimientosMarketplace)
        .values(
          lote.map((l) => ({
            empresaId,
            marketplace: "falabella",
            cuentaFalabellaId: cuenta.id,
            numeroOrden: l.numeroOrden,
            sku: l.sku,
            idArticulo: l.idArticulo,
            tipoTransaccion: l.tipoTransaccion,
            categoria: l.categoria,
            moneda: l.moneda,
            montoSinIva: l.montoSinIva,
            iva: l.iva,
            monto: l.monto,
            fechaTransaccion: l.fechaTransaccion,
            estadoPago: l.estadoPago,
            estadoCuenta: l.estadoCuenta,
            referenciaPago: l.referenciaPago,
            documentoTributario: l.documentoTributario,
            huella: l.huella,
          }))
        )
        .onConflictDoUpdate({
          target: [movimientosMarketplace.empresaId, movimientosMarketplace.marketplace, movimientosMarketplace.huella],
          set: {
            estadoPago: sql`coalesce(excluded.estado_pago, ${movimientosMarketplace.estadoPago})`,
            estadoCuenta: sql`coalesce(excluded.estado_cuenta, ${movimientosMarketplace.estadoCuenta})`,
            referenciaPago: sql`coalesce(excluded.referencia_pago, ${movimientosMarketplace.referenciaPago})`,
            documentoTributario: sql`coalesce(excluded.documento_tributario, ${movimientosMarketplace.documentoTributario})`,
          },
        });
    }

    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "importar_reporte_falabella",
      entidad: "movimientos_marketplace",
      entidadId: cuenta.id,
      detalle: `Reporte de transacciones de Falabella (${cuenta.nickname}): ${nuevas} línea(s) nueva(s), ${repetidas} repetida(s), ${reporte.noReconocidas.length} sin reconocer.`,
    });

    return {
      cuenta: cuenta.nickname,
      nuevas,
      repetidas,
      noReconocidas: reporte.noReconocidas,
      tiposSinCategoria: [...new Set(reporte.lineas.filter((l) => l.categoria === "otro").map((l) => l.tipoTransaccion))],
    };
  });
}

// ---------- Lectura para la pantalla ----------

// Clave de un corte en la URL: «sin-corte» agrupa las líneas que todavía
// no tienen Nº de estado de cuenta (reporte por periodo, sin pagar).
export const SIN_CORTE = "sin-corte";

export type CorteFalabella = {
  cuentaId: string;
  cuenta: string;
  estadoCuenta: string | null;
  moneda: string;
  desde: string | null;
  hasta: string | null;
  estadosPago: string[];
  lineas: number;
  ordenes: number;
  total: string;
};

const montoTexto = (columna: unknown) => sql<string>`coalesce(sum(${columna}), 0)::text`;

export async function listarCortesFalabella(empresaId: string, usuarioId: string): Promise<CorteFalabella[]> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const m = movimientosMarketplace;
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        cuentaId: cuentasFalabella.id,
        cuenta: cuentasFalabella.nickname,
        estadoCuenta: m.estadoCuenta,
        moneda: m.moneda,
        desde: sql<string | null>`min(${m.fechaTransaccion})::text`,
        hasta: sql<string | null>`max(${m.fechaTransaccion})::text`,
        estadosPago: sql<string[]>`coalesce(array_agg(distinct ${m.estadoPago}) filter (where ${m.estadoPago} is not null), '{}')`,
        lineas: sql<number>`count(*)::int`,
        ordenes: sql<number>`count(distinct ${m.numeroOrden})::int`,
        total: montoTexto(m.monto),
      })
      .from(m)
      .innerJoin(cuentasFalabella, eq(cuentasFalabella.id, m.cuentaFalabellaId))
      .where(eq(m.marketplace, "falabella"))
      .groupBy(cuentasFalabella.id, cuentasFalabella.nickname, m.estadoCuenta, m.moneda)
      .orderBy(sql`max(${m.fechaTransaccion}) desc nulls last`, asc(m.estadoCuenta))
  );
}

export type TotalesCategoria = Record<CategoriaMovimiento, string>;

export type OrdenConciliada = {
  numeroOrden: string | null;
  // Lo que vendió (precio de producto, sin restar devoluciones).
  vendido: string;
  // Lo que cobró Falabella: comisiones, envíos, promociones, publicidad,
  // fulfillment, devoluciones, ajustes y otros (todo menos precio y
  // retenciones).
  cobradoFalabella: string;
  retenciones: string;
  // Lo que se pagó: la suma de todas las líneas, igual que el corte.
  pagado: string;
};

export type DetalleCorteFalabella = {
  cuenta: string;
  estadoCuenta: string | null;
  moneda: string;
  totales: TotalesCategoria;
  pagado: string;
  // Pagado sin restar las retenciones: las retenciones son un saldo a
  // favor en impuestos, no un costo, así que no bajan la utilidad.
  netoAntesDeRetenciones: string;
  ordenes: OrdenConciliada[];
};

export async function leerCorteFalabella(
  empresaId: string,
  usuarioId: string,
  filtro: { cuentaId: string; estadoCuenta: string; moneda: string }
): Promise<DetalleCorteFalabella | null> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const m = movimientosMarketplace;
  const condicion = and(
    eq(m.marketplace, "falabella"),
    eq(m.cuentaFalabellaId, filtro.cuentaId),
    eq(m.moneda, filtro.moneda),
    filtro.estadoCuenta === SIN_CORTE ? isNull(m.estadoCuenta) : eq(m.estadoCuenta, filtro.estadoCuenta)
  );

  return dbComoEmpresa(empresaId, async (tx) => {
    const [cuenta] = await tx
      .select({ nickname: cuentasFalabella.nickname })
      .from(cuentasFalabella)
      .where(eq(cuentasFalabella.id, filtro.cuentaId));
    if (!cuenta) return null;

    const porCategoria = await tx
      .select({ categoria: m.categoria, total: montoTexto(m.monto) })
      .from(m)
      .where(condicion)
      .groupBy(m.categoria);
    if (porCategoria.length === 0) return null;

    const suma = (categorias: CategoriaMovimiento[] | "todas" | "cobros") => {
      if (categorias === "todas") return sql<string>`coalesce(sum(${m.monto}), 0)::text`;
      if (categorias === "cobros") return sql<string>`coalesce(sum(${m.monto}) filter (where ${m.categoria} not in ('precio', 'retencion')), 0)::text`;
      return sql<string>`coalesce(sum(${m.monto}) filter (where ${m.categoria} in ${categorias}), 0)::text`;
    };
    const ordenes = await tx
      .select({
        numeroOrden: m.numeroOrden,
        vendido: suma(["precio"]),
        cobradoFalabella: suma("cobros"),
        retenciones: suma(["retencion"]),
        pagado: suma("todas"),
      })
      .from(m)
      .where(condicion)
      .groupBy(m.numeroOrden)
      .orderBy(sql`${m.numeroOrden} asc nulls last`);

    const [totalesGenerales] = await tx
      .select({
        pagado: suma("todas"),
        netoAntesDeRetenciones: sql<string>`coalesce(sum(${m.monto}) filter (where ${m.categoria} <> 'retencion'), 0)::text`,
      })
      .from(m)
      .where(condicion);

    const totales = Object.fromEntries(
      (["precio", "comision", "envio", "promocion", "retencion", "publicidad", "fulfillment", "devolucion", "ajuste", "otro"] as const).map((c) => [
        c,
        porCategoria.find((p) => p.categoria === c)?.total ?? "0",
      ])
    ) as TotalesCategoria;

    return {
      cuenta: cuenta.nickname,
      estadoCuenta: filtro.estadoCuenta === SIN_CORTE ? null : filtro.estadoCuenta,
      moneda: filtro.moneda,
      totales,
      pagado: totalesGenerales.pagado,
      netoAntesDeRetenciones: totalesGenerales.netoAntesDeRetenciones,
      ordenes,
    };
  });
}
