// Publicar → «Crear con IA» — TÍTULOS SEO. La IA propone; las reglas se
// cumplen en código (no solo se le piden): largo máximo recortando por
// palabra, sin Mayúscula En Cada Palabra, sin palabras de promoción ni
// símbolos, con tildes. Cada palabra clave dice de dónde sale, calculado
// en código (nunca lo que la IA diga de sí misma).

import { PROMPT_TITULOS_RECOMENDADO } from "./prompt-titulos-recomendado";
import { extraerJson, fichaEnTexto, soloCifrasConfirmadas, type Ficha } from "./ficha";

export const LARGO_TITULO = 60;
export const LARGO_TITULO_CATALOGO = 120;
export const CANTIDAD_TITULOS = 10;
export const MAXIMO_KEYWORDS = 20;

export type OrigenPalabra = "tendencia" | "vendedor" | "ia";
// nivel: solo en las de tendencia — qué tan buscada es según el nivel de
// categoría donde aparece (alta = general, media = padre, baja = específica).
export type NivelBusqueda = "alta" | "media" | "baja";
export type PalabraClave = { palabra: string; origen: OrigenPalabra; nivel?: NivelBusqueda };
export type TendenciaConNivel = { palabra: string; nivel: NivelBusqueda };
const ORDEN_NIVEL: Record<NivelBusqueda, number> = { alta: 0, media: 1, baja: 2 };
// Para el prompt de la IA: primero las de la categoría específica.
export const ORDEN_PARA_IA: Record<NivelBusqueda, number> = { baja: 0, media: 1, alta: 2 };
export const MAXIMO_MAS_BUSCADOS = 30;
// Máximo por nivel, para que la categoría general no llene la lista.
export const MAXIMO_POR_NIVEL = 10;

// Palabras que no dicen de qué producto se trata.
const PALABRAS_VACIAS = new Set(["para", "como", "este", "esta", "esto", "pack", "tipo", "marca", "modelo", "unidad", "unidades", "color", "colores", "con", "sin", "por", "los", "las", "del", "una", "uno", "com", "pra", "sem", "kit", "set", "otro", "otros", "otra", "otras", "varios", "varias", "demas", "outros"]);

// Palabras importantes de un texto: minúsculas, sin tildes, de 4 letras o
// más, sin las vacías y sin la «s»/«es» del plural.
function raices(texto: string): Set<string> {
  const r = new Set<string>();
  for (const w of normalizar(texto).split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 4 || PALABRAS_VACIAS.has(w)) continue;
    r.add(w.length > 5 && w.endsWith("es") ? w.slice(0, -2) : w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
  }
  return r;
}

// En las categorías padre y general sale de todo (en «Mascotas»: gatos,
// perros, pollos… para un bebedero de colibrí, 24-nov). De esos niveles
// solo quedan las búsquedas que nombran el TIPO de producto: comparten una
// palabra importante con el nombre de la categoría específica («Bebederos y
// Comederos»). Con todo el texto del producto se colaba «cama… gato…
// transparente» por el material. Si el nombre de la categoría no tiene
// palabras importantes, se usa el texto del producto. La específica se deja
// completa. Además, máximo por nivel.
export function filtrarTendenciasRelacionadas<T extends { nivel: NivelBusqueda; palabras: string[] }>(
  niveles: T[],
  textoProducto: string,
  nombreCategoria = ""
): { niveles: T[]; descartadas: number } {
  const deCategoria = raices(nombreCategoria);
  const referencia = deCategoria.size > 0 ? deCategoria : raices(textoProducto);
  let descartadas = 0;
  const filtrados = niveles.map((n) => {
    const palabras =
      n.nivel === "baja"
        ? n.palabras
        : n.palabras.filter((frase) => {
            const ok = [...raices(frase)].some((w) => referencia.has(w));
            if (!ok) descartadas += 1;
            return ok;
          });
    return { ...n, palabras: palabras.slice(0, MAXIMO_POR_NIVEL) };
  });
  return { niveles: filtrados.filter((n) => n.palabras.length > 0), descartadas };
}

// Une las tendencias de los 3 niveles sin repetir (una búsqueda que sale
// en varios niveles queda con el más alto), ordenadas alta → baja.
export function unirTendenciasPorNivel(niveles: { nivel: NivelBusqueda; palabras: string[] }[]): TendenciaConNivel[] {
  const porClave = new Map<string, TendenciaConNivel>();
  for (const n of niveles) {
    for (const palabra of n.palabras) {
      const clave = normalizar(palabra).trim();
      if (!clave) continue;
      const previa = porClave.get(clave);
      if (!previa || ORDEN_NIVEL[n.nivel] < ORDEN_NIVEL[previa.nivel]) porClave.set(clave, { palabra: palabra.trim(), nivel: n.nivel });
    }
  }
  return [...porClave.values()].sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]).slice(0, MAXIMO_MAS_BUSCADOS);
}
export type PropuestaTitulos = { titulos: string[]; catalogo: string | null; palabras: PalabraClave[]; keywordsPrincipales: string[]; keywordsNoUtilizadas: string[] };

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
export function origenPalabras(titulos: string[], tendencias: string[], textoVendedor: string, niveles: TendenciaConNivel[] = []): PalabraClave[] {
  const tend = tendencias.map(normalizar);
  // El nivel más alto de las tendencias que contienen la palabra.
  const nivelDe = (n: string): NivelBusqueda | undefined =>
    niveles
      .filter((t) => normalizar(t.palabra).split(/\s+/).includes(n))
      .map((t) => t.nivel)
      .sort((a, b) => ORDEN_NIVEL[a] - ORDEN_NIVEL[b])[0];
  const vendedor = normalizar(textoVendedor);
  const vistas = new Set<string>();
  const palabras: PalabraClave[] = [];
  for (const titulo of titulos) {
    for (const palabra of titulo.split(" ")) {
      const n = normalizar(palabra).replace(/[^\p{L}\p{N}]/gu, "");
      if (n.length < 4 || vistas.has(n)) continue;
      vistas.add(n);
      const origen: OrigenPalabra = tend.some((t) => t.split(/\s+/).includes(n)) ? "tendencia" : vendedor.includes(n) ? "vendedor" : "ia";
      const nivel = origen === "tendencia" ? nivelDe(n) : undefined;
      palabras.push({ palabra: palabra.replace(/[^\p{L}\p{N}]/gu, ""), origen, ...(nivel ? { nivel } : {}) });
    }
  }
  return palabras;
}

// Bloque técnico fijo: va SIEMPRE después del prompt recomendado, para que
// mande sobre su sección FORMATO. Lleva los datos del producto y las reglas
// duras que el código además hace cumplir.
export function bloqueTecnicoTitulos(entrada: { ficha: Ficha; idioma: string; pais: string; categoria: string | null; tendencias: string[] }): string {
  return [
    `Contexto técnico (Mercado Libre ${entrada.pais}):`,
    "",
    "Ficha confirmada por el vendedor (no agregues nada que no esté aquí):",
    fichaEnTexto(entrada.ficha),
    entrada.categoria ? `Categoría de Mercado Libre: ${entrada.categoria}` : "",
    entrada.tendencias.length > 0 ? `Búsquedas en tendencia de la categoría y sus categorías padre (úsalas solo si describen este producto): ${entrada.tendencias.slice(0, MAXIMO_MAS_BUSCADOS).join(", ")}` : "",
    "",
    "Reglas obligatorias (mandan sobre lo anterior):",
    `- ${CANTIDAD_TITULOS} títulos distintos de máximo ${LARGO_TITULO} caracteres, y uno de catálogo más completo de máximo ${LARGO_TITULO_CATALOGO}.`,
    `- En ${entrada.idioma}, con tildes y ortografía correctas.`,
    "- Solo la primera palabra con mayúscula (y nombres propios o siglas). Nunca Mayúscula En Cada Palabra.",
    "- Sin símbolos, emojis, precios, «envío gratis», «oferta», «promoción» ni palabras de relleno.",
    "",
    `Formato de respuesta (reemplaza la sección FORMATO de arriba): responde SOLO un JSON: {"titulos": [${CANTIDAD_TITULOS} títulos], "catalogo": "…", "keywordsPrincipales": ["…"], "keywordsNoUtilizadas": ["…"]}. No escribas el número de caracteres: lo cuenta el sistema.`,
  ]
    .filter((linea) => linea !== "")
    .join("\n");
}

export function promptTitulos(entrada: { ficha: Ficha; idioma: string; pais: string; categoria: string | null; tendencias: string[]; info: string }): string {
  return `${PROMPT_TITULOS_RECOMENDADO}\n\n---\n\n${bloqueTecnicoTitulos(entrada)}`;
}

// Keywords de la IA: solo texto, sin símbolos ni promoción, de 2 a 40
// caracteres, sin repetidos (sin tildes ni mayúsculas) y sin cifras que no
// estén en la ficha ni en el texto del vendedor.
export function limpiarKeywords(valor: unknown, maximo = MAXIMO_KEYWORDS, textoVendedor?: string): string[] {
  if (!Array.isArray(valor)) return [];
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const k of valor) {
    if (typeof k !== "string") continue;
    let t = k;
    for (const patron of PROMOCION) t = t.replace(patron, " ");
    t = t.replace(SIMBOLOS, " ").replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 40) continue;
    if (textoVendedor !== undefined && !soloCifrasConfirmadas(t, textoVendedor)) continue;
    const clave = normalizar(t);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(t);
    if (salida.length >= maximo) break;
  }
  return salida;
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

export function leerPropuestaTitulos(
  respuesta: string,
  entrada: { ficha: Ficha; tendencias: string[]; info: string; niveles?: TendenciaConNivel[] }
): PropuestaTitulos | null {
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
  return {
    titulos,
    catalogo,
    palabras: origenPalabras(catalogo ? [...titulos, catalogo] : titulos, entrada.tendencias, textoVendedor, entrada.niveles),
    keywordsPrincipales: limpiarKeywords(json.keywordsPrincipales, MAXIMO_KEYWORDS, textoVendedor),
    keywordsNoUtilizadas: limpiarKeywords(json.keywordsNoUtilizadas, MAXIMO_KEYWORDS, textoVendedor),
  };
}
