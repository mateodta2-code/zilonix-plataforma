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

// Reclamos-A — plazo para resolver un reclamo (due_date). Faltando
// menos de 24 h el tono es de peligro; menos de 3 días, advertencia.
export const UMBRAL_PLAZO_PELIGRO_MIN = 24 * 60;
export const UMBRAL_PLAZO_ADVERTENCIA_MIN = 3 * 24 * 60;

// Minutos que faltan para la fecha (negativo si ya pasó); null sin fecha.
export function minutosHasta(fechaIso: string | null, ahora: Date): number | null {
  if (!fechaIso) return null;
  const ms = Date.parse(fechaIso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((ms - ahora.getTime()) / 60_000);
}

export function textoPlazo(minutos: number | null): string {
  if (minutos === null) return "sin plazo";
  if (minutos < 0) return "plazo vencido";
  if (minutos < 60) return "vence en menos de 1 h";
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `vence en ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "vence en 1 día" : `vence en ${dias} días`;
}

export function tonoPlazo(minutos: number | null): TonoEspera {
  if (minutos === null) return "neutro";
  if (minutos < UMBRAL_PLAZO_PELIGRO_MIN) return "peligro";
  if (minutos < UMBRAL_PLAZO_ADVERTENCIA_MIN) return "advertencia";
  return "exito";
}

// Para ordenar la lista: el plazo más cercano primero, sin plazo al final.
export function compararPlazo(a: string | null, b: string | null): number {
  const fa = a && Number.isFinite(Date.parse(a)) ? Date.parse(a) : Number.POSITIVE_INFINITY;
  const fb = b && Number.isFinite(Date.parse(b)) ? Date.parse(b) : Number.POSITIVE_INFINITY;
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

// Quién escribió un mensaje del reclamo (sender_role de ML).
const ROL_RECLAMO: Record<string, string> = { complainant: "Comprador", respondent: "Tú", mediator: "Mercado Libre" };

export function rotuloRolReclamo(rol: string | null): string {
  if (!rol) return "—";
  return ROL_RECLAMO[rol] ?? rol;
}
