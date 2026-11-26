// Domi-4 — tipos de novedad y su validación, puros (los usa también el
// celular). El servidor valida otra vez y la base tiene su CHECK.

export const TIPOS_NOVEDAD = {
  voy_tarde: "Voy tarde",
  reprogramar: "El cliente pide reprogramar",
  no_contesta: "El cliente no contesta",
  paquete_danado: "Paquete dañado",
  otro: "Otro",
} as const;

export type TipoNovedad = keyof typeof TIPOS_NOVEDAD;
export const DETALLE_MAXIMO = 200;

export function esTipoNovedad(valor: string): valor is TipoNovedad {
  return Object.prototype.hasOwnProperty.call(TIPOS_NOVEDAD, valor);
}

// La novedad lista para guardar, o el texto del problema.
export function validarNovedad(tipo: string, detalle: string): { ok: true; tipo: TipoNovedad; detalle: string | null } | { ok: false; error: string } {
  if (!esTipoNovedad(tipo)) return { ok: false, error: "Elige qué pasó." };
  const limpio = detalle.trim().slice(0, DETALLE_MAXIMO);
  if (tipo === "otro" && !limpio) return { ok: false, error: "Cuéntanos qué pasó." };
  return { ok: true, tipo, detalle: limpio || null };
}
