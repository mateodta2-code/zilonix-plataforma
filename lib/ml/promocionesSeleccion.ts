// «Aplicar regla» SIEMPRE por selección (Mateo, Promo-A, Refs #571): la
// regla se aplica únicamente a las publicaciones que la persona marcó —
// nunca se recorre el catálogo ni todas las cuentas de forma implícita.
// Este archivo no importa nada de Mercado Libre para que la ruta y los
// tests lo usen sin arrastrar el cliente.

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ItemSeleccionado = { cuentaId: string; itemId: string };

// Tope razonable por petición: cada publicación cuesta varias llamadas a
// ML (lectura + escritura), así que un lote enorme excedería el tiempo de
// la petición y el rate limit.
export const TOPE_ITEMS_SELECCION = 200;

// Ids de publicación de ML: prefijo del sitio + dígitos (ej. MCO123456789).
const PATRON_ITEM_ID = /^[A-Za-z]{2,4}\d{5,20}$/;

export type ResultadoSeleccion = { ok: true; seleccion: ItemSeleccionado[] } | { ok: false; error: string };

export function validarSeleccion(valor: unknown): ResultadoSeleccion {
  if (!Array.isArray(valor) || valor.length === 0) {
    return { ok: false, error: "Selecciona al menos una publicación." };
  }
  if (valor.length > TOPE_ITEMS_SELECCION) {
    return { ok: false, error: `Se pueden aplicar como máximo ${TOPE_ITEMS_SELECCION} publicaciones por vez.` };
  }
  const vistos = new Set<string>();
  const seleccion: ItemSeleccionado[] = [];
  for (const el of valor) {
    const cuentaId = (el as { cuentaId?: unknown } | null)?.cuentaId;
    const itemId = (el as { itemId?: unknown } | null)?.itemId;
    if (typeof cuentaId !== "string" || !PATRON_UUID.test(cuentaId) || typeof itemId !== "string" || !PATRON_ITEM_ID.test(itemId)) {
      return { ok: false, error: "La selección tiene una publicación inválida." };
    }
    const clave = `${cuentaId}:${itemId}`;
    if (vistos.has(clave)) continue; // un duplicado nunca escribe dos veces
    vistos.add(clave);
    seleccion.push({ cuentaId, itemId });
  }
  return { ok: true, seleccion };
}

// Agrupa por cuenta conservando el orden de llegada.
export function agruparPorCuenta(seleccion: ItemSeleccionado[]): Map<string, string[]> {
  const grupos = new Map<string, string[]>();
  for (const { cuentaId, itemId } of seleccion) {
    const ids = grupos.get(cuentaId);
    if (ids) ids.push(itemId);
    else grupos.set(cuentaId, [itemId]);
  }
  return grupos;
}
