// Sugerir categorías de Falabella según el título. Falabella NO ofrece esto en
// su API (la sugerencia del Seller Center es interna), así que se preselecciona
// por palabras y, si hay IA conectada, ella elige entre esas pocas opciones.

export type CategoriaPlana = { id: number; ruta: string };

function sinTildes(t: string) {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Cada palabra pesa más cuanto más rara es entre las categorías («electrico»,
// que está en cientos, vale menos que «encendedor») y pesa doble si cae en el
// nombre de la categoría final.
export function preseleccionarCategorias(lista: CategoriaPlana[], titulo: string, cuantas = 6): CategoriaPlana[] {
  const palabras = sinTildes(titulo)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.replace(/(es|s)$/, ""));
  if (palabras.length === 0 || lista.length === 0) return [];
  const rutas = lista.map((c) => sinTildes(c.ruta));
  const peso = palabras.map((w) => Math.log(1 + lista.length / (1 + rutas.filter((r) => r.includes(w)).length)));
  return lista
    .map((c, i) => {
      const hoja = sinTildes(c.ruta.split(" › ").pop() ?? "");
      const puntos = palabras.reduce((t, w, k) => t + (rutas[i].includes(w) ? peso[k] * (hoja.includes(w) ? 2 : 1) : 0), 0);
      return { c, puntos };
    })
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || a.c.ruta.length - b.c.ruta.length)
    .slice(0, cuantas)
    .map((x) => x.c);
}

export function promptCategoriaFalabella(titulo: string, candidatas: CategoriaPlana[]): string {
  return `Eres el asistente de Zilonix Seller. Elige en qué categoría de Falabella Colombia se publica este producto.

Título del producto: "${titulo.slice(0, 200)}"

Categorías posibles (id: ruta):
${candidatas.map((c) => `${c.id}: ${c.ruta}`).join("\n")}

Responde SOLO un JSON con los ids de las 3 mejores, de la más adecuada a la menos: {"ids":[123,456,789]}. Usa únicamente ids de la lista; si ninguna encaja, devuelve {"ids":[]}.`;
}

// Solo acepta ids que estaban en la lista (la IA nunca inventa una categoría).
export function leerRespuestaCategorias(respuesta: string, candidatas: CategoriaPlana[]): CategoriaPlana[] {
  const m = respuesta.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const ids = (JSON.parse(m[0]) as { ids?: unknown }).ids;
    if (!Array.isArray(ids)) return [];
    const porId = new Map(candidatas.map((c) => [c.id, c]));
    return ids.map((i) => porId.get(Number(i))).filter((c): c is CategoriaPlana => !!c).slice(0, 3);
  } catch {
    return [];
  }
}
