import type { EstadoChip } from "@/components/marco/Chip";

// Rama mateo/clip-estado-automatico (Alcance A) — "el estado real del
// clip en Mercado Libre se muestre solo, sin pulsar 'Actualizar
// estado'". Helper puro (sin DOM ni red, probado con vitest sin
// mocks): el mapa de etiquetas y el ritmo de polling automático. El
// efecto que de verdad hace fetch vive en SeccionClip.tsx.

const ETIQUETAS_MODERACION: Record<"UNDER_REVIEW" | "PUBLISHED" | "REJECTED", { texto: string; estado: EstadoChip }> = {
  UNDER_REVIEW: { texto: "En revisión por Mercado Libre", estado: "aviso" },
  PUBLISHED: { texto: "Publicado", estado: "exito" },
  REJECTED: { texto: "Rechazado", estado: "peligro" },
};

// `moderationStatus` null (la API todavía no devolvió ningún clip para
// este item) o un valor que no es ninguno de los 3 documentados (campo
// nuevo de Mercado Libre — ver la advertencia en
// lib/ml/cliente.ts:obtenerClipsMl, este endpoint nunca se confirmó
// contra una cuenta real) NUNCA se muestra como "Publicado" — un texto
// neutro de espera, siempre.
export function etiquetaModeracionClip(moderationStatus: string | null, motivoRechazo: string | null): { texto: string; estado: EstadoChip } {
  if (moderationStatus === "UNDER_REVIEW" || moderationStatus === "PUBLISHED") return ETIQUETAS_MODERACION[moderationStatus];
  if (moderationStatus === "REJECTED") {
    return { texto: motivoRechazo ? `Rechazado: ${motivoRechazo}` : "Rechazado", estado: "peligro" };
  }
  return { texto: "Consultando estado…", estado: "neutro" };
}

// true = seguir consultando esta cuenta. Solo PUBLISHED/REJECTED son
// estados finales — null, UNDER_REVIEW o cualquier valor desconocido
// siguen consultándose (nunca se para de consultar por un campo que no
// se reconoce).
export function sigueConsultandoModeracion(moderationStatus: string | null): boolean {
  return moderationStatus !== "PUBLISHED" && moderationStatus !== "REJECTED";
}

// Ritmo elegido (documentado acá, el único lugar que lo decide): los
// primeros 10 minutos cada 60s — la moderación real casi nunca resuelve
// tan rápido, pero si lo hace, se entera pronto sin esperar de más.
// Después cada 3 minutos (dentro del rango 2–5 min pedido) hasta el
// tope de 48h — mismo número que ya dice el texto de requisitos de
// SeccionClip.tsx ("Mercado Libre modera el video (24-48h)"). Pasado el
// tope se deja de consultar solo: 48h sin resolver es un caso para
// revisar a mano en Mercado Libre, nunca para seguir insistiendo solo.
export const INTERVALO_RAPIDO_MODERACION_MS = 60_000;
export const DURACION_FASE_RAPIDA_MODERACION_MS = 10 * 60_000;
export const INTERVALO_ESPACIADO_MODERACION_MS = 3 * 60_000;
export const TOPE_POLLING_MODERACION_MS = 48 * 60 * 60_000;

// `null` = ya se cumplió el tope, dejar de consultar esta cuenta.
export function proximoIntervaloModeracionMs(msDesdeQueEntroEnModeracion: number): number | null {
  if (msDesdeQueEntroEnModeracion >= TOPE_POLLING_MODERACION_MS) return null;
  return msDesdeQueEntroEnModeracion < DURACION_FASE_RAPIDA_MODERACION_MS ? INTERVALO_RAPIDO_MODERACION_MS : INTERVALO_ESPACIADO_MODERACION_MS;
}
