// Issue #255 — pasa los totales ya calculados a los textos de la
// pantalla. No vuelve a calcular un ratio: solo formatea.

import { mostrarPorcentaje } from "@/components/finanzas/formato";
import type { CampanaCalculada, TableroPublicidad } from "@/lib/publicidad/consultas";
import {
  alertaBajo70,
  anunciosMayorGasto,
  aportePorPublicidad,
  fraseConteoEnfriamiento,
  fraseEstado,
  gastaSinVender,
  ordenPorInversionDesc,
  usoPresupuestoDiario,
  variacionPorcentual,
  type PuntoDiario,
  type TonoEstado,
  type TotalesRango,
} from "@/lib/publicidad/kpis";
import { formatearMoneda } from "@/lib/ml/sitios";
import { aEscala } from "@/lib/numeros/normalizar-decimal";
import { mostrarDineroCompacto, mostrarEntero, mostrarFraccion, mostrarRoas, textoObjetivoRoas } from "@/lib/publicidad/formato";
import { recomendarCampana, type CodigoRecomendacion } from "@/lib/publicidad/recomendaciones";
import {
  detalleDiagnostico,
  NOTA_TACOS_PROMOCIONADAS,
  NOTA_UNIDADES,
  NOTA_VENTAS_ORGANICAS,
  NOTA_VENTAS_TOTALES,
  ROTULO_KPI,
  rotuloSemaforo,
  subirEsMejor,
  textoVariacion,
  tituloSemaforo,
  type DiagnosticoVisible,
  type VariacionPintada,
} from "@/lib/publicidad/rotulos";

export type AnuncioPintado = {
  clave: string;
  itemId: string;
  titulo: string;
  href: string | null;
  cpc: string;
  clics: string;
  unidades: string;
  gasto: string;
  ventasPublicidad: string;
  roas: string;
  acos: string;
  ventasOrganicas: string;
  tacos: string;
  semaforoEstado: "exito" | "peligro" | "neutro";
  semaforoRotulo: string;
  semaforoTitle: string;
  estadoAnuncio: string | null;
  gastaSinVender: boolean;
  sugerencia: string | null;
  nota: string | null;
  mayorGasto: boolean;
  sinStock: boolean | null;
  ventasCantidad: string;
  ingresos: string;
};

export type CampanaPintada = {
  id: string;
  nombre: string;
  pausada: boolean;
  estadoTono: TonoEstado;
  estadoFrase: string;
  estadoAvance: number | null;
  verificar: boolean;
  activa: boolean;
  alertaBajo70: boolean;
  anunciosSinVenta: number;
  anunciosEnfriamiento: number;
  textoEnfriamiento: string | null;
  mayorGasto: MayorGastoPintado[];
  recomendaciones: RecomendacionPintada[];
  cantidadAnuncios: number;
  ventasCantidad: string;
  ingresos: string;
  inversion: string;
  ventasPublicidad: string;
  ventasSinPublicidad: string;
  ventasTotales: string;
  unidades: string;
  roas: string;
  roasObjetivo: string | null;
  acos: string;
  tacos: string;
  cpc: string;
  clics: string;
  impresiones: string;
  presupuesto: string;
  presupuestoUsado: string | null;
  presupuestoAvance: number | null;
  diagnostico: DiagnosticoVisible;
  deltas: DeltasCampana;
  anuncios: AnuncioPintado[];
};

export type RecomendacionPintada = {
  codigo: CodigoRecomendacion;
  anuncioId: string | null;
  nombre: string | null;
  texto: string;
  motivo: string;
};

export type MayorGastoPintado = {
  id: string;
  nombre: string;
  inversion: string;
  parte: string | null;
  ventas: string;
};

export type DeltaPintado = { texto: string; mejor: boolean | null };

export type DeltasCampana = {
  ventasAtribuidas: DeltaPintado | null;
  roas: DeltaPintado | null;
  acos: DeltaPintado | null;
  inversion: DeltaPintado | null;
  ingresos: DeltaPintado | null;
  clics: DeltaPintado | null;
  impresiones: DeltaPintado | null;
};

export type KpiPintado = {
  clave: string;
  titulo: string;
  valor: string;
  detalle: string[];
  variacion: VariacionPintada;
  delta: DeltaPintado | null;
};

export type PuntoGrafico = {
  fecha: string;
  ventasAtribuidas: number | null;
  otras: number | null;
  ingresos: number | null;
  inversion: number | null;
  roas: number | null;
  acos: number | null;
  tacos: number | null;
  cpc: number | null;
  clics: number | null;
  impresiones: number | null;
  unidades: number | null;
};

function textoPresupuesto(campana: CampanaCalculada, diasRango: number): Pick<CampanaPintada, "presupuesto" | "presupuestoUsado" | "presupuestoAvance"> {
  const uso = usoPresupuestoDiario({
    gasto: campana.totales.gasto,
    dias: diasRango,
    presupuestoDiario: campana.presupuestoDiario,
    automatico: campana.presupuestoAutomatico,
  });
  if (uso.tipo === "automatico") return { presupuesto: "Automático", presupuestoUsado: null, presupuestoAvance: null };
  if (uso.tipo === "sin_presupuesto") return { presupuesto: "Sin dato", presupuestoUsado: null, presupuestoAvance: null };
  if (uso.tipo === "sin_gasto") {
    return { presupuesto: mostrarDineroCompacto(uso.presupuestoDiario), presupuestoUsado: "Sin gasto en el rango", presupuestoAvance: null };
  }
  return {
    presupuesto: mostrarDineroCompacto(uso.presupuestoDiario),
    presupuestoUsado: `${mostrarEntero(uso.porcentaje)} % usado`,
    presupuestoAvance: uso.avance,
  };
}

export function pintarCampana(campana: CampanaCalculada, diasRango: number, nombresCampanas: readonly string[] = []): CampanaPintada {
  const estado = fraseEstado({
    diagnostico: campana.diagnostico,
    roas: campana.totales.roas,
    roasObjetivo: campana.roasObjetivo,
    diasAprendizaje: campana.diasAprendizaje,
  });
  const aprendiendo = campana.diagnostico.tipo === "aprendiendo";
  const tops = anunciosMayorGasto(
    campana.anuncios.map((anuncio) => ({
      id: anuncio.id,
      titulo: anuncio.titulo,
      itemId: anuncio.itemId,
      gasto: anuncio.totales.gasto,
      ventas: anuncio.totales.ventasPublicidad,
    })),
    campana.totales.gasto
  );
  const idsMayorGasto = new Set(tops.map((top) => top.id));
  const recomendaciones = recomendarCampana({
    aprendiendo,
    nombreCampana: campana.nombre,
    nombresCampanas,
    roas: campana.totales.roas,
    objetivo: campana.roasObjetivo,
    anuncios: campana.anuncios.map((anuncio) => ({
      id: anuncio.id,
      titulo: anuncio.titulo,
      itemId: anuncio.itemId,
      gasto: anuncio.totales.gasto,
      ingresos: anuncio.totales.ventasPublicidad,
      ventasCantidad: anuncio.totales.ventasCantidad,
      roas: anuncio.totales.roas,
    })),
  });
  const anunciosEnfriamiento = recomendaciones.filter((item) => item.codigo === "pasar_enfriamiento").length;
  return {
    id: campana.id,
    nombre: campana.nombre,
    pausada: !campana.activa,
    estadoTono: estado.tono,
    estadoFrase: estado.frase,
    estadoAvance: estado.avance,
    verificar: campana.diagnostico.tipo === "aprendiendo",
    inversion: mostrarDineroCompacto(campana.totales.gasto),
    ventasPublicidad: mostrarDineroCompacto(campana.totales.ventasPublicidad),
    ventasSinPublicidad: mostrarDineroCompacto(campana.totales.ventasOrganicas),
    ventasTotales: mostrarDineroCompacto(campana.totales.ventasTotales),
    unidades: mostrarEntero(campana.totales.unidadesVendidas),
    ventasCantidad: mostrarEntero(campana.totales.ventasCantidad),
    ingresos: mostrarDineroCompacto(campana.totales.ventasTotales),
    activa: campana.activa,
    alertaBajo70: alertaBajo70({
      aprendiendo: campana.diagnostico.tipo === "aprendiendo",
      roas: campana.totales.roas,
      objetivo: campana.roasObjetivo,
    }),
    // El hecho "gasta sin vender" se cuenta siempre, también en
    // aprendizaje o en ANTÁRTIDA, donde no se recomienda mover nada:
    // la recomendación calla, el dato no.
    anunciosSinVenta: campana.anuncios.filter((anuncio) =>
      gastaSinVender(anuncio.totales.gasto, anuncio.totales.ventasPublicidad, anuncio.totales.ventasCantidad)
    ).length,
    recomendaciones,
    anunciosEnfriamiento,
    textoEnfriamiento: anunciosEnfriamiento > 0 ? fraseConteoEnfriamiento(anunciosEnfriamiento) : null,
    mayorGasto: tops.map((top) => ({
      id: top.id,
      nombre: top.nombre,
      inversion: mostrarDineroCompacto(top.gasto),
      parte: top.parte === null ? null : mostrarPorcentaje(top.parte),
      ventas: mostrarDineroCompacto(top.ventas),
    })),
    cantidadAnuncios: campana.anuncios.length,
    diagnostico: detalleDiagnostico({
      diagnostico: campana.diagnostico,
      diasAprendizaje: campana.diasAprendizaje,
      alertaBajo70: alertaBajo70({
        aprendiendo: campana.diagnostico.tipo === "aprendiendo",
        roas: campana.totales.roas,
        objetivo: campana.roasObjetivo,
      }),
    }),
    deltas: {
      ventasAtribuidas: deltaDe(campana.totales, campana.totalesAnterior, "ventasPublicidad"),
      roas: deltaDe(campana.totales, campana.totalesAnterior, "roas"),
      acos: deltaDe(campana.totales, campana.totalesAnterior, "acos"),
      inversion: deltaDe(campana.totales, campana.totalesAnterior, "gasto"),
      ingresos: deltaDe(campana.totales, campana.totalesAnterior, "ventasTotales"),
      clics: deltaDe(campana.totales, campana.totalesAnterior, "clicks"),
      impresiones: deltaDe(campana.totales, campana.totalesAnterior, "impresiones"),
    },
    roas: mostrarRoas(campana.totales.roas),
    roasObjetivo: textoObjetivoRoas(campana.roasObjetivo),
    acos: mostrarFraccion(campana.totales.acos),
    tacos: mostrarFraccion(campana.totales.tacos),
    cpc: mostrarDineroCompacto(campana.totales.cpc),
    clics: mostrarEntero(campana.totales.clicks),
    impresiones: mostrarEntero(campana.totales.impresiones),
    ...textoPresupuesto(campana, diasRango),
    anuncios: ordenPorInversionDesc(campana.anuncios, (anuncio) => anuncio.totales.gasto).map((anuncio) => {
      const recomendacion = recomendaciones.find((item) => item.anuncioId === anuncio.id);
      const esNota = recomendacion?.codigo === "nota_vende_bien";
      return {
      clave: anuncio.id,
      itemId: anuncio.itemId,
      titulo: anuncio.titulo ?? "Sin título",
      href: anuncio.href,
      cpc: mostrarDineroCompacto(anuncio.totales.cpc),
      clics: mostrarEntero(anuncio.totales.clicks),
      gasto: mostrarDineroCompacto(anuncio.totales.gasto),
      ventasPublicidad: mostrarDineroCompacto(anuncio.totales.ventasPublicidad),
      roas: mostrarRoas(anuncio.totales.roas),
      acos: mostrarFraccion(anuncio.totales.acos),
      ventasOrganicas: mostrarDineroCompacto(anuncio.totales.ventasOrganicas),
      tacos: mostrarFraccion(anuncio.totales.tacos),
      semaforoEstado: anuncio.semaforo.estado,
      semaforoRotulo: rotuloSemaforo(anuncio.semaforo),
      semaforoTitle: tituloSemaforo(anuncio.semaforo),
      estadoAnuncio: anuncio.estado,
      gastaSinVender: gastaSinVender(anuncio.totales.gasto, anuncio.totales.ventasPublicidad, anuncio.totales.ventasCantidad),
      sugerencia: recomendacion && !esNota ? recomendacion.texto : null,
      nota: esNota ? recomendacion.texto : null,
      mayorGasto: idsMayorGasto.has(anuncio.id),
      sinStock: anuncio.sinStock,
      ventasCantidad: mostrarEntero(anuncio.totales.ventasCantidad),
      ingresos: mostrarDineroCompacto(anuncio.totales.ventasPublicidad),
      unidades: mostrarEntero(anuncio.totales.unidadesVendidas),
    };
    }),
  };
}

function linea(actual: TotalesRango, anterior: TotalesRango, campo: keyof TotalesRango): VariacionPintada {
  return textoVariacion(variacionPorcentual(actual[campo], anterior[campo]), { subirEsMejor: subirEsMejor(campo) });
}

function deltaDe(actual: TotalesRango, anterior: TotalesRango, campo: keyof TotalesRango): DeltaPintado | null {
  const variacion = variacionPorcentual(actual[campo], anterior[campo]);
  if (variacion === null) return null;
  const pintada = textoVariacion(variacion, { subirEsMejor: subirEsMejor(campo) });
  if (variacion === "0.0" || variacion === "-0.0") return { texto: "0 %", mejor: null };
  const baja = variacion.startsWith("-");
  const absoluto = mostrarPorcentaje(baja ? variacion.slice(1) : variacion);
  return { texto: `${baja ? "−" : "+"}${absoluto}`, mejor: pintada.mejor };
}

function plataTarjeta(valor: string | null, siteId: string): string {
  if (valor === null) return "—";
  const sitio = siteId === "CLP" || siteId === "MLC" || siteId === "MCO" ? 0 : 2;
  const n = Number(aEscala(valor, sitio));
  if (!Number.isFinite(n)) return "—";
  return formatearMoneda(n, siteId);
}

function tarjeta(
  clave: string,
  titulo: string,
  valor: string,
  detalle: string[],
  actual: TotalesRango,
  anterior: TotalesRango,
  campo: keyof TotalesRango
): KpiPintado {
  return { clave, titulo, valor, detalle, variacion: linea(actual, anterior, campo), delta: deltaDe(actual, anterior, campo) };
}

// Una tarjeta por métrica. Ventas atribuidas es el dinero que antes
// se llamaba "Ventas con publicidad". Otras ventas es "Ventas sin
// publicidad". Ingresos es la suma de las dos (antes "Ventas totales"):
// si falta una pata queda en —, y la nota de ventas totales va en esa
// tarjeta. No se repiten con otro título.
export function kpisDelResumen(tablero: Pick<TableroPublicidad, "resumen">, siteId = "MCO"): KpiPintado[] {
  const { actual, anterior } = tablero.resumen;
  return [
    tarjeta("ventasAtribuidas", "Ventas atribuidas", plataTarjeta(actual.ventasPublicidad, siteId), [], actual, anterior, "ventasPublicidad"),
    tarjeta("otrasVentas", "Otras ventas", plataTarjeta(actual.ventasOrganicas, siteId), [NOTA_VENTAS_ORGANICAS], actual, anterior, "ventasOrganicas"),
    tarjeta("roas", ROTULO_KPI.roas, mostrarRoas(actual.roas), [], actual, anterior, "roas"),
    tarjeta("ingresos", "Ingresos", plataTarjeta(actual.ventasTotales, siteId), [NOTA_VENTAS_TOTALES], actual, anterior, "ventasTotales"),
    tarjeta("inversion", ROTULO_KPI.inversion, plataTarjeta(actual.gasto, siteId), [], actual, anterior, "gasto"),
    tarjeta("acos", ROTULO_KPI.acos, mostrarFraccion(actual.acos), [], actual, anterior, "acos"),
    tarjeta("tacos", ROTULO_KPI.tacos, mostrarFraccion(actual.tacos), [NOTA_TACOS_PROMOCIONADAS], actual, anterior, "tacos"),
    tarjeta("cpc", ROTULO_KPI.cpc, plataTarjeta(actual.cpc, siteId), [], actual, anterior, "cpc"),
    tarjeta("clics", ROTULO_KPI.clics, mostrarEntero(actual.clicks), [], actual, anterior, "clicks"),
    tarjeta("impresiones", ROTULO_KPI.impresiones, mostrarEntero(actual.impresiones), [], actual, anterior, "impresiones"),
    tarjeta("unidades", ROTULO_KPI.unidades, mostrarEntero(actual.unidadesVendidas), [NOTA_UNIDADES], actual, anterior, "unidadesVendidas"),
  ];
}

export function plataVisible(valor: string | null, siteId: string): string {
  return plataTarjeta(valor, siteId);
}

export function textoAporte(tablero: Pick<TableroPublicidad, "resumen">): string | null {
  const aporte = aportePorPublicidad(tablero.resumen.actual.ventasPublicidad, tablero.resumen.actual.ventasOrganicas);
  return aporte === null ? null : mostrarPorcentaje(aporte);
}

function aNumero(valor: string | null): number | null {
  if (valor === null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function serieParaGrafico(puntos: readonly PuntoDiario[]): PuntoGrafico[] {
  return puntos.map((punto) => ({
    fecha: punto.fecha,
    ventasAtribuidas: aNumero(punto.ingresos),
    otras: aNumero(punto.ventasSinPublicidad),
    ingresos: aNumero(punto.ventasTotales),
    inversion: aNumero(punto.inversion),
    roas: aNumero(punto.roas),
    acos: aNumero(punto.acos) === null ? null : aNumero(punto.acos)! * 100,
    tacos: aNumero(punto.tacos) === null ? null : aNumero(punto.tacos)! * 100,
    cpc: aNumero(punto.cpc),
    clics: aNumero(punto.clics),
    impresiones: aNumero(punto.impresiones),
    unidades: aNumero(punto.unidades),
  }));
}
