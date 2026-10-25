// app/api/ml/clip/route.ts nunca manda texto libre en ?error= — solo
// uno de estos códigos de una lista cerrada. Un código que no está acá
// (nunca debería pasar, pero nunca se confía en lo que viene de la URL)
// cae en el mensaje genérico, jamás se imprime el valor crudo del query.
//
// Separado de page.tsx a propósito: page.tsx importa (transitivo)
// lib/ml/cuentas.ts -> db/empresa-context.ts, que exige DATABASE_URL_APP
// con solo importarlo — este archivo no importa nada, para que
// page.test.ts pueda probar el mapa sin necesitar Postgres real.
export const MENSAJES_ERROR_CLIP: Record<string, string> = {
  sin_permiso: "No tenés permiso para subir un Clip.",
  faltan_datos: "Faltan datos para subir el Clip.",
  archivo_invalido: "El video tiene que ser MP4, MOV, MPEG o AVI.",
  demasiado_grande: "El video no puede superar 280MB — es el límite real de Mercado Libre para Clips.",
  cuenta_invalida: "No se encontró esa cuenta de Mercado Libre.",
  item_invalido: "Esa publicación no es válida.",
  cuenta_desconectada: "Esa cuenta de Mercado Libre está desconectada — hay que reconectarla.",
  reputacion_requerida:
    "Mercado Libre no deja subir Clips en esta cuenta todavía — necesita tener un color de reputación asignado (se gana con ventas reales).",
  sin_respuesta_ml: "Mercado Libre no respondió a tiempo subiendo el video; revisá en Mercado Libre si el clip se subió antes de reintentar.",
  rechazado_ml: "Mercado Libre rechazó el video — revisá el formato, la duración (10-61s) y que sea vertical.",
  error_desconocido: "No se pudo subir el Clip — intentá de nuevo.",
};
const MENSAJE_ERROR_GENERICO = "No se pudo subir el Clip — intentá de nuevo.";

export function mensajeErrorClip(codigo: string | undefined): string | null {
  if (!codigo) return null;
  return MENSAJES_ERROR_CLIP[codigo] ?? MENSAJE_ERROR_GENERICO;
}
