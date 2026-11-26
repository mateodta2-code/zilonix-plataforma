// Optimización — bitácora: la parte pura (rótulos y resultado de un
// cambio a los 7 días). La lectura de la auditoría está en bitacora.ts.

import { restarDiasIso } from "@/lib/publicidad/plan";
import { resumirPeriodo, type DiaPublicidad, type LineaVendida, type ResumenPeriodo } from "./calculos";

export const DIAS_MEDICION = 7;
// Hasta cuándo un cambio sale como «listo para revisar» en la lista.
export const DIAS_AVISO_REVISION = 14;

// Accionables marcados «hecho» desde Rendimiento (#707): se guardan como nota
// de bitácora con este prefijo y se miden a 14 días (no a 7).
export const PREFIJO_ACCIONABLE = "Accionable hecho: ";
export const DIAS_MEDICION_ACCIONABLE = 14;
export const DIAS_AVISO_REVISION_ACCIONABLE = 21;

export function esNotaAccionable(texto: string | null | undefined): boolean {
  return typeof texto === "string" && texto.startsWith(PREFIJO_ACCIONABLE);
}

// Días de medición de un cambio según su nota (las que no son de accionable siguen a 7).
export function diasMedicionDe(texto: string | null | undefined): number {
  return esNotaAccionable(texto) ? DIAS_MEDICION_ACCIONABLE : DIAS_MEDICION;
}

export function diasAvisoDe(texto: string | null | undefined): number {
  return esNotaAccionable(texto) ? DIAS_AVISO_REVISION_ACCIONABLE : DIAS_AVISO_REVISION;
}

export const ACCIONES_BITACORA: Record<string, string> = {
  cambiar_precio_publicacion: "Precio",
  cambiar_titulo_publicacion: "Título",
  cambiar_fotos_publicacion: "Fotos",
  pausar_publicacion: "Pausó la publicación",
  activar_publicacion: "Activó la publicación",
};

// Texto que deja editarFotosAction en el detalle cuando entró una foto de IA.
export const MARCA_FOTO_IA_ROTULO = "con IA";

export type ResultadoCambio =
  | { estado: "midiendo"; faltanDias: number }
  | { estado: "listo"; antes: ResumenPeriodo; despues: ResumenPeriodo; desde: string; hasta: string };

// Semana antes (7 días hasta el día anterior al cambio) contra la semana
// desde el cambio (el día del cambio y los 6 siguientes). Listo cuando ya
// terminó esa semana.
export function resultadoCambio(
  dia: string,
  hoy: string,
  base: { lineas: LineaVendida[]; publicidad: DiaPublicidad[]; visitasPorDia: Map<string, number> | null; visitasDesde: string; conFinanzas: boolean },
  dias: number = DIAS_MEDICION
): ResultadoCambio {
  const finDespues = restarDiasIso(dia, -(dias - 1));
  if (finDespues >= hoy) {
    const faltanDias = Math.round((Date.parse(`${finDespues}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000) + 1;
    return { estado: "midiendo", faltanDias };
  }
  const desdeAntes = restarDiasIso(dia, dias);
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
export function listoParaRevisar(dia: string, hoy: string, dias: number = DIAS_MEDICION, diasAviso: number = DIAS_AVISO_REVISION): boolean {
  return restarDiasIso(dia, -(dias - 1)) < hoy && dia >= restarDiasIso(hoy, diasAviso);
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

// ---------- Fotos en la bitácora ----------
export const LARGO_MAXIMO_VALOR_FOTOS = 1500;

// Lista compacta de fotos para valor_anterior / valor_nuevo: una por
// línea, ids de ML tal cual y enlaces https de las nuevas. Con tope de largo.
export function compactarFotos(fotos: string[], tope = LARGO_MAXIMO_VALOR_FOTOS): string {
  let salida = "";
  for (const f of fotos) {
    const siguiente = salida ? `${salida}\n${f}` : f;
    if (siguiente.length > tope) break;
    salida = siguiente;
  }
  return salida;
}

export function leerFotosCompactas(valor: string | null | undefined): string[] {
  return typeof valor === "string" ? valor.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

