// Las rutas nuevas de app/api/ml/clip/ (subir, traer-video) nunca
// mandan texto libre en su JSON de error — solo uno de estos códigos
// de una lista cerrada. Un código que no está acá (nunca debería
// pasar, pero nunca se confía en lo que viene de la red) cae en el
// mensaje genérico, jamás se imprime el valor crudo de la respuesta.
//
// Separado de SeccionClip.tsx a propósito (igual que antes de
// page.tsx): este archivo no importa nada del servidor, así que un
// "use client" lo puede importar sin arrastrar lib/ml/cuentas.ts ->
// db/empresa-context.ts (exige DATABASE_URL_APP con solo cargarse).
export const MENSAJES_ERROR_CLIP: Record<string, string> = {
  sin_permiso: "No tienes permiso para subir un Clip.",
  faltan_datos: "Faltan datos para subir el Clip.",
  archivo_invalido: "El video tiene que ser MP4, MOV, MPEG o AVI.",
  demasiado_grande: "El video no puede superar 280MB — es el límite real de Mercado Libre para Clips.",
  cuenta_invalida: "No se encontró ninguna cuenta válida entre las elegidas.",
  item_invalido: "Esa publicación no es válida.",
  cuenta_desconectada: "Esa cuenta de Mercado Libre está desconectada — hay que reconectarla.",
  reputacion_requerida:
    "Mercado Libre no deja subir Clips en esta cuenta todavía — necesita tener un color de reputación asignado (se gana con ventas reales).",
  sin_respuesta_ml: "Mercado Libre no respondió a tiempo subiendo el video; revisa en Mercado Libre si el clip se subió antes de reintentar.",
  rechazado_ml: "Mercado Libre rechazó el video — revisa el formato, la duración (10-61s) y que sea vertical.",
  // Rama feat-publicar-clip — códigos nuevos de /api/ml/clip (subir).
  formato_invalido: "La subida no llegó en el formato esperado — prueba de nuevo.",
  video_no_encontrado: "El video que trajiste venció o ya se usó — vuelve a traerlo o súbelo desde el computador.",
  // Rama feat-publicar-clip — códigos nuevos de /api/ml/clip/traer-video
  // (lib/ml/video-externo.ts, "Traer" desde un link).
  link_invalido: "Ese link no es una URL válida.",
  host_no_permitido: "Ese sitio todavía no está habilitado para traer videos — prueba bajarlo y subirlo desde el computador.",
  no_disponible: "No se pudo descargar ese video a tiempo — prueba de nuevo o bájalo y súbelo desde el computador.",
  tipo_invalido: "Ese link no apunta a un video MP4, MOV, MPEG o AVI.",
  error_desconocido: "No se pudo subir el Clip — intenta de nuevo.",
};
const MENSAJE_ERROR_GENERICO = "No se pudo subir el Clip — intenta de nuevo.";

export function mensajeErrorClip(codigo: string | undefined): string | null {
  if (!codigo) return null;
  return MENSAJES_ERROR_CLIP[codigo] ?? MENSAJE_ERROR_GENERICO;
}
