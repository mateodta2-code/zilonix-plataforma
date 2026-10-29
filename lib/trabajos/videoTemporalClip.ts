import { rm } from "fs/promises";

// Rama feat-publicar-clip, punto 1/2 — un video que llega por "link",
// "por SKU propio" o "desde la extensión" se descarga UNA vez del lado
// del servidor (lib/ml/video-externo.ts) y después hay que:
// (a) dejar que el navegador lo previsualice con <video> para leer
//     duración/ancho/alto (punto 2, "Revisión antes de subir") — el
//     navegador necesita una URL para eso, nunca el archivo entero iría
//     de vuelta por un campo de formulario; y
// (b) cuando el usuario confirma la subida, usar ESE mismo archivo ya
//     en disco como origen del trabajo (lib/trabajos/subirClipMultiCuenta.ts),
//     sin volver a descargarlo.
// Este Map en memoria conecta las dos puntas con un id de corta vida —
// mismo criterio que subirClipMultiCuenta.ts (sin tabla nueva, Parte 4
// le da persistencia real) y mismo "RLS a mano" por empresaId.

export type VideoTemporalClip = {
  id: string;
  empresaId: string;
  rutaArchivo: string;
  contentType: string;
  nombreOriginal: string;
  creadoTs: number;
};

// Tope corto a propósito: es solo el tiempo entre "Traer" y confirmar
// la subida en la misma sesión del navegador, nunca un almacenamiento
// de largo plazo — 30 minutos de sobra para revisar el preview y elegir
// cuentas.
const TOPE_EDAD_VIDEO_TEMPORAL_MS = 30 * 60 * 1000;

const videosTemporales = new Map<string, VideoTemporalClip>();

// Poda real que BORRA el archivo físico de os.tmpdir() — a diferencia
// de subirClipMultiCuenta.ts (que siempre llega a borrar el suyo al
// terminar el trabajo), un video traído por link y nunca confirmado
// para subir se quedaría huérfano en disco para siempre si nadie lo
// limpia.
function podarVideosTemporalesViejos(): void {
  const ahora = Date.now();
  for (const [id, video] of videosTemporales) {
    if (ahora - video.creadoTs > TOPE_EDAD_VIDEO_TEMPORAL_MS) {
      videosTemporales.delete(id);
      void rm(video.rutaArchivo, { force: true });
    }
  }
}

export function registrarVideoTemporal(empresaId: string, rutaArchivo: string, contentType: string, nombreOriginal: string): VideoTemporalClip {
  podarVideosTemporalesViejos();
  const video: VideoTemporalClip = { id: crypto.randomUUID(), empresaId, rutaArchivo, contentType, nombreOriginal, creadoTs: Date.now() };
  videosTemporales.set(video.id, video);
  return video;
}

// RLS a mano — nunca se devuelve (ni se deja descargar) un video
// temporal de otra empresa, aunque alguien adivine un id real ajeno.
export function obtenerVideoTemporal(id: string, empresaId: string): VideoTemporalClip | null {
  const video = videosTemporales.get(id);
  if (!video || video.empresaId !== empresaId) return null;
  return video;
}

// Se llama cuando el trabajo de subida YA arrancó con esta ruta como
// origen (iniciarTrabajoClip es quien borra el ARCHIVO al terminar) —
// acá solo se saca del Map, para que nadie pueda volver a pedir ni
// borrar por error un archivo que ya es responsabilidad del trabajo.
export function quitarVideoTemporalDelMapa(id: string, empresaId: string): void {
  const video = videosTemporales.get(id);
  if (video && video.empresaId === empresaId) videosTemporales.delete(id);
}
