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

// Rama mateo/clip-estado-automatico (Alcance B) — caso real (captura de
// Débora/Mateo, staging): el botón quedaba deshabilitado en silencio
// porque el tamaño solo se chequeaba DENTRO de problemasDeVideoClip,
// que exige los 4 campos de MetadatosVideoClip (duración/ancho/alto
// vienen del <video>, nunca llegan si el navegador no puede decodificar
// el códec) — así un archivo de más de 280MB con códec ilegible nunca
// avisaba nada. File.size (tamanoBytes) está disponible de una, apenas
// se elige el archivo, sin esperar el <video>. Chequeo de tamaño
// aparte, independiente de metadatos.
export function problemaTamanoClip(tamanoBytes: number): "demasiado_grande" | null {
  return tamanoBytes > TAMANO_MAXIMO_CLIP_BYTES ? "demasiado_grande" : null;
}

// "Tamaño: X MB de 280 MB permitidos" — siempre visible al elegir el
// archivo (pedido explícito de Mateo), nunca espera metadatos. Redondeo
// hacia arriba: 1 byte real nunca se muestra como "0 MB".
export function formatoTamanoClip(tamanoBytes: number): string {
  return `Tamaño: ${Math.ceil(tamanoBytes / (1024 * 1024))} MB de 280 MB permitidos`;
}

export function mensajeTamanoExcedidoClip(tamanoBytes: number): string {
  const mb = Math.ceil(tamanoBytes / (1024 * 1024));
  return `Tu video pesa ${mb} MB; el máximo es 280 MB. Comprímelo a menos de 280 MB (por ejemplo 1080×1920, H.264, 8–12 Mbps).`;
}

// Mensajes con el valor REAL del video + el requisito (pedido de
// Mateo, segunda vuelta) — a diferencia de MENSAJES_PROBLEMA_VIDEO_CLIP
// (texto fijo por código, de arriba), estos necesitan los metadatos de
// ESE video en particular, así que son una función, no un Record. No
// hace falta un duplicado server en lib/ml/clip.ts: el servidor nunca
// muestra este detalle por campo al usuario (validarArchivoClip solo
// tira un error genérico) — el contrato compartido real que sí hay que
// mantener igual en los dos lados sigue siendo problemasDeVideoClip/
// TAMANO_MAXIMO_CLIP_BYTES (sin tocar acá).
export function mensajeProblemaVideoClip(problema: Exclude<ProblemaVideoClip, "demasiado_grande">, metadatos: { duracionSegundos: number; ancho: number; alto: number }): string {
  switch (problema) {
    case "duracion_corta":
    case "duracion_larga":
      return `Tu video dura ${Math.round(metadatos.duracionSegundos)} s; Mercado Libre exige entre 10 y 61 segundos.`;
    case "no_vertical":
      return `Tu video mide ${metadatos.ancho}×${metadatos.alto} px y no es vertical; tiene que ser más alto que ancho.`;
    case "resolucion_baja":
      return `Tu video mide ${metadatos.ancho}×${metadatos.alto} px; el mínimo es 360×640.`;
    default:
      return "El video no cumple un requisito de Mercado Libre.";
  }
}
