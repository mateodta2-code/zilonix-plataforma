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
