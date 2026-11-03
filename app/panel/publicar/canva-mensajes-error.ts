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

export function mensajeErrorConectarCanva(codigo: string | undefined): string | null {
  if (!codigo) return null;
  return MENSAJES_ERROR_CANVA[codigo] ?? MENSAJE_ERROR_GENERICO;
}
