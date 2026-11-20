// Publicar → «Crear con IA» — mensajes fijos y amables. Nunca el texto
// crudo del proveedor ni la llave (ni en la respuesta ni en los logs).

import { ErrorProveedorIA } from "@/lib/ia/proveedores";

export const RUTA_CONECTAR_IA = "/panel/conectar-ia";
export const MENSAJE_SIN_IA = "Conecta una IA en Administración → Conectar IA y asígnala al módulo Publicaciones (o márcala como principal).";
export const MENSAJE_GENERICO = "La IA no pudo responder. Intenta de nuevo en un momento.";

// Los errores de lib/ia/proveedores.ts traen el estado HTTP entre
// paréntesis («… respondió con error (401).»): solo se usa ese número.
export function mensajeErrorIA(error: unknown): string {
  if (!(error instanceof ErrorProveedorIA)) return MENSAJE_GENERICO;
  const estado = Number(/\((\d{3})\)/.exec(error.message)?.[1] ?? 0);
  if (estado === 401 || estado === 403) return "La IA conectada rechazó la llave. Revísala en Administración → Conectar IA.";
  if (estado === 429) return "La IA conectada pidió esperar (límite de uso o saldo de la cuenta). Intenta más tarde o revisa tu cuenta de IA.";
  if (estado === 404) return "La IA conectada no encontró el modelo. Revisa el modelo en Administración → Conectar IA.";
  if (/a tiempo/i.test(error.message)) return "La IA conectada no respondió a tiempo. Intenta de nuevo.";
  return MENSAJE_GENERICO;
}
