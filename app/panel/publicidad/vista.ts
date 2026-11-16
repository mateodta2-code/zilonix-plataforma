// Issue #255 — pasa los totales ya calculados a los textos de la
// pantalla. No vuelve a calcular un ratio: solo formatea.

import { fechaHoraBogota, mostrarPorcentaje } from "@/components/finanzas/formato";
import { direccionCambio } from "@/lib/publicidad/cambios";
import type { CampanaCalculada, TableroPublicidad } from "@/lib/publicidad/consultas";
import {
  alertaBajo70,
  anunciosMayorGasto,
  aportePorPublicidad,
  fraseConteoEnfriamiento,
  fraseEstado,
  gastaSinVender,
  gastoPositivo,
  ordenPorInversionDesc,
  rentabilidadCampana,
  roasEquilibrio,
  semaforoMargen,
  semaforoCampana,
  porcentajeDeRazon,
  diasParaEstabilizar,
  type EstadoSemaforoCampana,
  type MargenProducto,
  type EstadoRentabilidad,
  tieneVentaAtribuida,
  usoPresupuestoDiario,
  variacionPorcentual,
  type PuntoDiario,
  type TonoEstado,
  type TotalesRango,
} from "@/lib/publicidad/kpis";
import { formatearMoneda } from "@/lib/ml/sitios";
import { aEscala } from "@/lib/numeros/normalizar-decimal";
import { mostrarDineroCompacto, mostrarEntero, mostrarFraccion, mostrarRoas, textoObjetivoRoas } from "@/lib/publicidad/formato";
import { META_MARGEN_DEFECTO } from "@/lib/publicidad/config";
import { CODIGOS_NOTA, recomendarCampana, type CodigoRecomendacion } from "@/lib/publicidad/recomendaciones";
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
  // Semáforo de productos (margen de ganancia real).
  margen: string;
  margenTono: "exito" | "advertencia" | "peligro" | "neutro";
  margenTitulo: string;
};

// Verde desde la meta, amarillo desde la mitad, rojo bajo la mitad.
export function pintarMargen(margen: MargenProducto, meta: string): Pick<AnuncioPintado, "margen" | "margenTono" | "margenTitulo"> {
  if (margen.tipo === "sin_costo") {
    return {
      margen: "Sin costo",
      margenTono: "neutro",
      margenTitulo: "Este SKU no tiene costo en la tabla de costos de Finanzas. Cargalo para ver su margen.",
    };
  }
  if (margen.tipo === "sin_datos") {
    return {
      margen: "—",
      margenTono: "neutro",
      margenTitulo: "Falta el precio, la comisión o el envío de Mercado Libre. Se completa en la próxima actualización.",
    };
  }
  const color = semaforoMargen(margen.margen, meta);
  return {
    margen: mostrarFraccion(margen.margen),
    margenTono: color === "verde" ? "exito" : color === "amarillo" ? "advertencia" : "peligro",
    margenTitulo: `Ganancia real ${mostrarDineroCompacto(margen.ganancia)} por unidad, sin contar la publicidad. Meta ${mostrarFraccion(meta)}.`,
  };
}

export type SemaforoCampanaPintado = {
  estado: EstadoSemaforoCampana;
  rotulo: string;
  tono: "exito" | "advertencia" | "peligro" | "neutro";
  // "57 %" del objetivo. null sin ROAS u objetivo.
  porcentaje: string | null;
};

const ROTULO_SEMAFORO_CAMPANA: Record<EstadoSemaforoCampana, Omit<SemaforoCampanaPintado, "estado" | "porcentaje">> = {
  en_objetivo: { rotulo: "En objetivo", tono: "exito" },
  bajo_objetivo: { rotulo: "Bajo objetivo", tono: "advertencia" },
  muy_bajo: { rotulo: "Muy bajo", tono: "peligro" },
  sin_objetivo: { rotulo: "Sin objetivo", tono: "neutro" },
  sin_datos: { rotulo: "Sin datos", tono: "neutro" },
};

// "12,00x" -> "12x"; "11,62x" queda igual. Para el objetivo en "ROAS / obj.".
function roasCorto(ratio: string | null): string | null {
  return ratio === null ? null : mostrarRoas(ratio).replace(",00x", "x");
}

export type CampanaPintada = {
  id: string;
  nombre: string;
  semaforo: SemaforoCampanaPintado;
  // "Aprendiendo · estabiliza en 4 días" o "Estable".
  diagnosticoTexto: string;
  // Días que le faltan para salir de aprendizaje; null si ya salió.
  diasParaEstabilizar: number | null;
  roasObjetivoCorto: string | null;
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

export function pintarCampana(
  campana: CampanaCalculada,
  diasRango: number,
  nombresCampanas: readonly string[] = [],
  metaMargen: string = META_MARGEN_DEFECTO
): CampanaPintada {
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
      pasaTopeConsumo: anuncio.semaforo.motivo === "gasto" ? anuncio.semaforo.estado === "peligro" : null,
      topeConsumo: anuncio.semaforo.motivo === "gasto" ? anuncio.semaforo.topeGasto : null,
      acosSobreMaximo: anuncio.semaforo.motivo === "acos" && anuncio.semaforo.estado === "peligro" ? anuncio.semaforo.acos : null,
      gastoUltimosDias: gastoPositivo(anuncio.ultimosDias.gasto),
      vendioUltimosDias: tieneVentaAtribuida(anuncio.ultimosDias.ventasPublicidad, anuncio.ultimosDias.ventasCantidad),
    })),
  });
  const anunciosEnfriamiento = recomendaciones.filter(
    (item) => item.codigo === "pasar_enfriamiento" || item.codigo === "crear_enfriamiento"
  ).length;
  const estadoSemaforo = semaforoCampana(campana.totales.roas, campana.roasObjetivo);
  const porcentajeObjetivo = porcentajeDeRazon(campana.totales.roas, campana.roasObjetivo);
  const faltan = aprendiendo ? diasParaEstabilizar(campana.diagnostico.dias, campana.diasAprendizaje) : null;
  return {
    id: campana.id,
    semaforo: {
      estado: estadoSemaforo,
      ...ROTULO_SEMAFORO_CAMPANA[estadoSemaforo],
      porcentaje: porcentajeObjetivo === null ? null : `${aEscala(porcentajeObjetivo, 0)} %`,
    },
    diagnosticoTexto: faltan === null ? "Estable" : `Aprendiendo · estabiliza en ${faltan} ${faltan === 1 ? "día" : "días"}`,
    diasParaEstabilizar: faltan,
    roasObjetivoCorto: roasCorto(campana.roasObjetivo),
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
      const esNota = recomendacion ? CODIGOS_NOTA.includes(recomendacion.codigo) : false;
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
      nota: esNota && recomendacion ? recomendacion.texto : null,
      mayorGasto: idsMayorGasto.has(anuncio.id),
      sinStock: anuncio.sinStock,
      ventasCantidad: mostrarEntero(anuncio.totales.ventasCantidad),
      ingresos: mostrarDineroCompacto(anuncio.totales.ventasPublicidad),
      unidades: mostrarEntero(anuncio.totales.unidadesVendidas),
      ...pintarMargen(anuncio.margen, metaMargen),
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

export type FilaRentabilidad = {
  id: string;
  nombre: string;
  roas: string;
  margenPostAds: string;
  rotulo: string;
  tono: "exito" | "advertencia" | "peligro" | "neutro";
};

export type RentabilidadPintada = {
  margen: string;
  minimo: string;
  roasEquilibrio: string;
  acosMaximo: string;
  filas: FilaRentabilidad[];
};

const ROTULO_RENTABILIDAD: Record<EstadoRentabilidad, { rotulo: string; tono: FilaRentabilidad["tono"] }> = {
  rentable: { rotulo: "Rentable", tono: "exito" },
  margen_bajo: { rotulo: "Margen bajo", tono: "advertencia" },
  pierde: { rotulo: "Pierde plata", tono: "peligro" },
};

// "30,0 %" -> "30 %" para los parámetros, que son redondos.
function porcentajeRedondo(fraccion: string): string {
  return mostrarFraccion(fraccion).replace(/,0 %$/, " %");
}

// Rentabilidad por campaña con el margen fijo de la config (30 %, mínimo
// 20 % después de Ads). El ACOS máximo es el margen: más que eso, la
// publicidad se come toda la ganancia.
export function pintarRentabilidad(tablero: Pick<TableroPublicidad, "campanas" | "rentabilidad">): RentabilidadPintada {
  const { margen, minimo } = tablero.rentabilidad;
  return {
    margen: porcentajeRedondo(margen),
    minimo: porcentajeRedondo(minimo),
    roasEquilibrio: mostrarRoas(roasEquilibrio(margen)),
    acosMaximo: porcentajeRedondo(margen),
    filas: tablero.campanas.map((campana) => {
      const calculo = rentabilidadCampana({
        gasto: campana.totales.gasto,
        ventasPublicidad: campana.totales.ventasPublicidad,
        margen,
        minimo,
      });
      const visible = calculo ? ROTULO_RENTABILIDAD[calculo.estado] : { rotulo: "Sin gasto", tono: "neutro" as const };
      return {
        id: campana.id,
        nombre: campana.nombre,
        roas: mostrarRoas(campana.totales.roas),
        margenPostAds: calculo?.margenPostAds ? mostrarFraccion(calculo.margenPostAds) : calculo ? "Sin ventas" : "—",
        rotulo: visible.rotulo,
        tono: visible.tono,
      };
    }),
  };
}

export type CambioPintado = {
  id: string;
  fecha: string;
  campana: string;
  que: string;
  antes: string;
  ahora: string;
  direccion: string;
  tono: "exito" | "advertencia" | "neutro";
};

// Historial de presupuesto diario y ROAS objetivo. Subir el presupuesto
// o bajar el ROAS objetivo = la campaña puede gastar más; se marca en
// amarillo para que se note, no como algo malo.
export function pintarCambios(cambios: TableroPublicidad["cambios"]): CambioPintado[] {
  return cambios.map((cambio) => {
    const esPresupuesto = cambio.campo === "presupuesto_diario";
    const mostrar = (valor: string | null) =>
      valor === null ? (esPresupuesto ? "Automático o sin dato" : "Sin objetivo") : esPresupuesto ? mostrarDineroCompacto(valor) : mostrarRoas(valor);
    const direccion = direccionCambio(cambio.valorAnterior, cambio.valorNuevo);
    const gastaMas = esPresupuesto ? direccion === "subio" : direccion === "bajo";
    return {
      id: cambio.id,
      fecha: fechaHoraBogota(cambio.detectadoTs),
      campana: cambio.nombre,
      que: esPresupuesto ? "Presupuesto diario" : "ROAS objetivo",
      antes: mostrar(cambio.valorAnterior),
      ahora: mostrar(cambio.valorNuevo),
      direccion: direccion === "subio" ? "Subió" : direccion === "bajo" ? "Bajó" : "Cambió",
      tono: direccion === "otro" ? "neutro" : gastaMas ? "advertencia" : "exito",
    };
  });
}

export function esBajoObjetivo(campana: Pick<CampanaPintada, "semaforo">): boolean {
  return campana.semaforo.estado === "bajo_objetivo" || campana.semaforo.estado === "muy_bajo";
}

// Nota debajo de la tabla de campañas (como el tablero de referencia):
// cuáles aprenden y no se tocan, a cuánto del objetivo van las que están
// bajo, y la leyenda de los colores.
export function notaSemaforo(campanas: readonly CampanaPintada[]): string {
  const partes: string[] = [];
  const aprendiendo = campanas.filter((c) => c.diasParaEstabilizar !== null);
  if (aprendiendo.length > 0) {
    const lista = aprendiendo
      .map((c) => `${c.nombre} (${c.diasParaEstabilizar} ${c.diasParaEstabilizar === 1 ? "día" : "días"})`)
      .join(", ");
    partes.push(aprendiendo.length === 1 ? `${lista} está en Aprendiendo y no se toca.` : `${lista} están en Aprendiendo y no se tocan.`);
  }
  for (const c of campanas) {
    if (c.diasParaEstabilizar === null && esBajoObjetivo(c) && c.semaforo.porcentaje) {
      partes.push(`${c.nombre} en ${c.semaforo.porcentaje} del objetivo.`);
    }
  }
  partes.push("En objetivo ≥90 % del ROAS objetivo · Bajo 70–90 % · Muy bajo <70 %.");
  return partes.join(" ");
}
