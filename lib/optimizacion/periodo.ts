// Optimización, Fase 2 — el período del detalle y el anterior, para
// comparar. Días de Bogotá (mismo criterio que Finanzas y Publicidad).
// Lista blanca: cualquier otro valor cae al período por defecto.

import { diasEntreInclusive, hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";

export const MESES_ELEGIBLES = 4;

// Tope de visitas de ML: 150 días contando hoy (MAXIMO_DIAS_VISITAS en
// lib/ml/cliente.ts). Un rango personalizado no puede empezar antes.
const DIAS_ATRAS_MAXIMO = 149;

export type PeriodoDetalle = {
  clave: string;
  rotulo: string;
  desde: string;
  hasta: string;
  dias: number;
  anteriorDesde: string;
  anteriorHasta: string;
};

export type OpcionPeriodo = { clave: string; rotulo: string };

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function ultimoDiaDelMes(anio: number, mes: number): string {
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${String(mes).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
}

function mesAnterior(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

export function opcionesPeriodo(ahora: Date): OpcionPeriodo[] {
  const hoy = hoyBogota(ahora);
  let anio = Number(hoy.slice(0, 4));
  let mes = Number(hoy.slice(5, 7));
  const opciones: OpcionPeriodo[] = [
    { clave: "hoy", rotulo: "Hoy" },
    { clave: "7", rotulo: "Últimos 7 días" },
    { clave: "30", rotulo: "Últimos 30 días" },
    { clave: "90", rotulo: "Últimos 90 días" },
  ];
  for (let i = 0; i < MESES_ELEGIBLES; i++) {
    const clave = `${anio}-${String(mes).padStart(2, "0")}`;
    opciones.push({ clave, rotulo: i === 0 ? "Este mes" : `${NOMBRES_MES[mes - 1]} ${anio}` });
    ({ anio, mes } = mesAnterior(anio, mes));
  }
  opciones.push({ clave: CLAVE_PERSONALIZADO, rotulo: "Personalizado" });
  return opciones;
}

export const CLAVE_PERSONALIZADO = "personalizado";

// Fecha YYYY-MM-DD que existe de verdad (rechaza 2026-02-31).
function fechaIsoValida(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  return restarDiasIso(valor, 0) === valor;
}

// Rango elegido a mano: invertido se ordena; fuera de [hoy − 149, hoy]
// o basura -> null (el llamador cae al período por defecto).
function resolverPersonalizado(rango: { desde?: unknown; hasta?: unknown } | undefined, hoy: string): PeriodoDetalle | null {
  if (!fechaIsoValida(rango?.desde) || !fechaIsoValida(rango?.hasta)) return null;
  const [desde, hasta] = rango.desde <= rango.hasta ? [rango.desde, rango.hasta] : [rango.hasta, rango.desde];
  if (hasta > hoy || desde < restarDiasIso(hoy, DIAS_ATRAS_MAXIMO)) return null;
  const dias = diasEntreInclusive(desde, hasta);
  const anteriorHasta = restarDiasIso(desde, 1);
  return { clave: CLAVE_PERSONALIZADO, rotulo: "Personalizado", desde, hasta, dias, anteriorDesde: restarDiasIso(anteriorHasta, dias - 1), anteriorHasta };
}

export function resolverPeriodoDetalle(valor: unknown, ahora: Date, rango?: { desde?: unknown; hasta?: unknown }): PeriodoDetalle {
  const hoy = hoyBogota(ahora);
  if (valor === CLAVE_PERSONALIZADO) {
    const personalizado = resolverPersonalizado(rango, hoy);
    if (personalizado) return personalizado;
    return resolverPeriodoDetalle("30", ahora);
  }
  if (valor === "hoy") {
    const ayer = restarDiasIso(hoy, 1);
    return { clave: "hoy", rotulo: "Hoy", desde: hoy, hasta: hoy, dias: 1, anteriorDesde: ayer, anteriorHasta: ayer };
  }
  const opciones = opcionesPeriodo(ahora);
  const clave = typeof valor === "string" && opciones.some((o) => o.clave === valor) ? valor : "30";
  const rotulo = opciones.find((o) => o.clave === clave)?.rotulo ?? clave;

  if (/^\d{4}-\d{2}$/.test(clave)) {
    const anio = Number(clave.slice(0, 4));
    const mes = Number(clave.slice(5, 7));
    const desde = `${clave}-01`;
    const finMes = ultimoDiaDelMes(anio, mes);
    // El mes en curso va hasta hoy y se compara con el mismo tramo del mes
    // anterior; un mes cerrado, con el mes anterior completo.
    const hasta = finMes > hoy ? hoy : finMes;
    const dias = diasEntreInclusive(desde, hasta);
    const previo = mesAnterior(anio, mes);
    const anteriorDesde = `${previo.anio}-${String(previo.mes).padStart(2, "0")}-01`;
    const finPrevio = ultimoDiaDelMes(previo.anio, previo.mes);
    const tramo = restarDiasIso(anteriorDesde, -(dias - 1));
    const anteriorHasta = finMes > hoy && tramo < finPrevio ? tramo : finPrevio;
    return { clave, rotulo, desde, hasta, dias, anteriorDesde, anteriorHasta };
  }

  const dias = Number(clave);
  const desde = restarDiasIso(hoy, dias - 1);
  const anteriorHasta = restarDiasIso(desde, 1);
  return { clave, rotulo, desde, hasta: hoy, dias, anteriorDesde: restarDiasIso(anteriorHasta, dias - 1), anteriorHasta };
}
