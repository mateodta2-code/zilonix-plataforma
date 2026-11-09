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
export const MENSAJE_LEYENDO_VIDEO_CLIP = "Leyendo el video…";
export const MENSAJE_SIN_CUENTAS_CLIP = "Marca al menos una cuenta para subir el Clip.";
// Caso real (staging, cuenta de Débora): un MP4 de 11MB que Mercado
// Libre SÍ acepta, pero Chrome no puede decodificar (códec ilegible) —
// antes esto bloqueaba el botón PARA SIEMPRE con un mensaje de error
// (fallo nuestro, no de Mercado Libre: nunca hay que bloquear algo que
// el marketplace acepta). Ahora es solo un AVISO informativo (ver
// advertenciaNoPuedeSubirClip) — el botón queda habilitado igual; si
// Mercado Libre de verdad rechaza el archivo, el motivo real de ML
// vuelve en la fila de esa cuenta (lib/trabajos/subirClipMultiCuenta.ts).
export const MENSAJE_CODEC_NO_LEGIBLE_CLIP =
  "No pudimos previsualizar este video en tu navegador. Igual puedes subirlo; Mercado Libre hará la validación final (10–61 s, vertical, mínimo 360×640).";

// Prioridad (pedido explícito): (a) falta video; (b) aún leyendo
// metadatos (si el códec resultó ilegible, no hay nada que esperar —
// ver advertenciaNoPuedeSubirClip); (c) tamaño, SIEMPRE chequeable sin
// metadatos; (d) problemas de problemasDeVideoClip (duración/
// orientación/resolución), TODOS a la vez (nunca solo el primero), solo
// si SÍ hay metadatos; (e) ninguna cuenta marcada. "Subiendo" no es una
// razón que mostrar — el botón ya dice "Subiendo…" por su cuenta.
// [] = no hay ninguna razón BLOQUEANTE, se puede subir (puede seguir
// habiendo una advertencia informativa, ver advertenciaNoPuedeSubirClip).
export function razonesNoPuedeSubirClip(entrada: EntradaRazonNoSubirClip): string[] {
  if (entrada.subiendo) return [];
  if (!entrada.tieneVideo || entrada.tamanoBytes == null) return [MENSAJE_SIN_VIDEO_CLIP];

  const razones: string[] = [];
  if (problemaTamanoClip(entrada.tamanoBytes)) razones.push(mensajeTamanoExcedidoClip(entrada.tamanoBytes));

  if (!entrada.metadatos) {
    if (razones.length > 0) return razones;
    if (!entrada.errorCodec) return [MENSAJE_LEYENDO_VIDEO_CLIP]; // todavía leyendo, espera corta y real
    // Códec ilegible: duración/orientación/resolución nunca van a
    // llegar desde el <video> — no bloquear esperando algo que no va a
    // pasar (Mercado Libre valida eso del lado de ellos). La única
    // razón que sigue aplicando sin metadatos es la de cuenta marcada.
    return entrada.hayCuentaMarcada ? [] : [MENSAJE_SIN_CUENTAS_CLIP];
  }

  for (const problema of problemasDeVideoClip(entrada.metadatos)) {
    if (problema === "demasiado_grande") continue; // ya cubierto arriba, con el mensaje real de MB
    razones.push(mensajeProblemaVideoClip(problema, entrada.metadatos));
  }
  if (razones.length > 0) return razones;

  if (!entrada.hayCuentaMarcada) return [MENSAJE_SIN_CUENTAS_CLIP];
  return [];
}

// Aviso informativo (nunca bloqueante) de que el navegador no pudo
// previsualizar el video — separado de razonesNoPuedeSubirClip a
// propósito: SeccionClip.tsx lo muestra con el estilo neutro de
// "Leyendo el video…", nunca con el rojo de una razón bloqueante.
export function advertenciaNoPuedeSubirClip(entrada: Pick<EntradaRazonNoSubirClip, "errorCodec" | "metadatos">): string | null {
  return entrada.errorCodec && !entrada.metadatos ? MENSAJE_CODEC_NO_LEGIBLE_CLIP : null;
}
