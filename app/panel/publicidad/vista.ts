// Issue #255 — pasa los totales ya calculados a los textos de la
// pantalla. No vuelve a calcular un ratio: solo formatea.

import type { CampanaCalculada, TableroPublicidad } from "@/lib/publicidad/consultas";
import { fraseEstado, usoPresupuestoDiario, variacionPorcentual, type TonoEstado, type TotalesRango } from "@/lib/publicidad/kpis";
import {
  mostrarDineroCompacto,
  mostrarDineroTarjeta,
  mostrarEntero,
  mostrarFraccion,
  mostrarRoas,
  textoObjetivoRoas,
} from "@/lib/publicidad/formato";
import {
  NOTA_TACOS_PROMOCIONADAS,
  NOTA_UNIDADES,
  NOTA_VENTAS_ORGANICAS,
  NOTA_VENTAS_TOTALES,
  ROTULO_KPI,
  rotuloSemaforo,
  subirEsMejor,
  textoVariacion,
  tituloSemaforo,
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
};

export type CampanaPintada = {
  id: string;
  nombre: string;
  pausada: boolean;
  estadoTono: TonoEstado;
  estadoFrase: string;
  estadoAvance: number | null;
  verificar: boolean;
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
  anuncios: AnuncioPintado[];
};

export type KpiPintado = {
  clave: string;
  titulo: string;
  valor: string;
  detalle: string[];
  variacion: VariacionPintada;
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

export function pintarCampana(campana: CampanaCalculada, diasRango: number): CampanaPintada {
  const estado = fraseEstado({
    diagnostico: campana.diagnostico,
    roas: campana.totales.roas,
    roasObjetivo: campana.roasObjetivo,
    diasAprendizaje: campana.diasAprendizaje,
  });
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
    roas: mostrarRoas(campana.totales.roas),
    roasObjetivo: textoObjetivoRoas(campana.roasObjetivo),
    acos: mostrarFraccion(campana.totales.acos),
    tacos: mostrarFraccion(campana.totales.tacos),
    cpc: mostrarDineroCompacto(campana.totales.cpc),
    clics: mostrarEntero(campana.totales.clicks),
    impresiones: mostrarEntero(campana.totales.impresiones),
    ...textoPresupuesto(campana, diasRango),
    anuncios: campana.anuncios.map((anuncio) => ({
      clave: anuncio.id,
      itemId: anuncio.itemId,
      titulo: anuncio.titulo ?? "Sin título",
      href: anuncio.href,
      cpc: mostrarDineroCompacto(anuncio.totales.cpc),
      clics: mostrarEntero(anuncio.totales.clicks),
      unidades: mostrarEntero(anuncio.totales.unidadesVendidas),
      gasto: mostrarDineroCompacto(anuncio.totales.gasto),
      ventasPublicidad: mostrarDineroCompacto(anuncio.totales.ventasPublicidad),
      roas: mostrarRoas(anuncio.totales.roas),
      acos: mostrarFraccion(anuncio.totales.acos),
      ventasOrganicas: mostrarDineroCompacto(anuncio.totales.ventasOrganicas),
      tacos: mostrarFraccion(anuncio.totales.tacos),
      semaforoEstado: anuncio.semaforo.estado,
      semaforoRotulo: rotuloSemaforo(anuncio.semaforo),
      semaforoTitle: tituloSemaforo(anuncio.semaforo),
    })),
  };
}

function linea(actual: TotalesRango, anterior: TotalesRango, campo: keyof TotalesRango): VariacionPintada {
  return textoVariacion(variacionPorcentual(actual[campo], anterior[campo]), { subirEsMejor: subirEsMejor(campo) });
}

export function kpisDelResumen(tablero: Pick<TableroPublicidad, "resumen">): KpiPintado[] {
  const { actual, anterior } = tablero.resumen;
  return [
    { clave: "inversion", titulo: ROTULO_KPI.inversion, valor: mostrarDineroTarjeta(actual.gasto), detalle: [], variacion: linea(actual, anterior, "gasto") },
    {
      clave: "ventasPublicidad",
      titulo: ROTULO_KPI.ventasPublicidad,
      valor: mostrarDineroTarjeta(actual.ventasPublicidad),
      detalle: [],
      variacion: linea(actual, anterior, "ventasPublicidad"),
    },
    {
      clave: "ventasSinPublicidad",
      titulo: ROTULO_KPI.ventasSinPublicidad,
      valor: mostrarDineroTarjeta(actual.ventasOrganicas),
      detalle: [NOTA_VENTAS_ORGANICAS],
      variacion: linea(actual, anterior, "ventasOrganicas"),
    },
    {
      clave: "ventasTotales",
      titulo: ROTULO_KPI.ventasTotales,
      valor: mostrarDineroTarjeta(actual.ventasTotales),
      detalle: [NOTA_VENTAS_TOTALES],
      variacion: linea(actual, anterior, "ventasTotales"),
    },
    {
      clave: "unidades",
      titulo: ROTULO_KPI.unidades,
      valor: mostrarEntero(actual.unidadesVendidas),
      detalle: [NOTA_UNIDADES],
      variacion: linea(actual, anterior, "unidadesVendidas"),
    },
    { clave: "roas", titulo: ROTULO_KPI.roas, valor: mostrarRoas(actual.roas), detalle: [], variacion: linea(actual, anterior, "roas") },
    { clave: "acos", titulo: ROTULO_KPI.acos, valor: mostrarFraccion(actual.acos), detalle: [], variacion: linea(actual, anterior, "acos") },
    {
      clave: "tacos",
      titulo: ROTULO_KPI.tacos,
      valor: mostrarFraccion(actual.tacos),
      detalle: [NOTA_TACOS_PROMOCIONADAS],
      variacion: linea(actual, anterior, "tacos"),
    },
    { clave: "cpc", titulo: ROTULO_KPI.cpc, valor: mostrarDineroTarjeta(actual.cpc), detalle: [], variacion: linea(actual, anterior, "cpc") },
    { clave: "clics", titulo: ROTULO_KPI.clics, valor: mostrarEntero(actual.clicks), detalle: [], variacion: linea(actual, anterior, "clicks") },
    {
      clave: "impresiones",
      titulo: ROTULO_KPI.impresiones,
      valor: mostrarEntero(actual.impresiones),
      detalle: [],
      variacion: linea(actual, anterior, "impresiones"),
    },
  ];
}
