import type { MetadatosVideoClip } from "./validacion-video-cliente";

// Rama feat-publicar-clip, punto 2 — toca el DOM de verdad (un
// elemento <video> real, su evento "loadedmetadata"), por eso no se
// puede probar con vitest (mismo motivo que ya documenta
// lib/ml/clip.ts al nombrar este archivo). SeccionClip.tsx llama esto
// desde el onLoadedMetadata del <video> de preview — nunca crea un
// <video> oculto aparte solo para leer metadatos, reutiliza el mismo
// que el usuario ya está viendo.
export function leerMetadatosDeVideoElement(video: HTMLVideoElement, tamanoBytes: number): MetadatosVideoClip {
  return { duracionSegundos: video.duration, ancho: video.videoWidth, alto: video.videoHeight, tamanoBytes };
}
