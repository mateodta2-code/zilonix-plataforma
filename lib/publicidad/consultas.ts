// Issue #255 — lecturas del tablero. Siempre dentro de dbComoEmpresa y
// con empresaId en el WHERE: RLS no es una excusa para olvidar el filtro.
// No llama a Mercado Libre. El único camino a la API sigue siendo el
// botón "Actualizar ahora".

import { and, asc, desc, eq, gte, inArray, isNotNull, like, lte, or, sum } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import {
  configuracionFinanzas,
  publicidadAnunciantes,
  publicidadAnuncios,
  publicidadCampanas,
  publicidadCampanasCambios,
  publicaciones,
  publicidadCostosItem,
  publicidadMetricasDiarias,
  publicidadSincronizaciones,
  skus,
} from "@/db/schema";
import { PREFIJO_CORTE_TIEMPO } from "@/lib/publicidad/actualizacion";
import { esCampoCambio, type CampoCambio } from "@/lib/publicidad/cambios";
import { DIAS_SIN_VENDER_VENDEDOR, META_MARGEN_DEFECTO, obtenerConfigPublicidad, type ConfigPublicidad } from "@/lib/publicidad/config";
import { linkPublicacion } from "@/lib/ml/cliente";
import { leerCostosPorSku, skuDePublicacion } from "@/lib/publicidad/costos";
import { LOGISTICA_FULL, calcularFilaGanancia, type FilaGanancia } from "@/lib/publicidad/ganancia";
import { type FiltroCampanas } from "@/lib/publicidad/params";
import { diasEntreInclusive, hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";
import {
  armarSerieDiaria,
  compararOrden,
  sumarMontos,
  diagnosticarCampana,
  margenRealProducto,
  semaforoAnuncio,
  totalesDeDias,
  type ColumnaOrden,
  type DiaMetrica,
  type DireccionOrden,
  type FilaOrdenable,
  type Periodo,
  type PuntoDiario,
  type TotalesRango,
  type Diagnostico,
  type MargenProducto,
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
  estado: string | null;
  // null = esta empresa no tiene la publicación importada, no se afirma stock.
  sinStock: boolean | null;
  totales: TotalesRango;
  // Los últimos DIAS_SIN_VENDER_VENDEDOR días completos (hasta ayer),
  // sin importar el mes elegido: la regla de VENDEDOR mira el presente.
  ultimosDias: TotalesRango;
  semaforo: Semaforo;
  // Semáforo de productos: ganancia real por unidad (sin publicidad).
  margen: MargenProducto;
};

export type CampanaCalculada = FilaOrdenable & {
  id: string;
  campanaIdMl: string;
  estadoMl: string | null;
  activa: boolean;
  roasObjetivo: string | null;
  presupuestoAutomatico: boolean | null;
  diasAprendizaje: number;
  diagnostico: Diagnostico;
  totales: TotalesRango;
  totalesAnterior: TotalesRango;
  anuncios: AnuncioCalculado[];
};

export type TableroPublicidad = {
  anunciante: AnuncianteTablero | null;
  // Última sync que dejó datos (ok, parcial o corte de tiempo). No es
  // solo estado ok: ese recién aparece cuando cierra el backfill.
  ultimaActualizacion: SincronizacionOk | null;
  enCurso: boolean;
  resumen: { actual: TotalesRango; anterior: TotalesRango };
  campanas: CampanaCalculada[];
  cantidadActivas: number;
  cantidadPausadas: number;
  diasRango: number;
  serieDiaria: PuntoDiario[];
  presupuestoDiarioTotal: string | null;
  nombresCampanas: string[];
  // Margen del producto y mínimo después de Ads (config). La vista
  // calcula con esto la rentabilidad de cada campaña.
  rentabilidad: { margen: string; minimo: string };
  // Cambios de presupuesto diario y ROAS objetivo de lo corrido del
  // periodo, el más nuevo primero.
  cambios: CambioCampana[];
  // Meta de margen del comercio (fracción) para el semáforo de productos.
  metaMargen: string;
};

// SKU como lo guarda la tabla de costos (costos_sku_sku_normalizado).
export type CambioCampana = {
  id: string;
  campanaIdMl: string;
  nombre: string;
  campo: CampoCambio;
  valorAnterior: string | null;
  valorNuevo: string | null;
  detectadoTs: Date;
};

// Cuántos cambios muestra la sección del historial (lo corrido del mes).
export const LIMITE_HISTORIAL_CAMBIOS = 20;

type FilaSuma = {
  entidadIdMl: string;
  adGroupId: string;
  costo: string | null;
  montoTotal: string | null;
  ventasOrganicasMonto: string | null;
  clicks: string | null;
  impresiones: string | null;
  ventasCantidad: string | null;
  unidadesTotal: string | null;
  unidadesDirectas: string | null;
  unidadesIndirectas: string | null;
};

function diaDeSuma(fila: FilaSuma | undefined): DiaMetrica {
  return {
    costo: fila?.costo ?? null,
    montoTotal: fila?.montoTotal ?? null,
    ventasOrganicasMonto: fila?.ventasOrganicasMonto ?? null,
    clicks: fila?.clicks ?? null,
    impresiones: fila?.impresiones ?? null,
    ventasCantidad: fila?.ventasCantidad ?? null,
    unidadesTotal: fila?.unidadesTotal ?? null,
    unidadesDirectas: fila?.unidadesDirectas ?? null,
    unidadesIndirectas: fila?.unidadesIndirectas ?? null,
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
    incluirPausadas?: boolean;
    filtro?: FiltroCampanas;
    orden: ColumnaOrden;
    dir: DireccionOrden;
    ahora: Date;
    config?: ConfigPublicidad;
  }
): Promise<TableroPublicidad> {
  const config = opciones.config ?? obtenerConfigPublicidad(empresaId);
  const filtro: FiltroCampanas = opciones.filtro ?? (opciones.incluirPausadas ? "todas" : "activas");
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

    // Mismo criterio que syncActualizoDatos: ok, parcial, o un error
    // que empieza por CorridaIncompletaError. Un error real no pisa
    // la fecha de la última que sí guardó.
    const [ultimaActualizacion] = await tx
      .select({
        terminadaTs: publicidadSincronizaciones.terminadaTs,
        iniciadaTs: publicidadSincronizaciones.iniciadaTs,
      })
      .from(publicidadSincronizaciones)
      .where(
        and(
          eq(publicidadSincronizaciones.empresaId, empresaId),
          eq(publicidadSincronizaciones.cuentaMlId, cuentaMlId),
          or(
            inArray(publicidadSincronizaciones.estado, ["ok", "parcial"]),
            and(
              eq(publicidadSincronizaciones.estado, "error"),
              like(publicidadSincronizaciones.error, `${PREFIJO_CORTE_TIEMPO}%`)
            )
          )
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
        presupuestoAutomatico: publicidadCampanas.presupuestoAutomatico,
        roasObjetivo: publicidadCampanas.roasObjetivo,
        creadaMlTs: publicidadCampanas.creadaMlTs,
        actualizadaMlTs: publicidadCampanas.actualizadaMlTs,
      })
      .from(publicidadCampanas)
      .where(filtroCuenta(publicidadCampanas.empresaId, publicidadCampanas.cuentaMlId));

    const filasCambios = await tx
      .select({
        id: publicidadCampanasCambios.id,
        campanaIdMl: publicidadCampanasCambios.campanaIdMl,
        campo: publicidadCampanasCambios.campo,
        valorAnterior: publicidadCampanasCambios.valorAnterior,
        valorNuevo: publicidadCampanasCambios.valorNuevo,
        detectadoTs: publicidadCampanasCambios.detectadoTs,
      })
      .from(publicidadCampanasCambios)
      .where(
        and(
          eq(publicidadCampanasCambios.empresaId, empresaId),
          eq(publicidadCampanasCambios.cuentaMlId, cuentaMlId),
          // Desde el día 1 del periodo, hora de Bogotá.
          gte(publicidadCampanasCambios.detectadoTs, new Date(`${periodo.desde}T00:00:00-05:00`))
        )
      )
      .orderBy(desc(publicidadCampanasCambios.detectadoTs))
      .limit(LIMITE_HISTORIAL_CAMBIOS);
    const nombrePorCampana = new Map(campanas.map((c) => [c.campanaIdMl, c.nombre ?? "Campaña sin nombre"]));
    const cambios: CambioCampana[] = filasCambios.flatMap((fila) =>
      esCampoCambio(fila.campo)
        ? [{ ...fila, campo: fila.campo, nombre: nombrePorCampana.get(fila.campanaIdMl) ?? "Campaña sin nombre" }]
        : []
    );

    const anuncios = await tx
      .select({
        id: publicidadAnuncios.id,
        adGroupId: publicidadAnuncios.adGroupId,
        campanaIdMl: publicidadAnuncios.campanaIdMl,
        itemId: publicidadAnuncios.itemId,
        titulo: publicidadAnuncios.titulo,
        permalink: publicidadAnuncios.permalink,
        precio: publicidadAnuncios.precio,
        estado: publicidadAnuncios.estado,
      })
      .from(publicidadAnuncios)
      .where(and(eq(publicidadAnuncios.empresaId, empresaId), eq(publicidadAnuncios.cuentaMlId, cuentaMlId)));

    const precios = await tx
      .selectDistinctOn([publicidadCostosItem.itemId], {
        itemId: publicidadCostosItem.itemId,
        precio: publicidadCostosItem.precioVentaVigente,
        skuCodigo: publicidadCostosItem.skuCodigo,
        comisionMl: publicidadCostosItem.comisionMl,
        envioVendedorEstimado: publicidadCostosItem.envioVendedorEstimado,
        compradorPagaEnvio: publicidadCostosItem.compradorPagaEnvio,
        logisticType: publicidadCostosItem.logisticType,
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

    // Costo, empaque y envío a agencia por SKU (tabla maestra de Finanzas).
    const costoPorSku = await leerCostosPorSku(
      tx,
      empresaId,
      precios.flatMap((fila) => {
        const sku = skuDePublicacion(fila.skuCodigo);
        return sku ? [sku] : [];
      })
    );

    const [ajustes] = await tx
      .select({ meta: configuracionFinanzas.metaMargenPublicidad })
      .from(configuracionFinanzas)
      .where(eq(configuracionFinanzas.empresaId, empresaId));

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
          ventasCantidad: sum(publicidadMetricasDiarias.ventasPublicidad),
          unidadesTotal: sum(publicidadMetricasDiarias.unidadesTotal),
          unidadesDirectas: sum(publicidadMetricasDiarias.unidadesDirectas),
          unidadesIndirectas: sum(publicidadMetricasDiarias.unidadesIndirectas),
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
          ventasCantidad: sum(publicidadMetricasDiarias.ventasPublicidad),
          unidadesTotal: sum(publicidadMetricasDiarias.unidadesTotal),
          unidadesDirectas: sum(publicidadMetricasDiarias.unidadesDirectas),
          unidadesIndirectas: sum(publicidadMetricasDiarias.unidadesIndirectas),
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
          ventasCantidad: fila?.ventasCantidad ?? null,
          unidadesTotal: fila?.unidadesTotal ?? null,
          unidadesDirectas: fila?.unidadesDirectas ?? null,
          unidadesIndirectas: fila?.unidadesIndirectas ?? null,
        }),
      ]);
    }

    // En serie: es la misma transacción y la misma conexión. En paralelo
    // postgres.js puede mezclar las respuestas.
    const metricasCampana = await sumar("campana", periodo.desde, periodo.hasta);
    const metricasPrevias = await sumar("campana", periodo.comparacionDesde, periodo.comparacionHasta);
    const metricasAnuncio = await sumar("anuncio", periodo.desde, periodo.hasta);
    const hoy = hoyBogota(opciones.ahora);
    const metricasAnuncioRecientes = await sumar("anuncio", restarDiasIso(hoy, DIAS_SIN_VENDER_VENDEDOR), restarDiasIso(hoy, 1));
    const resumenActual = await sumarCuenta(periodo.desde, periodo.hasta);
    const resumenAnterior = await sumarCuenta(periodo.comparacionDesde, periodo.comparacionHasta);
    const filasDia = await tx
      .select({
        fecha: publicidadMetricasDiarias.fecha,
        costo: sum(publicidadMetricasDiarias.costo),
        montoTotal: sum(publicidadMetricasDiarias.montoTotal),
        ventasOrganicasMonto: sum(publicidadMetricasDiarias.ventasOrganicasMonto),
        clicks: sum(publicidadMetricasDiarias.clicks),
        impresiones: sum(publicidadMetricasDiarias.impresiones),
        ventasCantidad: sum(publicidadMetricasDiarias.ventasPublicidad),
        unidadesTotal: sum(publicidadMetricasDiarias.unidadesTotal),
        unidadesDirectas: sum(publicidadMetricasDiarias.unidadesDirectas),
        unidadesIndirectas: sum(publicidadMetricasDiarias.unidadesIndirectas),
      })
      .from(publicidadMetricasDiarias)
      .where(
        and(
          eq(publicidadMetricasDiarias.empresaId, empresaId),
          eq(publicidadMetricasDiarias.cuentaMlId, cuentaMlId),
          eq(publicidadMetricasDiarias.nivel, "campana"),
          gte(publicidadMetricasDiarias.fecha, periodo.desde),
          lte(publicidadMetricasDiarias.fecha, periodo.hasta)
        )
      )
      .groupBy(publicidadMetricasDiarias.fecha);
    const stockPorItem = new Map(
      (
        await tx
          .select({ item: publicaciones.publicacionIdExterno, stock: publicaciones.stock })
          .from(publicaciones)
          .where(and(eq(publicaciones.empresaId, empresaId), eq(publicaciones.cuentaMlId, cuentaMlId)))
      ).map((fila) => [fila.item, fila.stock])
    );

    const porCampana = new Map(metricasCampana.map((fila) => [fila.entidadIdMl, fila]));
    const porPrevia = new Map(metricasPrevias.map((fila) => [fila.entidadIdMl, fila]));
    const porAnuncio = new Map(metricasAnuncio.map((fila) => [claveAnuncio(fila.entidadIdMl, fila.adGroupId), fila]));
    const porAnuncioReciente = new Map(metricasAnuncioRecientes.map((fila) => [claveAnuncio(fila.entidadIdMl, fila.adGroupId), fila]));
    const precioPorItem = new Map(precios.map((fila) => [fila.itemId, fila.precio]));
    const costoItemPorItem = new Map(precios.map((fila) => [fila.itemId, fila]));
    const margenDe = (itemId: string): MargenProducto => {
      const item = costoItemPorItem.get(itemId);
      const sku = skuDePublicacion(item?.skuCodigo);
      const costos = sku ? costoPorSku.get(sku) : undefined;
      return margenRealProducto({
        sku,
        precio: item?.precio ?? null,
        costo: costos?.costo ?? null,
        empaque: costos?.empaque ?? null,
        envioAgencia: costos?.envioAgencia ?? null,
        full: item?.logisticType === LOGISTICA_FULL,
        comisionMl: item?.comisionMl ?? null,
        envioMl: item?.envioVendedorEstimado ?? null,
        compradorPagaEnvio: item?.compradorPagaEnvio ?? null,
      });
    };

    const calculadas: CampanaCalculada[] = campanas.map((campana) => {
      const totales = totalesDeDias([diaDeSuma(porCampana.get(campana.campanaIdMl))]);
      const totalesAnterior = totalesDeDias([diaDeSuma(porPrevia.get(campana.campanaIdMl))]);
      const anunciosDeLaCampana = anuncios
        .filter((anuncio) => anuncio.campanaIdMl === campana.campanaIdMl)
        .map((anuncio): AnuncioCalculado => {
          const totalesAnuncio = totalesDeDias([diaDeSuma(porAnuncio.get(claveAnuncio(anuncio.itemId, anuncio.adGroupId)))]);
          const precio = anuncio.precio ?? precioPorItem.get(anuncio.itemId) ?? null;
          const stock = stockPorItem.get(anuncio.itemId);
          return {
            id: anuncio.id,
            adGroupId: anuncio.adGroupId,
            itemId: anuncio.itemId,
            titulo: anuncio.titulo,
            href: enlaceAnuncio(anuncio.permalink, anuncio.itemId),
            precio,
            estado: anuncio.estado,
            sinStock: stock === undefined ? null : stock <= 0,
            totales: totalesAnuncio,
            ultimosDias: totalesDeDias([diaDeSuma(porAnuncioReciente.get(claveAnuncio(anuncio.itemId, anuncio.adGroupId)))]),
            semaforo: semaforoAnuncio({
              gasto: totalesAnuncio.gasto,
              ventasPublicidad: totalesAnuncio.ventasPublicidad,
              precio,
              config,
            }),
            margen: margenDe(anuncio.itemId),
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
        presupuestoAutomatico: campana.presupuestoAutomatico,
        diasAprendizaje: config.diasAprendizaje,
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
        totalesAnterior,
        anuncios: anunciosDeLaCampana,
      };
    });

    const visibles = calculadas
      .filter((campana) => {
        if (filtro === "todas") return true;
        if (filtro === "pausadas") return !campana.activa;
        return campana.activa;
      })
      .sort((a, b) => compararOrden(a, b, opciones.orden, opciones.dir));

    return {
      anunciante: anunciante ?? null,
      ultimaActualizacion: ultimaActualizacion ?? null,
      enCurso: Boolean(enCursoFila),
      resumen: { actual: resumenActual, anterior: resumenAnterior },
      campanas: visibles,
      nombresCampanas: calculadas.map((c) => c.nombre),
      cantidadActivas: calculadas.filter((c) => c.activa).length,
      cantidadPausadas: calculadas.filter((c) => !c.activa).length,
      diasRango: diasEntreInclusive(periodo.desde, periodo.hasta),
      presupuestoDiarioTotal: sumarMontos(calculadas.filter((c) => c.activa).map((c) => c.presupuestoDiario)),
      rentabilidad: { margen: config.margenProducto, minimo: config.margenMinimoPostAds },
      cambios,
      metaMargen: ajustes?.meta ?? META_MARGEN_DEFECTO,
      serieDiaria: armarSerieDiaria(
        periodo.desde,
        periodo.hasta,
        filasDia.map((fila) => ({
          fecha: fila.fecha,
          costo: fila.costo,
          montoTotal: fila.montoTotal,
          ventasOrganicasMonto: fila.ventasOrganicasMonto,
          clicks: fila.clicks,
          impresiones: fila.impresiones,
          ventasCantidad: fila.ventasCantidad,
          unidadesTotal: fila.unidadesTotal,
          unidadesDirectas: fila.unidadesDirectas,
          unidadesIndirectas: fila.unidadesIndirectas,
        }))
      ),
    };
  });
}

// Issue #256 — pestaña "Ganancia real por producto". Todas las
// publicaciones sincronizadas de la cuenta (anunciadas o no) más las
// que tienen foto de precio y comisión aunque no estén importadas.
// Precio, comisión y envío salen de la última foto de
// publicidad_costos_item; los costos, de la tabla de Finanzas (solo
// lectura). No llama a Mercado Libre.
export type GananciaProductos = {
  filas: FilaGanancia[];
  metaMargen: string;
  // Cuándo se consultaron a Mercado Libre los precios y comisiones de
  // la foto más reciente. null si todavía no hay ninguna.
  consultadoTs: Date | null;
};

export async function consultarGananciaProductos(empresaId: string, cuentaMlId: string): Promise<GananciaProductos> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const fotos = await tx
      .selectDistinctOn([publicidadCostosItem.itemId], {
        itemId: publicidadCostosItem.itemId,
        skuCodigo: publicidadCostosItem.skuCodigo,
        precio: publicidadCostosItem.precioVentaVigente,
        precioRegular: publicidadCostosItem.precioRegular,
        comisionMl: publicidadCostosItem.comisionMl,
        envioVendedorEstimado: publicidadCostosItem.envioVendedorEstimado,
        compradorPagaEnvio: publicidadCostosItem.compradorPagaEnvio,
        logisticType: publicidadCostosItem.logisticType,
        consultadoTs: publicidadCostosItem.consultadoTs,
      })
      .from(publicidadCostosItem)
      .where(and(eq(publicidadCostosItem.empresaId, empresaId), eq(publicidadCostosItem.cuentaMlId, cuentaMlId)))
      .orderBy(asc(publicidadCostosItem.itemId), desc(publicidadCostosItem.fecha), desc(publicidadCostosItem.consultadoTs));

    const publicadas = await tx
      .select({ itemId: publicaciones.publicacionIdExterno, titulo: publicaciones.titulo, skuCodigo: skus.codigo })
      .from(publicaciones)
      .leftJoin(skus, and(eq(skus.id, publicaciones.skuId), eq(skus.empresaId, publicaciones.empresaId)))
      .where(and(eq(publicaciones.empresaId, empresaId), eq(publicaciones.cuentaMlId, cuentaMlId)));

    const anunciados = await tx
      .select({ itemId: publicidadAnuncios.itemId, titulo: publicidadAnuncios.titulo })
      .from(publicidadAnuncios)
      .where(and(eq(publicidadAnuncios.empresaId, empresaId), eq(publicidadAnuncios.cuentaMlId, cuentaMlId)));

    const [ajustes] = await tx
      .select({ meta: configuracionFinanzas.metaMargenPublicidad })
      .from(configuracionFinanzas)
      .where(eq(configuracionFinanzas.empresaId, empresaId));
    const metaMargen = ajustes?.meta ?? META_MARGEN_DEFECTO;

    const fotoPorItem = new Map(fotos.map((foto) => [foto.itemId, foto]));
    const publicadaPorItem = new Map(publicadas.map((fila) => [fila.itemId, fila]));
    const tituloAnuncio = new Map(anunciados.map((fila) => [fila.itemId, fila.titulo]));
    const items = [...new Set([...publicadaPorItem.keys(), ...fotoPorItem.keys()])];

    // Con foto, el SKU es el de la publicación en Mercado Libre (puede no
    // tener). Sin foto todavía, el del SKU enlazado en Zilonix, si hay.
    const skuDeItem = (itemId: string): string | null => {
      const foto = fotoPorItem.get(itemId);
      return foto ? foto.skuCodigo : (publicadaPorItem.get(itemId)?.skuCodigo ?? null);
    };
    const costoPorSku = await leerCostosPorSku(
      tx,
      empresaId,
      items.flatMap((itemId) => {
        const sku = skuDePublicacion(skuDeItem(itemId));
        return sku ? [sku] : [];
      })
    );

    const filas = items.map((itemId) => {
      const foto = fotoPorItem.get(itemId);
      const sku = skuDeItem(itemId);
      const normalizado = skuDePublicacion(sku);
      return calcularFilaGanancia(
        {
          itemId,
          titulo: publicadaPorItem.get(itemId)?.titulo ?? tituloAnuncio.get(itemId) ?? null,
          sku,
          anunciado: tituloAnuncio.has(itemId),
          precio: foto?.precio ?? null,
          precioRegular: foto?.precioRegular ?? null,
          comisionMl: foto?.comisionMl ?? null,
          envioMl: foto?.envioVendedorEstimado ?? null,
          compradorPagaEnvio: foto?.compradorPagaEnvio ?? null,
          logisticType: foto?.logisticType ?? null,
          costos: normalizado ? costoPorSku.get(normalizado) : undefined,
        },
        metaMargen
      );
    });

    const consultadoTs = fotos.reduce<Date | null>(
      (ultimo, foto) => (ultimo === null || foto.consultadoTs > ultimo ? foto.consultadoTs : ultimo),
      null
    );
    return { filas, metaMargen, consultadoTs };
  });
}
