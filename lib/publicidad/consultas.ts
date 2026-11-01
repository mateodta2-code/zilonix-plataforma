// Issue #255 — lecturas del tablero. Siempre dentro de dbComoEmpresa y
// con empresaId en el WHERE: RLS no es una excusa para olvidar el filtro.
// No llama a Mercado Libre. El único camino a la API sigue siendo el
// botón "Actualizar ahora".

import { and, asc, desc, eq, gte, isNotNull, lte, sum } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import {
  publicidadAnunciantes,
  publicidadAnuncios,
  publicidadCampanas,
  publicidadCostosItem,
  publicidadMetricasDiarias,
  publicidadSincronizaciones,
} from "@/db/schema";
import { obtenerConfigPublicidad, type ConfigPublicidad } from "@/lib/publicidad/config";
import { linkPublicacion } from "@/lib/ml/cliente";
import {
  compararOrden,
  diagnosticarCampana,
  semaforoAnuncio,
  totalesDeDias,
  type ColumnaOrden,
  type DiaMetrica,
  type DireccionOrden,
  type FilaOrdenable,
  type Periodo,
  type TotalesRango,
  type Diagnostico,
  type Semaforo,
} from "@/lib/publicidad/kpis";

export type AnuncianteTablero = {
  estadoAcceso: "ok" | "sin_product_ads" | "sin_permiso_app";
  nombre: string | null;
  siteId: string | null;
  verificadoTs: Date;
};

export type SincronizacionOk = {
  terminadaTs: Date | null;
  iniciadaTs: Date;
};

export type AnuncioCalculado = {
  id: string;
  adGroupId: string;
  itemId: string;
  titulo: string | null;
  href: string | null;
  precio: string | null;
  totales: TotalesRango;
  semaforo: Semaforo;
};

export type CampanaCalculada = FilaOrdenable & {
  id: string;
  campanaIdMl: string;
  estadoMl: string | null;
  activa: boolean;
  roasObjetivo: string | null;
  diagnostico: Diagnostico;
  totales: TotalesRango;
  anuncios: AnuncioCalculado[];
};

export type TableroPublicidad = {
  anunciante: AnuncianteTablero | null;
  ultimaOk: SincronizacionOk | null;
  enCurso: boolean;
  resumen: { actual: TotalesRango; anterior: TotalesRango };
  campanas: CampanaCalculada[];
  cantidadActivas: number;
  cantidadPausadas: number;
};

type FilaSuma = {
  entidadIdMl: string;
  adGroupId: string;
  costo: string | null;
  montoTotal: string | null;
  ventasOrganicasMonto: string | null;
  clicks: string | null;
  impresiones: string | null;
};

function diaDeSuma(fila: FilaSuma | undefined): DiaMetrica {
  return {
    costo: fila?.costo ?? null,
    montoTotal: fila?.montoTotal ?? null,
    ventasOrganicasMonto: fila?.ventasOrganicasMonto ?? null,
    clicks: fila?.clicks ?? null,
    impresiones: fila?.impresiones ?? null,
  };
}

function claveAnuncio(itemId: string, adGroupId: string): string {
  return `${itemId}\u0000${adGroupId}`;
}

function esActiva(estado: string | null): boolean {
  return (estado ?? "").toLowerCase() === "active";
}

// Permalink solo si el host es de Mercado Libre. Si no, el armado de
// linkPublicacion (MCO-dígitos). Un javascript: o un dominio ajeno no
// llega al href.
function enlaceAnuncio(permalink: string | null, itemId: string): string | null {
  if (permalink) {
    try {
      const url = new URL(permalink);
      const hostOk = /(^|\.)mercadolibre\.com(\.[a-z]{2})?$/i.test(url.hostname);
      if ((url.protocol === "https:" || url.protocol === "http:") && hostOk) {
        return url.protocol === "http:" ? permalink.replace(/^http:/i, "https:") : permalink;
      }
    } catch {
      // Sigue el respaldo por item id.
    }
  }
  return linkPublicacion(itemId);
}

export async function consultarTableroPublicidad(
  empresaId: string,
  cuentaMlId: string,
  periodo: Periodo,
  opciones: {
    incluirPausadas: boolean;
    orden: ColumnaOrden;
    dir: DireccionOrden;
    ahora: Date;
    config?: ConfigPublicidad;
  }
): Promise<TableroPublicidad> {
  const config = opciones.config ?? obtenerConfigPublicidad(empresaId);
  return dbComoEmpresa(empresaId, async (tx) => {
    const filtroCuenta = (empresa: typeof publicidadCampanas.empresaId, cuenta: typeof publicidadCampanas.cuentaMlId) =>
      and(eq(empresa, empresaId), eq(cuenta, cuentaMlId));

    const [anunciante] = await tx
      .select({
        estadoAcceso: publicidadAnunciantes.estadoAcceso,
        nombre: publicidadAnunciantes.nombre,
        siteId: publicidadAnunciantes.siteId,
        verificadoTs: publicidadAnunciantes.verificadoTs,
      })
      .from(publicidadAnunciantes)
      .where(and(eq(publicidadAnunciantes.empresaId, empresaId), eq(publicidadAnunciantes.cuentaMlId, cuentaMlId)));

    const [ultimaOk] = await tx
      .select({
        terminadaTs: publicidadSincronizaciones.terminadaTs,
        iniciadaTs: publicidadSincronizaciones.iniciadaTs,
      })
      .from(publicidadSincronizaciones)
      .where(
        and(
          eq(publicidadSincronizaciones.empresaId, empresaId),
          eq(publicidadSincronizaciones.cuentaMlId, cuentaMlId),
          eq(publicidadSincronizaciones.estado, "ok")
        )
      )
      .orderBy(desc(publicidadSincronizaciones.iniciadaTs))
      .limit(1);

    const [enCursoFila] = await tx
      .select({ id: publicidadSincronizaciones.id })
      .from(publicidadSincronizaciones)
      .where(
        and(
          eq(publicidadSincronizaciones.empresaId, empresaId),
          eq(publicidadSincronizaciones.cuentaMlId, cuentaMlId),
          eq(publicidadSincronizaciones.estado, "en_curso")
        )
      )
      .limit(1);

    const campanas = await tx
      .select({
        id: publicidadCampanas.id,
        campanaIdMl: publicidadCampanas.campanaIdMl,
        nombre: publicidadCampanas.nombre,
        estado: publicidadCampanas.estado,
        presupuestoDiario: publicidadCampanas.presupuestoDiario,
        roasObjetivo: publicidadCampanas.roasObjetivo,
        creadaMlTs: publicidadCampanas.creadaMlTs,
        actualizadaMlTs: publicidadCampanas.actualizadaMlTs,
      })
      .from(publicidadCampanas)
      .where(filtroCuenta(publicidadCampanas.empresaId, publicidadCampanas.cuentaMlId));

    const anuncios = await tx
      .select({
        id: publicidadAnuncios.id,
        adGroupId: publicidadAnuncios.adGroupId,
        campanaIdMl: publicidadAnuncios.campanaIdMl,
        itemId: publicidadAnuncios.itemId,
        titulo: publicidadAnuncios.titulo,
        permalink: publicidadAnuncios.permalink,
        precio: publicidadAnuncios.precio,
      })
      .from(publicidadAnuncios)
      .where(and(eq(publicidadAnuncios.empresaId, empresaId), eq(publicidadAnuncios.cuentaMlId, cuentaMlId)));

    const precios = await tx
      .selectDistinctOn([publicidadCostosItem.itemId], {
        itemId: publicidadCostosItem.itemId,
        precio: publicidadCostosItem.precioVentaVigente,
      })
      .from(publicidadCostosItem)
      .where(
        and(
          eq(publicidadCostosItem.empresaId, empresaId),
          eq(publicidadCostosItem.cuentaMlId, cuentaMlId),
          isNotNull(publicidadCostosItem.precioVentaVigente)
        )
      )
      .orderBy(asc(publicidadCostosItem.itemId), desc(publicidadCostosItem.fecha));

    async function sumar(nivel: "campana" | "anuncio", desde: string, hasta: string) {
      // ad_group_id va en el GROUP BY porque también se selecciona.
      // En campaña queda vacío; en anuncio separa el mismo ítem en dos grupos.
      return tx
        .select({
          entidadIdMl: publicidadMetricasDiarias.entidadIdMl,
          adGroupId: publicidadMetricasDiarias.adGroupId,
          costo: sum(publicidadMetricasDiarias.costo),
          montoTotal: sum(publicidadMetricasDiarias.montoTotal),
          ventasOrganicasMonto: sum(publicidadMetricasDiarias.ventasOrganicasMonto),
          clicks: sum(publicidadMetricasDiarias.clicks),
          impresiones: sum(publicidadMetricasDiarias.impresiones),
        })
        .from(publicidadMetricasDiarias)
        .where(
          and(
            eq(publicidadMetricasDiarias.empresaId, empresaId),
            eq(publicidadMetricasDiarias.cuentaMlId, cuentaMlId),
            eq(publicidadMetricasDiarias.nivel, nivel),
            gte(publicidadMetricasDiarias.fecha, desde),
            lte(publicidadMetricasDiarias.fecha, hasta)
          )
        )
        .groupBy(publicidadMetricasDiarias.entidadIdMl, publicidadMetricasDiarias.adGroupId);
    }

    async function sumarCuenta(desde: string, hasta: string): Promise<TotalesRango> {
      // Nivel campana, no cuenta: la sincronización puede no guardar el
      // total de cuenta (AVISO_DAILY en sincronizarPublicidad.ts).
      const [fila] = await tx
        .select({
          costo: sum(publicidadMetricasDiarias.costo),
          montoTotal: sum(publicidadMetricasDiarias.montoTotal),
          ventasOrganicasMonto: sum(publicidadMetricasDiarias.ventasOrganicasMonto),
          clicks: sum(publicidadMetricasDiarias.clicks),
          impresiones: sum(publicidadMetricasDiarias.impresiones),
        })
        .from(publicidadMetricasDiarias)
        .where(
          and(
            eq(publicidadMetricasDiarias.empresaId, empresaId),
            eq(publicidadMetricasDiarias.cuentaMlId, cuentaMlId),
            eq(publicidadMetricasDiarias.nivel, "campana"),
            gte(publicidadMetricasDiarias.fecha, desde),
            lte(publicidadMetricasDiarias.fecha, hasta)
          )
        );
      return totalesDeDias([
        diaDeSuma({
          entidadIdMl: "",
          adGroupId: "",
          costo: fila?.costo ?? null,
          montoTotal: fila?.montoTotal ?? null,
          ventasOrganicasMonto: fila?.ventasOrganicasMonto ?? null,
          clicks: fila?.clicks ?? null,
          impresiones: fila?.impresiones ?? null,
        }),
      ]);
    }

    // En serie: es la misma transacción y la misma conexión. En paralelo
    // postgres.js puede mezclar las respuestas.
    const metricasCampana = await sumar("campana", periodo.desde, periodo.hasta);
    const metricasAnuncio = await sumar("anuncio", periodo.desde, periodo.hasta);
    const resumenActual = await sumarCuenta(periodo.desde, periodo.hasta);
    const resumenAnterior = await sumarCuenta(periodo.comparacionDesde, periodo.comparacionHasta);

    const porCampana = new Map(metricasCampana.map((fila) => [fila.entidadIdMl, fila]));
    const porAnuncio = new Map(metricasAnuncio.map((fila) => [claveAnuncio(fila.entidadIdMl, fila.adGroupId), fila]));
    const precioPorItem = new Map(precios.map((fila) => [fila.itemId, fila.precio]));

    const calculadas: CampanaCalculada[] = campanas.map((campana) => {
      const totales = totalesDeDias([diaDeSuma(porCampana.get(campana.campanaIdMl))]);
      const anunciosDeLaCampana = anuncios
        .filter((anuncio) => anuncio.campanaIdMl === campana.campanaIdMl)
        .map((anuncio): AnuncioCalculado => {
          const totalesAnuncio = totalesDeDias([diaDeSuma(porAnuncio.get(claveAnuncio(anuncio.itemId, anuncio.adGroupId)))]);
          const precio = anuncio.precio ?? precioPorItem.get(anuncio.itemId) ?? null;
          return {
            id: anuncio.id,
            adGroupId: anuncio.adGroupId,
            itemId: anuncio.itemId,
            titulo: anuncio.titulo,
            href: enlaceAnuncio(anuncio.permalink, anuncio.itemId),
            precio,
            totales: totalesAnuncio,
            semaforo: semaforoAnuncio({
              gasto: totalesAnuncio.gasto,
              ventasPublicidad: totalesAnuncio.ventasPublicidad,
              precio,
              config,
            }),
          };
        })
        .sort((a, b) =>
          compararOrden(
            {
              nombre: a.itemId,
              gasto: a.totales.gasto,
              ventasPublicidad: a.totales.ventasPublicidad,
              ventasTotales: a.totales.ventasTotales,
              roas: a.totales.roas,
              acos: a.totales.acos,
              tacos: a.totales.tacos,
              cpc: a.totales.cpc,
              clicks: a.totales.clicks,
              impresiones: a.totales.impresiones,
              presupuestoDiario: null,
            },
            {
              nombre: b.itemId,
              gasto: b.totales.gasto,
              ventasPublicidad: b.totales.ventasPublicidad,
              ventasTotales: b.totales.ventasTotales,
              roas: b.totales.roas,
              acos: b.totales.acos,
              tacos: b.totales.tacos,
              cpc: b.totales.cpc,
              clicks: b.totales.clicks,
              impresiones: b.totales.impresiones,
              presupuestoDiario: null,
            },
            "inversion",
            "desc"
          )
        );
      const activa = esActiva(campana.estado);
      return {
        id: campana.id,
        campanaIdMl: campana.campanaIdMl,
        nombre: campana.nombre ?? "Campaña sin nombre",
        estadoMl: campana.estado,
        activa,
        gasto: totales.gasto,
        ventasPublicidad: totales.ventasPublicidad,
        ventasTotales: totales.ventasTotales,
        roas: totales.roas,
        acos: totales.acos,
        tacos: totales.tacos,
        cpc: totales.cpc,
        clicks: totales.clicks,
        impresiones: totales.impresiones,
        presupuestoDiario: campana.presupuestoDiario,
        roasObjetivo: campana.roasObjetivo,
        diagnostico: diagnosticarCampana({
          ahora: opciones.ahora,
          creadaMlTs: campana.creadaMlTs,
          actualizadaMlTs: campana.actualizadaMlTs,
          roasObjetivo: campana.roasObjetivo,
          totales,
          config,
        }),
        totales,
        anuncios: anunciosDeLaCampana,
      };
    });

    const visibles = calculadas
      .filter((campana) => opciones.incluirPausadas || campana.activa)
      .sort((a, b) => compararOrden(a, b, opciones.orden, opciones.dir));

    return {
      anunciante: anunciante ?? null,
      ultimaOk: ultimaOk ?? null,
      enCurso: Boolean(enCursoFila),
      resumen: { actual: resumenActual, anterior: resumenAnterior },
      campanas: visibles,
      cantidadActivas: calculadas.filter((c) => c.activa).length,
      cantidadPausadas: calculadas.filter((c) => !c.activa).length,
    };
  });
}
