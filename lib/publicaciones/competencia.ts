// Publicar → «Generación de imágenes para Meli» → títulos: el título de
// una publicación de la competencia como idea de palabras (23-nov). Solo
// se lee el TEXTO del link para sacar el id; el título sale de la API
// oficial (GET /items/{id} o, en catálogo, GET /products/{id}). Nunca se
// abre ni se lee la página. Sin la extensión (no se toca extension/): si
// ML no deja leerla, la persona pega el título a mano.

// mercadolibre.com.xx (y .com sola) y mercadolivre.com.br (Brasil).
const PATRON_HOST = /(^|\.)(mercadolibre\.com(\.[a-z]{2})?|mercadolivre\.com\.br)$/i;

export type IdCompetencia = { tipo: "item" | "producto"; id: string };

// Saca el id del link para el país de la cuenta (siteId: MCO, MLM, MLB…).
// Catálogo «/p/MCO123» → producto; «MCO-123…», ?wid= o ?item_id= → item.
export function idCompetenciaDesdeLink(urlCruda: string, siteId: string): IdCompetencia | null {
  if (!/^[A-Z]{3}$/.test(siteId)) return null;
  let url: URL;
  try {
    url = new URL(urlCruda.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !PATRON_HOST.test(url.hostname)) return null;
  const limpio = (v: string) => v.toUpperCase().replace(/-/g, "");
  const valido = new RegExp(`^${siteId}[0-9]{4,15}$`);
  for (const clave of ["wid", "item_id", "itemId"]) {
    const v = url.searchParams.get(clave);
    if (v && valido.test(limpio(v))) return { tipo: "item", id: limpio(v) };
  }
  const producto = url.pathname.match(new RegExp(`/p/(${siteId}[0-9]{4,15})`, "i"));
  if (producto) return { tipo: "producto", id: limpio(producto[1]) };
  const item = url.pathname.match(new RegExp(`/(${siteId}-?[0-9]{4,15})(?:[/?#-]|$)`, "i"));
  if (item && valido.test(limpio(item[1]))) return { tipo: "item", id: limpio(item[1]) };
  return null;
}

export const LARGO_TITULO_COMPETENCIA = 200;

export function limpiarTituloCompetencia(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, LARGO_TITULO_COMPETENCIA) : "";
}
