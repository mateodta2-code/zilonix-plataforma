// Issue #569 — una importación sin `completadoTs` que lleva más de esto
// iniciada se da por abandonada (ej. el proceso se reinició a mitad):
// no cuenta como "en curso", así la pantalla no refresca sin fin.
export const HORAS_MAX_IMPORTACION_EN_CURSO = 6;

export function estaEnCurso(importacion: { completadoTs: Date | null; iniciadoTs: Date | null } | null | undefined, ahora: Date = new Date()): boolean {
  if (!importacion || importacion.completadoTs) return false;
  if (!importacion.iniciadoTs) return true;
  return ahora.getTime() - importacion.iniciadoTs.getTime() < HORAS_MAX_IMPORTACION_EN_CURSO * 3_600_000;
}
