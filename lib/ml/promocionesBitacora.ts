// Promo-B — bitácora de cambios aplicados en Promociones. Reutiliza la
// tabla promociones_acciones (sin columnas nuevas): la regla y el
// origen viajan dentro del JSON ya existente resultadoMl.

export type ReglaBitacora = "todas" | "maximo" | "tabla-maestra" | "salir" | "manual";
export type OrigenBitacora = "lote" | "individual" | "aprobacion" | "participando" | "salir-todas";

const REGLAS_VALIDAS: readonly string[] = ["todas", "maximo", "tabla-maestra", "salir", "manual"];
const MAX_RESPUESTA_ML = 500;

// Agrega "regla" y "origen" al resultadoMl que ya se guardaba. Nunca
// pisa el contenido original; si no era un objeto (null), arma uno.
export function conReglaYOrigen(resultadoMl: unknown, regla: ReglaBitacora, origen: OrigenBitacora, extra: ExtraBitacora = {}): Record<string, unknown> {
  const base = resultadoMl && typeof resultadoMl === "object" && !Array.isArray(resultadoMl) ? (resultadoMl as Record<string, unknown>) : {};
  const ampliacion: Record<string, unknown> = {};
  // Solo los campos que vienen definidos: nunca se pisa con undefined.
  for (const [clave, valor] of Object.entries(extra)) if (valor !== undefined) ampliacion[clave] = valor;
  return { ...base, ...ampliacion, regla, origen };
}

// Promo-E — una "tanda" agrupa todas las filas de una misma ejecución
// (regla en lote, salir-todas, aprobación o acción individual). Se
// guarda en resultadoMl.lote, sin columna nueva.
export type LimiteBitacora = "piso" | "tope" | "ml" | "ninguno";
export type ExtraBitacora = {
  lote?: string;
  maximoPct?: number | null;
  limite?: LimiteBitacora;
  sku?: string | null;
  nombrePromocion?: string | null;
  motivo?: string | null;
};

export function nuevoLoteBitacora(): string {
  return crypto.randomUUID();
}

// Fila que NO se escribió en Mercado Libre (omitida por la regla o «no se
// puede por API»): queda con estado "rechazada" para que 100 = 100.
export function resultadoMlOmitida(regla: ReglaBitacora, origen: OrigenBitacora, motivo: string, extra: ExtraBitacora = {}): Record<string, unknown> {
  return conReglaYOrigen({ ok: false, llamoAMercadoLibre: false }, regla, origen, { ...extra, motivo: motivo.slice(0, 400) });
}

const LIMITES_VALIDOS: readonly string[] = ["piso", "tope", "ml", "ninguno"];

export type DetalleResultadoBitacora = {
  regla: ReglaBitacora | null;
  origen: string | null;
  ok: boolean | null;
  status: number | null;
  respuesta: string | null;
  lote: string | null;
  maximoPct: number | null;
  limite: LimiteBitacora | null;
  sku: string | null;
  nombrePromocion: string | null;
  motivo: string | null;
};

// Lo único que sale hacia el navegador de resultadoMl: campos
// conocidos, la respuesta de ML recortada a 500 caracteres. Nunca se
// devuelve el JSON crudo (por si alguna vez trae algo más que no debe
// verse, como un token).
export function resumirResultadoMl(resultadoMl: unknown): DetalleResultadoBitacora {
  const vacio: DetalleResultadoBitacora = { regla: null, origen: null, ok: null, status: null, respuesta: null, lote: null, maximoPct: null, limite: null, sku: null, nombrePromocion: null, motivo: null };
  if (!resultadoMl || typeof resultadoMl !== "object" || Array.isArray(resultadoMl)) return vacio;
  const r = resultadoMl as Record<string, unknown>;
  return {
    regla: typeof r.regla === "string" && REGLAS_VALIDAS.includes(r.regla) ? (r.regla as ReglaBitacora) : null,
    origen: typeof r.origen === "string" ? r.origen.slice(0, 40) : null,
    ok: typeof r.ok === "boolean" ? r.ok : null,
    status: typeof r.status === "number" ? r.status : null,
    respuesta: typeof r.respuesta === "string" ? r.respuesta.slice(0, MAX_RESPUESTA_ML) : null,
    lote: typeof r.lote === "string" ? r.lote.slice(0, 40) : null,
    maximoPct: typeof r.maximoPct === "number" && Number.isFinite(r.maximoPct) ? r.maximoPct : null,
    limite: typeof r.limite === "string" && LIMITES_VALIDOS.includes(r.limite) ? (r.limite as LimiteBitacora) : null,
    sku: typeof r.sku === "string" ? r.sku.slice(0, 80) : null,
    nombrePromocion: typeof r.nombrePromocion === "string" ? r.nombrePromocion.slice(0, 120) : null,
    motivo: typeof r.motivo === "string" ? r.motivo.slice(0, MAX_RESPUESTA_ML) : null,
  };
}
