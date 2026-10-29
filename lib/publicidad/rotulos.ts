// Issue #255 — rótulos del tablero en un solo lugar. La pantalla no
// escribe estos textos en el JSX: si Melisa cambia una palabra, se
// cambia acá.

import { mostrarMonto } from "@/lib/finanzas/montos";
import { mostrarPorcentaje } from "@/components/finanzas/formato";
import type { EstadoChip } from "@/components/marco/Chip";
import { porcentajeDeRazon, type Diagnostico, type Semaforo, type TipoDiagnostico } from "@/lib/publicidad/kpis";

export const ROTULO_KPI = {
  inversion: "Inversión",
  ventasPublicidad: "Ventas con publicidad",
  ventasTotales: "Ventas totales",
  roas: "ROAS",
  acos: "ACOS",
  tacos: "TACOS",
  cpc: "CPC promedio",
  clics: "Clics",
  impresiones: "Impresiones",
} as const;

export const ROTULO_COLUMNA_CAMPANA = {
  campana: "Campaña",
  estado: "Estado",
  inversion: "Inversión",
  ventasPublicidad: "Ventas con publicidad",
  ventasTotales: "Ventas totales",
  roas: "ROAS",
  acos: "ACOS",
  tacos: "TACOS",
  cpc: "CPC",
  clics: "Clics",
  impresiones: "Impresiones",
  presupuesto: "Presupuesto diario",
} as const;

export const ROTULO_COLUMNA_ANUNCIO = {
  mco: "MCO",
  titulo: "Título",
  cpc: "CPC",
  clics: "Clics",
  gasto: "Gasto",
  ventasPublicidad: "Ventas con publicidad",
  roas: "ROAS",
  acos: "ACOS",
  ventasSinPublicidad: "Ventas sin publicidad",
  tacos: "TACOS",
  semaforo: "Semáforo",
} as const;

export const ROTULO_DIAGNOSTICO: Record<Exclude<TipoDiagnostico, "aprendiendo">, string> = {
  excelente: "Excelente",
  en_objetivo: "En objetivo",
  bajo_objetivo: "Bajo objetivo",
  sin_objetivo: "Sin objetivo",
  sin_datos: "Sin datos",
};

export const NOTA_DIAGNOSTICO = {
  aprendiendo: "No tocar, en aprendizaje",
  excelente: "No tocar, en revisión",
  verificarMl: "Verificar en Mercado Libre",
} as const;

export const ESTADO_CHIP_DIAGNOSTICO: Record<TipoDiagnostico, EstadoChip> = {
  aprendiendo: "aviso",
  excelente: "exito",
  en_objetivo: "exito",
  bajo_objetivo: "peligro",
  sin_objetivo: "neutro",
  sin_datos: "neutro",
};

export const ROTULO_SEMAFORO = {
  dentro: "Dentro del tope",
  pasa: "Pasa el tope",
  sinDato: "—",
} as const;

export const NOTA_VENTAS_ORGANICAS =
  "Ventas de las publicaciones promocionadas que no vinieron de un clic. No es el total orgánico de la tienda.";

export const NOTA_TACOS_PROMOCIONADAS = "De publicaciones promocionadas.";

export const NOTA_TACOS_TIENDA = "TACOS de toda la tienda: —";

export const AYUDA_TACOS_TIENDA =
  "El TACOS de toda la tienda incluye publicaciones sin publicidad. No está en Product Ads, así que acá queda en —.";

export const AYUDA_DIAGNOSTICO = "Calculado por Zilonix, no viene de Mercado Libre.";

export const AYUDA_SEMAFORO =
  "Calculado por Zilonix con el ACOS del anuncio o, si no vendió, con el gasto contra el precio. No viene de Mercado Libre.";

export const AYUDA_PRESUPUESTO =
  "Es el promedio diario del presupuesto del mes. Un día puede gastar más usando el saldo de días anteriores. No es una alerta.";

export const NOTA_ATRIBUCION =
  "Mercado Libre actualiza las métricas a diario (cerca de las 8:00 a. m., hora de Bogotá) y una venta puede atribuirse hasta 14 días después del clic. Las cifras de los últimos 14 días pueden seguir cambiando.";

export const NOTA_HOY_INCOMPLETO =
  "El día de hoy puede venir incompleto: Mercado Libre corta el día en una zona horaria que no está documentada.";

export const ROTULO_PERIODO = {
  mesEnCurso: "Mes en curso",
  mesAnterior: "Mes anterior",
  verPausadas: "Ver pausadas",
  ocultarPausadas: "Ocultar pausadas",
  pausada: "Pausada en Mercado Libre",
} as const;

export const COLUMNAS_CAMPANA = 12;

export function rotuloDiagnostico(diagnostico: Diagnostico): string {
  if (diagnostico.tipo === "aprendiendo") {
    const n = diagnostico.dias;
    return `Aprendiendo · ${n} ${n === 1 ? "día" : "días"}`;
  }
  return ROTULO_DIAGNOSTICO[diagnostico.tipo];
}

function topeVisible(tope: string): string {
  const porcentaje = porcentajeDeRazon(tope, "1");
  if (porcentaje === null) return tope;
  const [entera, fraccion = "0"] = porcentaje.split(".");
  return fraccion === "0" ? entera : porcentaje.replace(".", ",");
}

export function rotuloSemaforo(semaforo: Semaforo): string {
  if (semaforo.estado === "neutro") return ROTULO_SEMAFORO.sinDato;
  return semaforo.estado === "exito" ? ROTULO_SEMAFORO.dentro : ROTULO_SEMAFORO.pasa;
}

// El chip no se entiende solo por el color: el title dice el porqué
// ("ACOS 27,4% > tope 20%").
export function tituloSemaforo(semaforo: Semaforo): string {
  if (semaforo.motivo === "acos") {
    const tope = topeVisible(semaforo.tope);
    const acos = semaforo.acos.replace(".", ",");
    const marca = semaforo.estado === "exito" ? "≤" : ">";
    return `ACOS ${acos}% ${marca} tope ${tope}%`;
  }
  if (semaforo.motivo === "gasto") {
    const tope = topeVisible(semaforo.tope);
    const marca = semaforo.estado === "exito" ? "≤" : ">";
    return `Gasto ${mostrarMonto(semaforo.gasto)} ${marca} ${tope}% del precio (${mostrarMonto(semaforo.precio)})`;
  }
  if (semaforo.motivo === "sin_precio") return "Sin precio vigente";
  return "Sin gasto en el rango";
}

// En inversión, ventas, ROAS, clics e impresiones, subir es mejor.
// En ACOS, TACOS y CPC, subir es peor: el texto lo dice, el color solo lo refuerza.
export type VariacionPintada = { texto: string; mejor: boolean | null };

const CAMPOS_SUBIR_ES_PEOR = new Set(["acos", "tacos", "cpc"]);

export function subirEsMejor(campo: string): boolean {
  return !CAMPOS_SUBIR_ES_PEOR.has(campo);
}

export function textoVariacion(variacion: string | null, opciones?: { subirEsMejor?: boolean }): VariacionPintada {
  const mejorSiSube = opciones?.subirEsMejor !== false;
  if (variacion === null) return { texto: "Sin datos para comparar", mejor: null };
  if (variacion === "0.0" || variacion === "-0.0") return { texto: "Igual que el periodo anterior", mejor: null };
  const baja = variacion.startsWith("-");
  const absoluto = mostrarPorcentaje(baja ? variacion.slice(1) : variacion);
  const mejor = baja ? !mejorSiSube : mejorSiSube;
  const juicio = mejor ? "mejor" : "peor";
  return {
    texto: baja ? `Baja ${absoluto} (${juicio})` : `Sube ${absoluto} (${juicio})`,
    mejor,
  };
}
