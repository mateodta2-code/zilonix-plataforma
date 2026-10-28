// Issue #254 — escrituras de Product Ads. Siempre por dbComoEmpresa.
// Los upserts usan las claves únicas del esquema, que incluyen
// empresa_id: una cuenta transferida conserva el historial en la
// empresa anterior (RLS no lo muestra a la nueva) y la nueva inserta
// sus propias filas sin pisar las viejas.

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { db } from "@/db/index";
import {
  publicidadAnunciantes,
  publicidadAnuncios,
  publicidadCampanas,
  publicidadCostosItem,
  publicidadMetricasDiarias,
  publicidadSincronizaciones,
} from "@/db/schema";
import type { MetricasNormalizadas } from "@/lib/publicidad/metricas";
import { MINUTOS_EN_CURSO_ABANDONADO, MINUTOS_REFRESCO_MANUAL, contarReintentosMismoTramo } from "@/lib/publicidad/plan";

type Tx = typeof db;

const CAMPOS_DINERO_COSTO = ["precioVentaVigente", "precioRegular", "comisionMl", "envioVendedorEstimado"] as const;

export class SyncEnCursoError extends Error {
  constructor() {
    super("Ya hay una actualización de publicidad en curso para esta cuenta.");
    this.name = "SyncEnCursoError";
  }
}

export class SyncMuyRecienteError extends Error {
  constructor() {
    super(
      `Esta cuenta se actualizó hace menos de ${MINUTOS_REFRESCO_MANUAL} minutos. Esperá un poco para no pedir de más a Mercado Libre.`
    );
    this.name = "SyncMuyRecienteError";
  }
}

export type AnuncianteGuardado = {
  cuentaMlId: string;
  advertiserId: string | null;
  siteId: string | null;
  nombre: string | null;
  estadoAcceso: "ok" | "sin_product_ads" | "sin_permiso_app";
};

export async function guardarAnunciante(empresaId: string, fila: AnuncianteGuardado): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(publicidadAnunciantes)
      .values({ ...fila, empresaId, verificadoTs: new Date() })
      .onConflictDoUpdate({
        target: [publicidadAnunciantes.empresaId, publicidadAnunciantes.cuentaMlId],
        set: {
          advertiserId: fila.advertiserId,
          siteId: fila.siteId,
          nombre: fila.nombre,
          estadoAcceso: fila.estadoAcceso,
          verificadoTs: new Date(),
        },
      })
  );
}

export type CampanaGuardada = {
  cuentaMlId: string;
  campanaIdMl: string;
  nombre: string | null;
  estado: string | null;
  estrategia: string | null;
  presupuesto: string | null;
  presupuestoDiario: string | null;
  presupuestoAutomatico: boolean | null;
  roasObjetivo: string | null;
  acosObjetivo: string | null;
  acosObjetivoCalculado: boolean;
  moneda: string | null;
  creadaMlTs: Date | null;
  actualizadaMlTs: Date | null;
};

export async function guardarCampanas(empresaId: string, filas: CampanaGuardada[]): Promise<void> {
  if (filas.length === 0) return;
  await dbComoEmpresa(empresaId, async (tx) => {
    for (const fila of filas) await upsertCampana(tx, empresaId, fila);
  });
}

async function upsertCampana(tx: Tx, empresaId: string, fila: CampanaGuardada): Promise<void> {
  await tx
    .insert(publicidadCampanas)
    .values({ ...fila, empresaId, sincronizadaTs: new Date() })
    .onConflictDoUpdate({
      target: [publicidadCampanas.empresaId, publicidadCampanas.cuentaMlId, publicidadCampanas.campanaIdMl],
      set: {
        nombre: fila.nombre,
        estado: fila.estado,
        estrategia: fila.estrategia,
        presupuesto: fila.presupuesto,
        presupuestoDiario: fila.presupuestoDiario,
        presupuestoAutomatico: fila.presupuestoAutomatico,
        roasObjetivo: fila.roasObjetivo,
        acosObjetivo: fila.acosObjetivo,
        acosObjetivoCalculado: fila.acosObjetivoCalculado,
        moneda: fila.moneda,
        creadaMlTs: fila.creadaMlTs,
        actualizadaMlTs: fila.actualizadaMlTs,
        sincronizadaTs: new Date(),
      },
    });
}

export type AnuncioGuardado = {
  cuentaMlId: string;
  adGroupId: string;
  tipoAdGroup: string | null;
  adGroupExternoId: string | null;
  campanaIdMl: string | null;
  itemId: string;
  titulo: string | null;
  permalink: string | null;
  estado: string | null;
  precio: string | null;
  logisticType: string | null;
  listingTypeId: string | null;
};

export async function guardarAnuncios(empresaId: string, filas: AnuncioGuardado[]): Promise<void> {
  if (filas.length === 0) return;
  await dbComoEmpresa(empresaId, async (tx) => {
    for (const fila of filas) {
      await tx
        .insert(publicidadAnuncios)
        .values({ ...fila, empresaId, sincronizadoTs: new Date() })
        .onConflictDoUpdate({
          target: [publicidadAnuncios.empresaId, publicidadAnuncios.cuentaMlId, publicidadAnuncios.adGroupId, publicidadAnuncios.itemId],
          set: {
            tipoAdGroup: fila.tipoAdGroup,
            adGroupExternoId: fila.adGroupExternoId,
            campanaIdMl: fila.campanaIdMl,
            titulo: fila.titulo,
            permalink: fila.permalink,
            estado: fila.estado,
            precio: fila.precio,
            logisticType: fila.logisticType,
            listingTypeId: fila.listingTypeId,
            sincronizadoTs: new Date(),
          },
        });
    }
  });
}

export type MetricaGuardada = {
  cuentaMlId: string;
  nivel: "cuenta" | "campana" | "ad_group" | "anuncio";
  entidadIdMl: string;
  adGroupId?: string;
  fecha: string;
  metricas: MetricasNormalizadas;
  // Campos que no se pudieron leer. En el UPDATE no se tocan: un null
  // de parseo no puede pisar un costo que ya estaba bien.
  invalidos?: (keyof MetricasNormalizadas)[];
};

function setDeMetricas(metricas: MetricasNormalizadas, invalidos: (keyof MetricasNormalizadas)[]) {
  const omitir = new Set(invalidos);
  const set: Record<string, string | number | null | Date> = { sincronizadaTs: new Date() };
  for (const clave of Object.keys(metricas) as (keyof MetricasNormalizadas)[]) {
    if (omitir.has(clave)) continue;
    // Un null que no quedó en `invalidos` tampoco pisa la columna.
    if (metricas[clave] == null) continue;
    set[clave] = metricas[clave];
  }
  return set;
}

export async function guardarMetricas(empresaId: string, filas: MetricaGuardada[]): Promise<void> {
  if (filas.length === 0) return;
  await dbComoEmpresa(empresaId, async (tx) => {
    for (const fila of filas) {
      const adGroupId = fila.adGroupId ?? "";
      const invalidos = fila.invalidos ?? [];
      await tx
        .insert(publicidadMetricasDiarias)
        .values({
          empresaId,
          cuentaMlId: fila.cuentaMlId,
          nivel: fila.nivel,
          entidadIdMl: fila.entidadIdMl,
          adGroupId,
          fecha: fila.fecha,
          ...fila.metricas,
          sincronizadaTs: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            publicidadMetricasDiarias.empresaId,
            publicidadMetricasDiarias.cuentaMlId,
            publicidadMetricasDiarias.nivel,
            publicidadMetricasDiarias.entidadIdMl,
            publicidadMetricasDiarias.adGroupId,
            publicidadMetricasDiarias.fecha,
          ],
          set: setDeMetricas(fila.metricas, invalidos),
        });
    }
  });
}

export type CostoGuardado = {
  cuentaMlId: string;
  itemId: string;
  fecha: string;
  skuCodigo: string | null;
  categoryId: string | null;
  precioVentaVigente: string | null;
  precioRegular: string | null;
  comisionMl: string | null;
  comisionDetalle: Record<string, unknown> | null;
  envioVendedorEstimado: string | null;
  compradorPagaEnvio: boolean | null;
  logisticType: string | null;
  shippingMode: string | null;
  listingTypeId: string | null;
};

function setDeCosto(fila: CostoGuardado) {
  const set: Record<string, unknown> = {
    skuCodigo: fila.skuCodigo,
    categoryId: fila.categoryId,
    comisionDetalle: fila.comisionDetalle,
    compradorPagaEnvio: fila.compradorPagaEnvio,
    logisticType: fila.logisticType,
    shippingMode: fila.shippingMode,
    listingTypeId: fila.listingTypeId,
    consultadoTs: new Date(),
  };
  for (const clave of CAMPOS_DINERO_COSTO) {
    if (fila[clave] != null) set[clave] = fila[clave];
  }
  return set;
}

export async function guardarCostoItem(empresaId: string, fila: CostoGuardado): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(publicidadCostosItem)
      .values({ ...fila, empresaId, consultadoTs: new Date() })
      .onConflictDoUpdate({
        target: [
          publicidadCostosItem.empresaId,
          publicidadCostosItem.cuentaMlId,
          publicidadCostosItem.itemId,
          publicidadCostosItem.fecha,
        ],
        set: setDeCosto(fila),
      })
  );
}

export async function itemsSincronizadosDesde(empresaId: string, cuentaMlId: string, desde: Date): Promise<string[]> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ itemId: publicidadAnuncios.itemId })
      .from(publicidadAnuncios)
      .where(and(eq(publicidadAnuncios.cuentaMlId, cuentaMlId), gte(publicidadAnuncios.sincronizadoTs, desde)))
  );
  return [...new Set(filas.map((fila) => fila.itemId))];
}

export async function costoYaConsultado(empresaId: string, cuentaMlId: string, itemId: string, fecha: string): Promise<boolean> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: publicidadCostosItem.id })
      .from(publicidadCostosItem)
      .where(
        and(
          eq(publicidadCostosItem.cuentaMlId, cuentaMlId),
          eq(publicidadCostosItem.itemId, itemId),
          eq(publicidadCostosItem.fecha, fecha)
        )
      )
  );
  return filas.length > 0;
}

function codigoPg(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const directo = error as { code?: unknown; cause?: { code?: unknown } };
  if (typeof directo.code === "string") return directo.code;
  if (typeof directo.cause?.code === "string") return directo.cause.code;
  return null;
}

export async function abrirSincronizacion(
  empresaId: string,
  datos: {
    cuentaMlId: string;
    origen: "programada" | "manual";
    solicitadaPor: string | null;
    rangoDesde: string | null;
    rangoHasta: string | null;
  }
): Promise<string> {
  const ahora = new Date();
  const limiteAbandono = new Date(ahora.getTime() - MINUTOS_EN_CURSO_ABANDONADO * 60_000);
  // Se cierra en su propia transacción: si después el tope de 10
  // minutos rechaza la corrida, el en_curso abandonado no vuelve a
  // quedar abierto por el rollback.
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(publicidadSincronizaciones)
      .set({
        estado: "error",
        terminadaTs: ahora,
        error: "La corrida anterior quedó en curso más de 30 minutos y se marcó para poder retomar.",
      })
      .where(
        and(
          eq(publicidadSincronizaciones.empresaId, empresaId),
          eq(publicidadSincronizaciones.cuentaMlId, datos.cuentaMlId),
          eq(publicidadSincronizaciones.estado, "en_curso"),
          lt(publicidadSincronizaciones.iniciadaTs, limiteAbandono)
        )
      )
  );

  return dbComoEmpresa(empresaId, async (tx) => {
    // El índice parcial impide dos en_curso. El lock hace atómico el
    // tope de 10 minutos: las dos peticiones no leen "no hay fila
    // reciente" a la vez y las dos insertan.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('publicidad'), hashtext(${datos.cuentaMlId}))`);

    const [ultima] = await tx
      .select({
        estado: publicidadSincronizaciones.estado,
        iniciadaTs: publicidadSincronizaciones.iniciadaTs,
      })
      .from(publicidadSincronizaciones)
      .where(
        and(eq(publicidadSincronizaciones.empresaId, empresaId), eq(publicidadSincronizaciones.cuentaMlId, datos.cuentaMlId))
      )
      .orderBy(desc(publicidadSincronizaciones.iniciadaTs))
      .limit(1);

    if (ultima?.estado === "en_curso") throw new SyncEnCursoError();
    if (datos.origen === "manual" && ultima) {
      const edad = ahora.getTime() - ultima.iniciadaTs.getTime();
      if (edad >= 0 && edad < MINUTOS_REFRESCO_MANUAL * 60_000) throw new SyncMuyRecienteError();
    }

    try {
      const [fila] = await tx
        .insert(publicidadSincronizaciones)
        .values({ ...datos, empresaId, estado: "en_curso", llamadas: 0 })
        .returning({ id: publicidadSincronizaciones.id });
      return fila.id;
    } catch (error) {
      if (codigoPg(error) === "23505") throw new SyncEnCursoError();
      throw error;
    }
  });
}

export async function cerrarSincronizacion(
  empresaId: string,
  id: string,
  datos: {
    estado: "ok" | "parcial" | "error";
    llamadas: number;
    error: string | null;
    cierraBackfill: boolean;
    reanudaDesde?: string | null;
  }
): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(publicidadSincronizaciones)
      .set({
        estado: datos.estado,
        llamadas: datos.llamadas,
        error: datos.error,
        cierraBackfill: datos.cierraBackfill,
        reanudaDesde: datos.reanudaDesde ?? null,
        terminadaTs: new Date(),
      })
      .where(and(eq(publicidadSincronizaciones.id, id), eq(publicidadSincronizaciones.empresaId, empresaId)))
  );
}

const TOPE_HISTORIAL = 8;

export type HistorialSync = {
  ultima: {
    estado: "en_curso" | "ok" | "parcial" | "error";
    rangoDesde: string | null;
    rangoHasta: string | null;
    iniciadaTs: Date;
    error: string | null;
    cierraBackfill: boolean;
    reanudaDesde: string | null;
  } | null;
  yaTerminoBackfill: boolean;
  reintentosMismoTramo: number;
};

export async function historialSync(empresaId: string, cuentaMlId: string): Promise<HistorialSync> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({
        estado: publicidadSincronizaciones.estado,
        rangoDesde: publicidadSincronizaciones.rangoDesde,
        rangoHasta: publicidadSincronizaciones.rangoHasta,
        iniciadaTs: publicidadSincronizaciones.iniciadaTs,
        error: publicidadSincronizaciones.error,
        cierraBackfill: publicidadSincronizaciones.cierraBackfill,
        reanudaDesde: publicidadSincronizaciones.reanudaDesde,
      })
      .from(publicidadSincronizaciones)
      .where(and(eq(publicidadSincronizaciones.empresaId, empresaId), eq(publicidadSincronizaciones.cuentaMlId, cuentaMlId)))
      .orderBy(desc(publicidadSincronizaciones.iniciadaTs))
      .limit(TOPE_HISTORIAL);

    const [cerrado] = await tx
      .select({ id: publicidadSincronizaciones.id })
      .from(publicidadSincronizaciones)
      .where(
        and(
          eq(publicidadSincronizaciones.empresaId, empresaId),
          eq(publicidadSincronizaciones.cuentaMlId, cuentaMlId),
          eq(publicidadSincronizaciones.estado, "ok"),
          eq(publicidadSincronizaciones.cierraBackfill, true)
        )
      )
      .limit(1);

    return {
      ultima: filas[0] ?? null,
      yaTerminoBackfill: Boolean(cerrado),
      reintentosMismoTramo: contarReintentosMismoTramo(filas),
    };
  });
}

export async function contarMetricas(empresaId: string, cuentaMlId: string): Promise<number> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: publicidadMetricasDiarias.id })
      .from(publicidadMetricasDiarias)
      .where(eq(publicidadMetricasDiarias.cuentaMlId, cuentaMlId))
  );
  return filas.length;
}
