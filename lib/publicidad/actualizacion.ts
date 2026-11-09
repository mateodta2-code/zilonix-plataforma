// El tablero mostraba "Datos de Mercado Libre actualizados: —" con
// octubre ya cargado. La consulta pedía estado = ok, y ok solo se
// escribe cuando el tramo cierra el backfill de 62 días. Antes de
// eso un tramo que terminó queda en parcial, y un corte a los 240 s
// queda en error con CorridaIncompletaError (igual volcó lo leído).

export const PREFIJO_CORTE_TIEMPO = "CorridaIncompletaError";

export function syncActualizoDatos(estado: string, error: string | null): boolean {
  if (estado === "ok" || estado === "parcial") return true;
  return estado === "error" && Boolean(error?.startsWith(PREFIJO_CORTE_TIEMPO));
}
