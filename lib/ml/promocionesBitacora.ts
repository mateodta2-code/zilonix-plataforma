// Promo-B — bitácora de cambios aplicados en Promociones. Reutiliza la
// tabla promociones_acciones (sin columnas nuevas): la regla y el
// origen viajan dentro del JSON ya existente resultadoMl.

export type ReglaBitacora = "todas" | "maximo" | "tabla-maestra" | "salir" | "manual";
export type OrigenBitacora = "lote" | "individual" | "aprobacion" | "participando" | "salir-todas";

const REGLAS_VALIDAS: readonly string[] = ["todas", "maximo", "tabla-maestra", "salir", "manual"];
const MAX_RESPUESTA_ML = 500;

// Agrega "regla" y "origen" al resultadoMl que ya se guardaba. Nunca
// pisa el contenido original; si no era un objeto (null), arma uno.
export function conReglaYOrigen(resultadoMl: unknown, regla: ReglaBitacora, origen: OrigenBitacora): Record<string, unknown> {
  const base = resultadoMl && typeof resultadoMl === "object" && !Array.isArray(resultadoMl) ? (resultadoMl as Record<string, unknown>) : {};
  return { ...base, regla, origen };
}

export type DetalleResultadoBitacora = {
  regla: ReglaBitacora | null;
  origen: string | null;
  ok: boolean | null;
  status: number | null;
  respuesta: string | null;
};

// Lo único que sale hacia el navegador de resultadoMl: campos
// conocidos, la respuesta de ML recortada a 500 caracteres. Nunca se
// devuelve el JSON crudo (por si alguna vez trae algo más que no debe
// verse, como un token).
export function resumirResultadoMl(resultadoMl: unknown): DetalleResultadoBitacora {
  const vacio: DetalleResultadoBitacora = { regla: null, origen: null, ok: null, status: null, respuesta: null };
  if (!resultadoMl || typeof resultadoMl !== "object" || Array.isArray(resultadoMl)) return vacio;
  const r = resultadoMl as Record<string, unknown>;
  return {
    regla: typeof r.regla === "string" && REGLAS_VALIDAS.includes(r.regla) ? (r.regla as ReglaBitacora) : null,
    origen: typeof r.origen === "string" ? r.origen.slice(0, 40) : null,
    ok: typeof r.ok === "boolean" ? r.ok : null,
    status: typeof r.status === "number" ? r.status : null,
    respuesta: typeof r.respuesta === "string" ? r.respuesta.slice(0, MAX_RESPUESTA_ML) : null,
  };
}
