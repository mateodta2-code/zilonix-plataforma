// Rama feat-publicar-clip, punto 2 ("Revisión antes de subir, en el
// navegador") — duplicado A PROPÓSITO de lib/ml/clip.ts
// (problemasDeVideoClip/MENSAJES_PROBLEMA_VIDEO_CLIP/
// TAMANO_MAXIMO_CLIP_BYTES), nunca importado de ahí: lib/ml/clip.ts
// importa (transitivo) lib/ml/cuentas.ts -> db/empresa-context.ts, que
// exige DATABASE_URL_APP con solo cargarse — un "use client" nunca
// puede tirar de esa cadena. Mismo criterio que
// app/panel/publicar/clip/mensajes-error.ts ya documenta para su
// propio caso. Si alguna vez cambia alguno de los 2 originales, este
// archivo también se actualiza a mano.
export type MetadatosVideoClip = { duracionSegundos: number; ancho: number; alto: number; tamanoBytes: number };
export type ProblemaVideoClip = "duracion_corta" | "duracion_larga" | "no_vertical" | "resolucion_baja" | "demasiado_grande";

export const TAMANO_MAXIMO_CLIP_BYTES = 280 * 1024 * 1024;

export const MENSAJES_PROBLEMA_VIDEO_CLIP: Record<ProblemaVideoClip, string> = {
  duracion_corta: "El video dura menos de 10 segundos — Mercado Libre exige entre 10 y 61 segundos.",
  duracion_larga: "El video dura más de 61 segundos — Mercado Libre exige entre 10 y 61 segundos.",
  no_vertical: "El video tiene que ser vertical (más alto que ancho) — este no lo es.",
  resolucion_baja: "El video tiene que medir al menos 360×640 — este mide menos.",
  demasiado_grande: "El video no puede superar 280MB — es el límite real de Mercado Libre para Clips.",
};

export function problemasDeVideoClip(metadatos: MetadatosVideoClip): ProblemaVideoClip[] {
  const problemas: ProblemaVideoClip[] = [];
  if (metadatos.duracionSegundos < 10) problemas.push("duracion_corta");
  if (metadatos.duracionSegundos > 61) problemas.push("duracion_larga");
  if (metadatos.alto <= metadatos.ancho) problemas.push("no_vertical");
  if (metadatos.alto < 640 || metadatos.ancho < 360) problemas.push("resolucion_baja");
  if (metadatos.tamanoBytes > TAMANO_MAXIMO_CLIP_BYTES) problemas.push("demasiado_grande");
  return problemas;
}
