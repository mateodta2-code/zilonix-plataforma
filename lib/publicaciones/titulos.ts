// Publicar → «Crear con IA» — TÍTULOS SEO. La IA propone; las reglas se
// cumplen en código (no solo se le piden): largo máximo recortando por
// palabra, sin Mayúscula En Cada Palabra, sin palabras de promoción ni
// símbolos, con tildes. Cada palabra clave dice de dónde sale, calculado
// en código (nunca lo que la IA diga de sí misma).

import { extraerJson, fichaEnTexto, soloCifrasConfirmadas, type Ficha } from "./ficha";

export const LARGO_TITULO = 60;
export const LARGO_TITULO_CATALOGO = 120;
export const CANTIDAD_TITULOS = 3;

export type OrigenPalabra = "tendencia" | "vendedor" | "ia";
export type PalabraClave = { palabra: string; origen: OrigenPalabra };
export type PropuestaTitulos = { titulos: string[]; catalogo: string | null; palabras: PalabraClave[] };

// Promoción y relleno que Mercado Libre no quiere en el título.
const PROMOCION = [
  // Solo porcentajes de descuento («20% off», «50 % dcto», «15% dto», «30% de
  // descuento»); un porcentaje que describe el producto («100% algodón»)
  // se queda. Va primero: si «descuento» se quitara antes, quedaría
  // «30% de» suelto.
  /\b\d+\s*%\s*(de\s+descuento|de\s+dcto|de\s+desc|descuento|desconto|dcto|desc|dto|off)\b/gi,
  /env[ií]o\s+gr[aá]tis/gi,
  /\bfrete\s+gr[aá]tis\b/gi,
  /\bgr[aá]tis\b/gi,
  /\bofertas?\b/gi,
  /\bpromo(ci[oó]n|ção)?\b/gi,
  /\bdescuentos?\b/gi,
  /\bdesconto\b/gi,
  /\bliquidaci[oó]n\b/gi,
  /\bprecio\b/gi,
  /\bpreço\b/gi,
  /[$€£]\s?\d[\d.,]*/g,
];
const SIMBOLOS = /[!¡*★☆✔✅❤|#@~^_=+<>{}[\]"“”«»]|\p{Extended_Pictographic}/gu;

export function recortarPorPalabra(texto: string, maximo: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= maximo) return limpio;
  const corte = limpio.slice(0, maximo + 1);
  const espacio = corte.lastIndexOf(" ");
  return (espacio > 0 ? corte.slice(0, espacio) : limpio.slice(0, maximo)).replace(/[\s,.;:\-–]+$/, "");
}

// Letras sueltas que en un título son conjunción/preposición, no unidad.
const LETRAS_PALABRA = new Set(["Y", "O", "E", "A", "U"]);

// Siglas y unidades que se dejan como vienen: USB, LED, 1L, «L», «C».
function esSigla(palabra: string): boolean {
  if (/\d/.test(palabra)) return true;
  if (!/\p{L}/u.test(palabra) || palabra !== palabra.toUpperCase()) return false;
  return palabra.length >= 2 || !LETRAS_PALABRA.has(palabra);
}

// «Termo Acero Inoxidable 1 Litro» → «Termo acero inoxidable 1 litro»:
// solo la primera palabra con mayúscula, salvo siglas (USB, LED, 1L) y
// los nombres propios que se pasen (marca, modelo).
export function sinMayusculaCadaPalabra(texto: string, propios: string[] = []): string {
  const conservar = new Set(propios.map((p) => p.toLowerCase()));
  const palabras = texto.split(" ");
  return palabras
    .map((p, i) => {
      if (!p || esSigla(p) || conservar.has(p.toLowerCase())) return p;
      const minuscula = p.toLocaleLowerCase();
      return i === 0 ? minuscula.charAt(0).toLocaleUpperCase() + minuscula.slice(1) : minuscula;
    })
    .join(" ");
}

export function limpiarTitulo(texto: unknown, maximo: number, propios: string[] = []): string | null {
  if (typeof texto !== "string") return null;
  let t = texto;
  for (const patron of PROMOCION) t = t.replace(patron, " ");
  t = t.replace(SIMBOLOS, " ").replace(/\s+/g, " ").trim();
  t = sinMayusculaCadaPalabra(t, propios);
  t = recortarPorPalabra(t, maximo);
  return t.length >= 10 ? t : null;
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Origen de cada palabra importante de los títulos: tendencia de la
// categoría (si aparece en alguna), del vendedor (si está en su ficha o
// su texto) o sugerida por la IA.
export function origenPalabras(titulos: string[], tendencias: string[], textoVendedor: string): PalabraClave[] {
  const tend = tendencias.map(normalizar);
  const vendedor = normalizar(textoVendedor);
  const vistas = new Set<string>();
  const palabras: PalabraClave[] = [];
  for (const titulo of titulos) {
    for (const palabra of titulo.split(" ")) {
      const n = normalizar(palabra).replace(/[^\p{L}\p{N}]/gu, "");
      if (n.length < 4 || vistas.has(n)) continue;
      vistas.add(n);
      const origen: OrigenPalabra = tend.some((t) => t.split(/\s+/).includes(n)) ? "tendencia" : vendedor.includes(n) ? "vendedor" : "ia";
      palabras.push({ palabra: palabra.replace(/[^\p{L}\p{N}]/gu, ""), origen });
    }
  }
  return palabras;
}

export function promptTitulos(entrada: { ficha: Ficha; idioma: string; pais: string; categoria: string | null; tendencias: string[]; info: string }): string {
  return [
    `Eres experto en SEO de Mercado Libre ${entrada.pais}. Propón títulos para esta publicación.`,
    "",
    "Ficha confirmada por el vendedor (no agregues nada que no esté aquí):",
    fichaEnTexto(entrada.ficha),
    entrada.categoria ? `Categoría de Mercado Libre: ${entrada.categoria}` : "",
    entrada.tendencias.length > 0 ? `Búsquedas en tendencia de la categoría (úsalas solo si describen este producto): ${entrada.tendencias.slice(0, 20).join(", ")}` : "",
    "",
    "Reglas obligatorias:",
    `- ${CANTIDAD_TITULOS} títulos distintos de máximo ${LARGO_TITULO} caracteres, y uno de catálogo más completo de máximo ${LARGO_TITULO_CATALOGO}.`,
    `- En ${entrada.idioma}, con tildes y ortografía correctas.`,
    "- Estructura: producto + marca/modelo (si se conoce) + característica clave + material/capacidad (si se conoce).",
    "- Solo la primera palabra con mayúscula (y nombres propios o siglas). Nunca Mayúscula En Cada Palabra.",
    "- Sin símbolos, emojis, precios, «envío gratis», «oferta», «promoción» ni palabras de relleno.",
    "",
    'Responde SOLO un JSON: {"titulos": ["…", "…", "…"], "catalogo": "…"}',
  ]
    .filter((linea) => linea !== "")
    .join("\n");
}

// Nombres propios que se respetan al bajar mayúsculas: las palabras con
// mayúscula del nombre en la ficha que no son la primera (marca/modelo).
// Si el nombre viene todo en Mayúscula Cada Palabra no se puede saber
// cuál es la marca: no se conserva ninguna.
export function nombresPropios(ficha: Ficha): string[] {
  const resto = (ficha.nombre.valor ?? "").split(" ").slice(1).filter((p) => /\p{L}/u.test(p));
  const conMayuscula = resto.filter((p) => /^\p{Lu}/u.test(p) && p !== p.toUpperCase());
  return resto.length > 0 && conMayuscula.length === resto.length ? [] : conMayuscula;
}

export function leerPropuestaTitulos(respuesta: string, entrada: { ficha: Ficha; tendencias: string[]; info: string }): PropuestaTitulos | null {
  const json = extraerJson(respuesta);
  if (!json) return null;
  const propios = nombresPropios(entrada.ficha);
  const textoVendedor = `${fichaEnTexto(entrada.ficha)} ${entrada.info}`;
  // Un título con una cifra que no está en la ficha ni en el texto del vendedor se descarta.
  const confirmado = (t: string | null): t is string => t !== null && soloCifrasConfirmadas(t, textoVendedor);
  const titulos = [...new Set((Array.isArray(json.titulos) ? json.titulos : []).map((t) => limpiarTitulo(t, LARGO_TITULO, propios)).filter(confirmado))].slice(
    0,
    CANTIDAD_TITULOS
  );
  if (titulos.length === 0) return null;
  const catalogoLimpio = limpiarTitulo(json.catalogo, LARGO_TITULO_CATALOGO, propios);
  const catalogo = confirmado(catalogoLimpio) ? catalogoLimpio : null;
  return { titulos, catalogo, palabras: origenPalabras(catalogo ? [...titulos, catalogo] : titulos, entrada.tendencias, textoVendedor) };
}
