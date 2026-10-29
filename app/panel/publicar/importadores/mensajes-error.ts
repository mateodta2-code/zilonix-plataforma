// Mismo motivo que clip/mensajes-error.ts: actions.ts nunca manda texto
// libre en ?importarLinkError= — solo uno de estos códigos de una lista
// cerrada. Separado de page.tsx/los componentes "use client" a propósito
// (sin ningún import transitivo a db/) para poder probarse sin Postgres.
export const MENSAJES_ERROR_IMPORTAR_LINK: Record<string, string> = {
  formato: "No se reconoció ningún id de Mercado Libre en ese link — pegá el link completo de la publicación.",
  sin_cuenta: "Esta empresa no tiene ninguna cuenta de Mercado Libre conectada todavía — hace falta al menos una para poder traer la publicación.",
};
const MENSAJE_ERROR_GENERICO = "No se pudo importar desde ese link — intentá de nuevo.";

export function mensajeErrorImportarLink(codigo: string | undefined): string | null {
  if (!codigo) return null;
  return MENSAJES_ERROR_IMPORTAR_LINK[codigo] ?? MENSAJE_ERROR_GENERICO;
}
