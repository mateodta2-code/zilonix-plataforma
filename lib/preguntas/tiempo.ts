// Preguntas y reclamos — cuánto lleva esperando una pregunta. Mercado
// Libre mide el tiempo de respuesta en la reputación, así que la
// pantalla lo pone a la vista. Los umbrales son de la pantalla, no
// una regla oficial de Mercado Libre.

export const UMBRAL_AMARILLO_MIN = 60;
export const UMBRAL_ROJO_MIN = 12 * 60;

export type TonoEspera = "exito" | "advertencia" | "peligro" | "neutro";

export function minutosDesde(fechaIso: string | null, ahora: Date): number | null {
  if (!fechaIso) return null;
  const ms = Date.parse(fechaIso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((ahora.getTime() - ms) / 60_000));
}

export function textoEspera(minutos: number | null): string {
  if (minutos === null) return "—";
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

export function tonoEspera(minutos: number | null): TonoEspera {
  if (minutos === null) return "neutro";
  if (minutos < UMBRAL_AMARILLO_MIN) return "exito";
  if (minutos < UMBRAL_ROJO_MIN) return "advertencia";
  return "peligro";
}

// Rótulos de los códigos de Mercado Libre que la pantalla sí conoce.
// Un código desconocido se muestra tal cual, nunca se inventa.
const TIPO_RECLAMO: Record<string, string> = { mediations: "Mediación", claim: "Reclamo" };
const ETAPA_RECLAMO: Record<string, string> = { claim: "Reclamo", dispute: "Disputa" };

export function rotuloTipoReclamo(tipo: string | null): string {
  if (!tipo) return "—";
  return TIPO_RECLAMO[tipo] ?? tipo;
}

export function rotuloEtapaReclamo(etapa: string | null): string {
  if (!etapa) return "—";
  return ETAPA_RECLAMO[etapa] ?? etapa;
}
