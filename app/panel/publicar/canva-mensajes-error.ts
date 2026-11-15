// Mismo criterio que importadores/mensajes-error.ts: /api/canva/callback
// y /api/canva/conectar (ver esos route.ts) nunca mandan texto libre en
// ?codigo= — solo uno de estos códigos de una lista cerrada. Separado de
// los componentes "use client" a propósito, para poder probarse sin
// Postgres.
//
// Review PR #372 (ALTO 2) — ese redirect SÍ llegaba con ?canva=error&
// codigo=..., pero la página de Publicar no leía ninguno de los dos:
// la persona quedaba sin ningún aviso de que la conexión falló.
export const MENSAJES_ERROR_CANVA: Record<string, string> = {
  sin_permiso: "No tienes permiso para conectar Canva — pídele a un administrador que te dé acceso a Inventario.",
  canva_rechazo: "Canva no autorizó la conexión. Intenta de nuevo.",
  estado_vencido: "El enlace para conectar Canva venció. Usa el botón \"Conectar Canva\" para intentar de nuevo.",
};
const MENSAJE_ERROR_GENERICO = "No pudimos conectar con Canva. Intenta de nuevo o escríbenos.";

// BAJO, review 2 del PR #372 — el único caller ya filtra por
// `canva === "error"` antes de llamar esta función (ver
// FormularioPublicar.tsx), así que llegar sin `codigo` significa
// "hubo error pero sin código concreto", no "no hubo error": antes
// devolvía null acá y la persona se quedaba sin ningún aviso, igual
// que el bug original que arregló el ALTO 2.
export function mensajeErrorConectarCanva(codigo: string | undefined): string {
  if (!codigo) return MENSAJE_ERROR_GENERICO;
  return MENSAJES_ERROR_CANVA[codigo] ?? MENSAJE_ERROR_GENERICO;
}
