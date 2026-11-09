import {
  mensajeProblemaVideoClip,
  mensajeTamanoExcedidoClip,
  problemaTamanoClip,
  problemasDeVideoClip,
  type MetadatosVideoClip,
} from "./validacion-video-cliente";

// Rama mateo/clip-estado-automatico (Alcance B) — caso real (captura de
// Débora/Mateo, staging): "Subir Clip a 1 cuenta(s)" se veía apagado,
// sin ningún aviso de por qué. Causa confirmada en el código: el botón
// se deshabilitaba por varios motivos distintos (sin video, códec que
// el navegador no puede leer, problemas de duración/orientación/
// resolución/tamaño, ninguna cuenta marcada) y SeccionClip.tsx nunca
// decía cuál. Esta función junta las 5 causas reales en una sola lista
// de razones en texto plano, en el orden de prioridad pedido — pura
// (nunca toca el DOM ni la red), para poder probarla con vitest sin
// mocks de fetch/<video>.
export type EntradaRazonNoSubirClip = {
  tieneVideo: boolean;
  // Tamaño del video YA elegido — tamanoBytes de File.size (o del
  // byteLength que ya trae un video temporal de "link"/"extensión"),
  // disponible desde el instante en que se elige, sin esperar metadatos.
  tamanoBytes: number | null;
  // null = el <video> todavía no disparó loadedmetadata (o nunca lo va
  // a disparar porque el navegador no puede decodificar el códec).
  metadatos: MetadatosVideoClip | null;
  // true = onError del <video>, o pasó el timeout corto sin
  // loadedmetadata — el navegador no puede leer este archivo.
  errorCodec: boolean;
  hayCuentaMarcada: boolean;
  subiendo: boolean;
};

export const MENSAJE_SIN_VIDEO_CLIP = "Elige un video antes de subir.";
export const MENSAJE_CODEC_NO_LEGIBLE_CLIP = "Tu navegador no puede leer este video; conviértelo a MP4 con H.264 y audio AAC.";
export const MENSAJE_LEYENDO_VIDEO_CLIP = "Leyendo el video…";
export const MENSAJE_SIN_CUENTAS_CLIP = "Marca al menos una cuenta para subir el Clip.";

// Prioridad (pedido explícito): (a) falta video; (b) códec ilegible o
// aún leyendo; (c) problemas de problemasDeVideoClip, TODOS a la vez
// (nunca solo el primero); (d) ninguna cuenta marcada. "Subiendo" no es
// una razón que mostrar — el botón ya dice "Subiendo…" por su cuenta.
// [] = no hay ninguna razón, se puede subir.
export function razonesNoPuedeSubirClip(entrada: EntradaRazonNoSubirClip): string[] {
  if (entrada.subiendo) return [];
  if (!entrada.tieneVideo || entrada.tamanoBytes == null) return [MENSAJE_SIN_VIDEO_CLIP];
  if (entrada.errorCodec) return [MENSAJE_CODEC_NO_LEGIBLE_CLIP];

  const razones: string[] = [];
  if (problemaTamanoClip(entrada.tamanoBytes)) razones.push(mensajeTamanoExcedidoClip(entrada.tamanoBytes));

  if (!entrada.metadatos) {
    // Mientras el <video> todavía no cargó metadatos, solo se puede
    // confirmar el problema de TAMAÑO (no depende del <video>) — el
    // resto (duración/orientación/resolución) exige esperar.
    return razones.length > 0 ? razones : [MENSAJE_LEYENDO_VIDEO_CLIP];
  }

  for (const problema of problemasDeVideoClip(entrada.metadatos)) {
    if (problema === "demasiado_grande") continue; // ya cubierto arriba, con el mensaje real de MB
    razones.push(mensajeProblemaVideoClip(problema, entrada.metadatos));
  }
  if (razones.length > 0) return razones;

  if (!entrada.hayCuentaMarcada) return [MENSAJE_SIN_CUENTAS_CLIP];
  return [];
}
