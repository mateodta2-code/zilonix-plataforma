// Issue #255 — pasa los totales ya calculados a los textos de la
// pantalla. No vuelve a calcular un ratio: solo formatea.

import type { EstadoChip } from "@/components/marco/Chip";
import type { CampanaCalculada, TableroPublicidad } from "@/lib/publicidad/consultas";
import {
  mostrarDinero,
  mostrarDineroTarjeta,
  mostrarEntero,
  mostrarFraccion,
  mostrarObjetivoRoas,
  mostrarRoas,
} from "@/lib/publicidad/formato";
import { variacionPorcentual, type TotalesRango } from "@/lib/publicidad/kpis";
import {
  AYUDA_DIAGNOSTICO,
  ESTADO_CHIP_DIAGNOSTICO,
  NOTA_DIAGNOSTICO,
  NOTA_TACOS_PROMOCIONADAS,
  NOTA_VENTAS_ORGANICAS,
  ROTULO_KPI,
  rotuloDiagnostico,
  rotuloSemaforo,
  textoVariacion,
  tituloSemaforo,
} from "@/lib/publicidad/rotulos";

export type AnuncioPintado = {
  clave: string;
  itemId: string;
  titulo: string;
  href: string | null;
  cpc: string;
  clics: string;
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
  chipEstado: EstadoChip;
  chipRotulo: string;
  chipTitle: string;
  nota: string | null;
  verificar: boolean;
  inversion: string;
  ventasPublicidad: string;
  ventasTotales: string;
  roas: string;
  acos: string;
  tacos: string;
  cpc: string;
  clics: string;
  impresiones: string;
  presupuesto: string;
  anuncios: AnuncioPintado[];
};

export type KpiPintado = {
  clave: string;
  titulo: string;
  valor: string;
  detalle: string[];
};

export function pintarCampana(campana: CampanaCalculada): CampanaPintada {
  const nota =
    campana.diagnostico.tipo === "aprendiendo"
      ? NOTA_DIAGNOSTICO.aprendiendo
      : campana.diagnostico.tipo === "excelente"
        ? NOTA_DIAGNOSTICO.excelente
        : null;
  return {
    id: campana.id,
    nombre: campana.nombre,
    pausada: !campana.activa,
    chipEstado: ESTADO_CHIP_DIAGNOSTICO[campana.diagnostico.tipo],
    chipRotulo: rotuloDiagnostico(campana.diagnostico),
    chipTitle: AYUDA_DIAGNOSTICO,
    nota,
    verificar: campana.diagnostico.tipo === "aprendiendo",
    inversion: mostrarDinero(campana.totales.gasto),
    ventasPublicidad: mostrarDinero(campana.totales.ventasPublicidad),
    ventasTotales: mostrarDinero(campana.totales.ventasTotales),
    roas: mostrarObjetivoRoas(campana.totales.roas, campana.roasObjetivo),
    acos: mostrarFraccion(campana.totales.acos),
    tacos: mostrarFraccion(campana.totales.tacos),
    cpc: mostrarDinero(campana.totales.cpc),
    clics: mostrarEntero(campana.totales.clicks),
    impresiones: mostrarEntero(campana.totales.impresiones),
    presupuesto: mostrarDinero(campana.presupuestoDiario),
    anuncios: campana.anuncios.map((anuncio) => ({
      clave: anuncio.id,
      itemId: anuncio.itemId,
      titulo: anuncio.titulo ?? "Sin título",
      href: anuncio.href,
      cpc: mostrarDinero(anuncio.totales.cpc),
      clics: mostrarEntero(anuncio.totales.clicks),
      gasto: mostrarDinero(anuncio.totales.gasto),
      ventasPublicidad: mostrarDinero(anuncio.totales.ventasPublicidad),
      roas: mostrarRoas(anuncio.totales.roas),
      acos: mostrarFraccion(anuncio.totales.acos),
      ventasOrganicas: mostrarDinero(anuncio.totales.ventasOrganicas),
      tacos: mostrarFraccion(anuncio.totales.tacos),
      semaforoEstado: anuncio.semaforo.estado,
      semaforoRotulo: rotuloSemaforo(anuncio.semaforo),
      semaforoTitle: tituloSemaforo(anuncio.semaforo),
    })),
  };
}

function linea(actual: TotalesRango, anterior: TotalesRango, campo: keyof TotalesRango): string {
  return textoVariacion(variacionPorcentual(actual[campo], anterior[campo]));
}

export function kpisDelResumen(tablero: Pick<TableroPublicidad, "resumen">): KpiPintado[] {
  const { actual, anterior } = tablero.resumen;
  return [
    { clave: "inversion", titulo: ROTULO_KPI.inversion, valor: mostrarDineroTarjeta(actual.gasto), detalle: [linea(actual, anterior, "gasto")] },
    {
      clave: "ventasPublicidad",
      titulo: ROTULO_KPI.ventasPublicidad,
      valor: mostrarDineroTarjeta(actual.ventasPublicidad),
      detalle: [linea(actual, anterior, "ventasPublicidad")],
    },
    {
      clave: "ventasTotales",
      titulo: ROTULO_KPI.ventasTotales,
      valor: mostrarDineroTarjeta(actual.ventasTotales),
      detalle: [linea(actual, anterior, "ventasTotales"), NOTA_VENTAS_ORGANICAS],
    },
    { clave: "roas", titulo: ROTULO_KPI.roas, valor: mostrarRoas(actual.roas), detalle: [linea(actual, anterior, "roas")] },
    { clave: "acos", titulo: ROTULO_KPI.acos, valor: mostrarFraccion(actual.acos), detalle: [linea(actual, anterior, "acos")] },
    {
      clave: "tacos",
      titulo: ROTULO_KPI.tacos,
      valor: mostrarFraccion(actual.tacos),
      detalle: [linea(actual, anterior, "tacos"), NOTA_TACOS_PROMOCIONADAS],
    },
    { clave: "cpc", titulo: ROTULO_KPI.cpc, valor: mostrarDineroTarjeta(actual.cpc), detalle: [linea(actual, anterior, "cpc")] },
    { clave: "clics", titulo: ROTULO_KPI.clics, valor: mostrarEntero(actual.clicks), detalle: [linea(actual, anterior, "clicks")] },
    {
      clave: "impresiones",
      titulo: ROTULO_KPI.impresiones,
      valor: mostrarEntero(actual.impresiones),
      detalle: [linea(actual, anterior, "impresiones")],
    },
  ];
}
