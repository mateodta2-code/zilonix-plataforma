// Optimización — el período de la lista de publicaciones: «Hoy», los
// 7/14/30/90 días de siempre (?dias=) o un rango desde–hasta. Puro y con
// lista blanca: cualquier valor raro de la URL cae al período por defecto,
// nunca lanza. Días de Bogotá (hoyBogota), nunca la hora del servidor.

import { limitesDiaBogota } from "@/lib/filtros-listado";
import { diasEntreInclusive, hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";
import { leerDiasMetricas } from "@/lib/optimizacion/textos";

// Visitas aguanta hasta 150 días en Mercado Libre: el rango más viejo
// empieza hoy − 149 (hoy cuenta como el día 150).
export const MAXIMO_DIAS_RANGO = 150;

export type ClavePeriodoLista = "hoy" | "7" | "14" | "30" | "90" | "rango";

export type PeriodoLista = {
  clave: ClavePeriodoLista;
  desde: string; // YYYY-MM-DD de Bogotá, inclusivo
  hasta: string; // YYYY-MM-DD de Bogotá, inclusivo
  dias: number;
  rotulo: string;
  anteriorDesde: string;
  anteriorHasta: string;
};

export type EntradaPeriodoLista = { dias?: unknown; periodo?: unknown; desde?: unknown; hasta?: unknown };

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaValida(valor: unknown): valor is string {
  return typeof valor === "string" && limitesDiaBogota(valor) !== null;
}

function dmes(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MESES_CORTOS[Number(iso.slice(5, 7)) - 1]}`;
}

// «1–15 nov», «28 oct–3 nov»; con año solo si el rango cruza de año.
export function rotuloRango(desde: string, hasta: string): string {
  if (desde === hasta) return dmes(desde);
  if (desde.slice(0, 4) !== hasta.slice(0, 4)) return `${dmes(desde)} ${desde.slice(0, 4)}–${dmes(hasta)} ${hasta.slice(0, 4)}`;
  if (desde.slice(5, 7) === hasta.slice(5, 7)) return `${Number(desde.slice(8, 10))}–${dmes(hasta)}`;
  return `${dmes(desde)}–${dmes(hasta)}`;
}

function periodoDeDias(clave: ClavePeriodoLista, dias: number, hoy: string, rotulo: string): PeriodoLista {
  const desde = restarDiasIso(hoy, dias - 1);
  const anteriorHasta = restarDiasIso(desde, 1);
  return { clave, desde, hasta: hoy, dias, rotulo, anteriorDesde: restarDiasIso(anteriorHasta, dias - 1), anteriorHasta };
}

export function leerPeriodoLista(entrada: EntradaPeriodoLista, ahora: Date): PeriodoLista {
  const hoy = hoyBogota(ahora);

  if (entrada.periodo === "hoy") return periodoDeDias("hoy", 1, hoy, "Hoy");

  if (fechaValida(entrada.desde) && fechaValida(entrada.hasta)) {
    // Un desde posterior al hasta se invierte, no se descarta.
    const [desde, hasta] = entrada.desde <= entrada.hasta ? [entrada.desde, entrada.hasta] : [entrada.hasta, entrada.desde];
    const masViejo = restarDiasIso(hoy, MAXIMO_DIAS_RANGO - 1);
    if (hasta <= hoy && desde >= masViejo) {
      const dias = diasEntreInclusive(desde, hasta);
      const anteriorHasta = restarDiasIso(desde, 1);
      return { clave: "rango", desde, hasta, dias, rotulo: rotuloRango(desde, hasta), anteriorDesde: restarDiasIso(anteriorHasta, dias - 1), anteriorHasta };
    }
  }

  const dias = leerDiasMetricas(entrada.dias);
  return periodoDeDias(String(dias) as ClavePeriodoLista, dias, hoy, `Últimos ${dias} días`);
}

// Parámetros de URL del período, para conservarlo al buscar, paginar,
// cambiar de estado o de cuenta. Los 7 días (por defecto) no llevan nada.
export function parametrosPeriodoLista(p: PeriodoLista): Record<string, string> {
  if (p.clave === "hoy") return { periodo: "hoy" };
  if (p.clave === "rango") return { desde: p.desde, hasta: p.hasta };
  return p.clave === "7" ? {} : { dias: p.clave };
}

// «vs. el día anterior» / «vs. los 15 días anteriores».
export function textoContraAnterior(p: PeriodoLista): string {
  return p.dias === 1 ? "vs. el día anterior" : `vs. los ${p.dias} días anteriores`;
}

// Encabezados de la tabla: «hoy», «1–15 nov», «7 d».
export function rotuloCortoPeriodo(p: PeriodoLista): string {
  if (p.clave === "hoy") return "hoy";
  if (p.clave === "rango") return rotuloRango(p.desde, p.hasta);
  return `${p.dias} d`;
}

// Fecha del día siguiente: el `ending` de visitas es exclusivo.
export function hastaExclusivoIso(p: PeriodoLista): string {
  return restarDiasIso(p.hasta, -1);
}

// «Resumen de la tienda · hoy», «· 1–15 nov», «· últimos 7 días».
export function tituloResumenTienda(p: PeriodoLista): string {
  const periodo = p.clave === "hoy" || p.clave === "rango" ? rotuloCortoPeriodo(p) : `últimos ${p.dias} días`;
  return `Resumen de la tienda · ${periodo}`;
}

// Para la descripción de la página: «de hoy», «del 1–15 nov», «de los últimos 7 días».
export function descripcionPeriodo(p: PeriodoLista): string {
  if (p.clave === "hoy") return "de hoy";
  if (p.clave === "rango") return `del ${p.rotulo}`;
  return `de los ${p.rotulo.toLowerCase()}`;
}
