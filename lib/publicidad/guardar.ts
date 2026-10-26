// Issue #254 — escrituras de Product Ads. Siempre por dbComoEmpresa.
// Los upserts usan las claves únicas del esquema: una segunda corrida
// del mismo día no duplica filas.

import { and, desc, eq } from "drizzle-orm";
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

type Tx = typeof db;

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
        target: publicidadAnunciantes.cuentaMlId,
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
      target: [publicidadCampanas.cuentaMlId, publicidadCampanas.campanaIdMl],
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
          target: [publicidadAnuncios.cuentaMlId, publicidadAnuncios.adGroupId, publicidadAnuncios.itemId],
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
  fecha: string;
  metricas: MetricasNormalizadas;
};

export async function guardarMetricas(empresaId: string, filas: MetricaGuardada[]): Promise<void> {
  if (filas.length === 0) return;
  await dbComoEmpresa(empresaId, async (tx) => {
    for (const fila of filas) {
      const valores = {
        empresaId,
        cuentaMlId: fila.cuentaMlId,
        nivel: fila.nivel,
        entidadIdMl: fila.entidadIdMl,
        fecha: fila.fecha,
        ...fila.metricas,
        sincronizadaTs: new Date(),
      };
      await tx
        .insert(publicidadMetricasDiarias)
        .values(valores)
        .onConflictDoUpdate({
          target: [
            publicidadMetricasDiarias.cuentaMlId,
            publicidadMetricasDiarias.nivel,
            publicidadMetricasDiarias.entidadIdMl,
            publicidadMetricasDiarias.fecha,
          ],
          set: { ...fila.metricas, sincronizadaTs: new Date() },
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

export async function guardarCostoItem(empresaId: string, fila: CostoGuardado): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(publicidadCostosItem)
      .values({ ...fila, empresaId, consultadoTs: new Date() })
      .onConflictDoUpdate({
        target: [publicidadCostosItem.cuentaMlId, publicidadCostosItem.itemId, publicidadCostosItem.fecha],
        set: {
          skuCodigo: fila.skuCodigo,
          categoryId: fila.categoryId,
          precioVentaVigente: fila.precioVentaVigente,
          precioRegular: fila.precioRegular,
          comisionMl: fila.comisionMl,
          comisionDetalle: fila.comisionDetalle,
          envioVendedorEstimado: fila.envioVendedorEstimado,
          compradorPagaEnvio: fila.compradorPagaEnvio,
          logisticType: fila.logisticType,
          shippingMode: fila.shippingMode,
          listingTypeId: fila.listingTypeId,
          consultadoTs: new Date(),
        },
      })
  );
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
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(publicidadSincronizaciones)
      .values({ ...datos, empresaId, estado: "en_curso", llamadas: 0 })
      .returning({ id: publicidadSincronizaciones.id })
  );
  return fila.id;
}

export async function cerrarSincronizacion(
  empresaId: string,
  id: string,
  datos: { estado: "ok" | "parcial" | "error"; llamadas: number; error: string | null }
): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(publicidadSincronizaciones)
      .set({ ...datos, terminadaTs: new Date() })
      .where(eq(publicidadSincronizaciones.id, id))
  );
}

export async function historialSync(empresaId: string, cuentaMlId: string) {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({
        estado: publicidadSincronizaciones.estado,
        rangoDesde: publicidadSincronizaciones.rangoDesde,
        rangoHasta: publicidadSincronizaciones.rangoHasta,
        iniciadaTs: publicidadSincronizaciones.iniciadaTs,
        error: publicidadSincronizaciones.error,
      })
      .from(publicidadSincronizaciones)
      .where(eq(publicidadSincronizaciones.cuentaMlId, cuentaMlId))
      .orderBy(desc(publicidadSincronizaciones.iniciadaTs));
    return {
      ultima: filas[0] ?? null,
      yaTerminoBackfill: filas.some((f) => f.estado === "ok"),
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
