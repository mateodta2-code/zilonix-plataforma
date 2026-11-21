// Optimización — bitácora: la parte pura (rótulos y resultado de un
// cambio a los 7 días). La lectura de la auditoría está en bitacora.ts.

import { restarDiasIso } from "@/lib/publicidad/plan";
import { resumirPeriodo, type DiaPublicidad, type LineaVendida, type ResumenPeriodo } from "./calculos";

export const DIAS_MEDICION = 7;
// Hasta cuándo un cambio sale como «listo para revisar» en la lista.
export const DIAS_AVISO_REVISION = 14;

export const ACCIONES_BITACORA: Record<string, string> = {
  cambiar_precio_publicacion: "Precio",
  cambiar_titulo_publicacion: "Título",
  cambiar_fotos_publicacion: "Fotos",
  pausar_publicacion: "Pausó la publicación",
  activar_publicacion: "Activó la publicación",
};

export type ResultadoCambio =
  | { estado: "midiendo"; faltanDias: number }
  | { estado: "listo"; antes: ResumenPeriodo; despues: ResumenPeriodo; desde: string; hasta: string };

// Semana antes (7 días hasta el día anterior al cambio) contra la semana
// desde el cambio (el día del cambio y los 6 siguientes). Listo cuando ya
// terminó esa semana.
export function resultadoCambio(
  dia: string,
  hoy: string,
  base: { lineas: LineaVendida[]; publicidad: DiaPublicidad[]; visitasPorDia: Map<string, number> | null; visitasDesde: string; conFinanzas: boolean }
): ResultadoCambio {
  const finDespues = restarDiasIso(dia, -(DIAS_MEDICION - 1));
  if (finDespues >= hoy) {
    const faltanDias = Math.round((Date.parse(`${finDespues}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000) + 1;
    return { estado: "midiendo", faltanDias };
  }
  const desdeAntes = restarDiasIso(dia, DIAS_MEDICION);
  const hastaAntes = restarDiasIso(dia, 1);
  const comun = { lineas: base.lineas, publicidad: base.publicidad, visitasPorDia: base.visitasPorDia, conFinanzas: base.conFinanzas };
  return {
    estado: "listo",
    desde: desdeAntes,
    hasta: finDespues,
    antes: resumirPeriodo({ ...comun, desde: desdeAntes, hasta: hastaAntes, visitasCompletas: desdeAntes >= base.visitasDesde }),
    despues: resumirPeriodo({ ...comun, desde: dia, hasta: finDespues, visitasCompletas: dia >= base.visitasDesde }),
  };
}

// ---------- Revisión y notas (migración 0035) ----------

export const RESULTADOS_REVISION = [
  { id: "sirvio", rotulo: "Sirvió" },
  { id: "no_sirvio", rotulo: "No sirvió" },
  { id: "sin_cambio", rotulo: "Sin cambio" },
] as const;
export type ResultadoRevision = (typeof RESULTADOS_REVISION)[number]["id"];
export const LARGO_NOTA = 500;

export function leerResultadoRevision(valor: unknown): ResultadoRevision | null {
  return RESULTADOS_REVISION.some((r) => r.id === valor) ? (valor as ResultadoRevision) : null;
}

export function limpiarTextoBitacora(valor: unknown, largo = LARGO_NOTA): string {
  return typeof valor === "string" ? valor.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, largo) : "";
}

// Un cambio está listo para revisar cuando terminó su semana de medición y
// no tiene más de 14 días. En días de calendario de Bogotá, igual que el
// resultado del detalle.
export function listoParaRevisar(dia: string, hoy: string): boolean {
  return restarDiasIso(dia, -(DIAS_MEDICION - 1)) < hoy && dia >= restarDiasIso(hoy, DIAS_AVISO_REVISION);
}

// Fecha de una nota («YYYY-MM-DD» del formulario): un día real, no en el
// futuro y de los últimos 150 días (lo que se puede medir). Se guarda al
// mediodía de Bogotá (17:00 UTC) para que ningún huso lo corra de día.
export function leerFechaNota(valor: unknown, hoy: string): Date | null {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const fecha = new Date(`${valor}T17:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) return null;
  if (valor > hoy || valor < restarDiasIso(hoy, 149)) return null;
  return fecha;
}
