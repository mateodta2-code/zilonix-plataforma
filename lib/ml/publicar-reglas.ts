import type { DefinicionAtributoMl, DimensionesProducto, ValorAtributoMl } from "@/lib/ml/publicar-tipos";

// Tarea 2.11 ("Publicar producto y clip") — TODAS las reglas de negocio
// puras (sin llamar a Mercado Libre) confirmadas contra el código real
// ya en producción del Zilonix OS actual
// (zilonix-os-web/lib/mercadolibre-publicar.js, 1555 líneas, leído
// completo). Mateo pidió portar el 100% de estas reglas, sin recortar
// alcance — cada una de acá abajo evita un error real que Mercado
// Libre ya rechazó en vivo (el caso real queda citado en el comentario).
//
// Separadas en su propio archivo (decisión de arquitectura, no estaban
// así en el sistema actual) para poder probarlas con datos puros, sin
// tener que simular `fetch` — son las reglas más densas y las que más
// conviene poder romper con una prueba barata si alguien las toca.

// Regex genérica canónica, reutilizada en 3 lugares del archivo original
// (paso 2 de atributos obligatorios, BRAND proactiva, BRAND reactiva).
const REGEX_GENERICO = /no\s*aplica|gen[eé]ric[oa]?|generic\b|sin\s*marca/i;

export function esValorNumericoValido(valorTexto: string): boolean {
  return /^\s*\d+([.,]\d+)?/.test(valorTexto);
}

// BUG real (combo "tatiana", item.attribute.number_invalid_format):
// Mercado Libre solo acepta un número en estos campos, nunca texto
// libre como "N/A" — ampliado a WIDTH/HEIGHT/LENGTH/WEIGHT (ancho/alto
// del producto, no del paquete) y a *_NUMBER (ej. SPEEDS_NUMBER,
// "Recortador de Patas de Perro", 0/8).
export const CAMPOS_NUMERICOS =
  /_WEIGHT$|_VOLUME$|_NUMBER$|DIAMETER$|^WIDTH$|^HEIGHT$|^LENGTH$|^WEIGHT$|^DEPTH$|^POWER$|^MIN_RECOMMENDED_AGE$|^UNITS_PER_PACK$/;

// BUG real ("Calostro En Polvo...", 0/2, item.attribute.number_invalid_format):
// varios atributos numéricos son "number_unit" y exigen la unidad al
// final ("1200 g", no "1200"). Ampliado con POWER ("Esterilizador
// Grownsy", 4/8) y DIAMETER (Melissa, con el patrón DIAMETER$ para
// cubrir también INNER_DIAMETER). _NUMBER y UNITS_PER_PACK están en
// CAMPOS_NUMERICOS pero NO acá: son conteo puro, sin unidad.
const UNIDAD_POR_DEFECTO: { patron: RegExp; unidad: string }[] = [
  { patron: /_WEIGHT$/, unidad: "g" },
  { patron: /_VOLUME$/, unidad: "mL" },
  { patron: /^MIN_RECOMMENDED_AGE$/, unidad: "años" },
  { patron: /^POWER$/, unidad: "W" },
  { patron: /DIAMETER$/, unidad: "cm" },
];

export function conUnidadSiHaceFalta(id: string, valorTexto: string): string {
  const yaTieneUnidad = /[a-zA-ZÀ-ÿ]/.test(valorTexto); // ya trae letras — no tocar
  if (yaTieneUnidad) return valorTexto;
  const regla = UNIDAD_POR_DEFECTO.find((r) => r.patron.test(id));
  return regla ? `${valorTexto} ${regla.unidad}` : valorTexto;
}

// BUG real (16/9, cuenta "juliana" — item.attribute.product_identifier.invalid_format):
// alguien escribió "Noaplica" a mano en GTIN pensando que era texto
// libre — GTIN es un código de barras real, no acepta ninguna forma de
// "no aplica". Se trata igual que vacío (se usa EMPTY_GTIN_REASON en su
// lugar) en vez de mandarlo como código real.
export function esGtinReal(valor: string | null | undefined): boolean {
  const normalizado = String(valor ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\s.\-_/]/g, "");
  if (!normalizado) return false;
  return !["noaplica", "na", "ninguno", "ningun", "sincodigo", "notiene"].includes(normalizado);
}

// Pedido de Mateo (22/9): cuando Mercado Libre exige GTIN real por
// marca registrada y no hay código de barras disponible, la única
// salida real es cambiar la marca a la opción Genérica real de esa
// categoría — nunca se inventa un nombre que no existe en la lista real.
export function marcaGenerica(brandDef: DefinicionAtributoMl | null | undefined): ValorAtributoMl | null {
  if (!brandDef?.values?.length) return null;
  return brandDef.values.find((v) => REGEX_GENERICO.test(v.name)) ?? null;
}

// Niño/niña antes que hombre/mujer (a propósito): "niño" no debe
// matchear por accidente con otro patrón más genérico. Mercado Libre
// valida GENDER CONTRA LAS PALABRAS DEL TÍTULO real (confirmado en su
// documentación pública) — no basta un "Unisex" por defecto (BUG real,
// cuenta de Melissa: invalid.title.gender).
const PATRONES_GENERO_TITULO: { palabras: RegExp; valores: RegExp }[] = [
  { palabras: /\bni[ñn]a[s]?\b|\bbeb[eé]\s*(ni[ñn]a)?\b/i, valores: /ni[ñn]a|infantil.*femen|girl/i },
  { palabras: /\bni[ñn]o[s]?\b/i, valores: /ni[ñn]o|infantil.*masculin|boy/i },
  { palabras: /\bdama[s]?\b|\bmujer(es)?\b|\bfemenin[oa]\b|\bella\b/i, valores: /mujer|dama|femenin|women/i },
  { palabras: /\bcaballero[s]?\b|\bhombre[s]?\b|\bmasculin[oa]\b|\b[ée]l\b/i, valores: /hombre|caballero|masculin|men\b/i },
  { palabras: /\bunisex\b/i, valores: /unisex/i },
];

export function detectarGeneroPorTitulo(titulo: string, valores: ValorAtributoMl[]): ValorAtributoMl | null {
  const texto = String(titulo ?? "");
  for (const patron of PATRONES_GENERO_TITULO) {
    if (patron.palabras.test(texto)) {
      const match = valores.find((v) => patron.valores.test(v.name));
      if (match) return match;
    }
  }
  // El título no menciona ningún género — "Unisex" es la única opción
  // que no puede chocar con nada que Mercado Libre lea en el título.
  return valores.find((v) => /unisex/i.test(v.name)) ?? null;
}

export class ReglaSaleFormatError extends Error {}

// Tres iteraciones históricas reales sobre el mismo caso:
// (a) Débora, 0/8: UNITS_PER_PACK vacío con SALE_FORMAT=Unidad.
// (b) Mateo, "Kit 5 Botellas de Viaje": un número VÁLIDO (5) puesto a
//     mano, pero la regla real no es "que sea número" — es "que sea
//     exactamente 1" cuando el formato es Unidad, sin excepción.
// (c) Caso espejo (Mateo, 25/9): con Pack, Mercado Libre exige lo
//     contrario — un número real >1, nunca inventado (si no hay valor
//     seguro, se falla ANTES de llamar a Mercado Libre).
export function aplicarReglaSaleFormat(atributosExtra: Record<string, string>): Record<string, string> {
  const resultado = { ...atributosExtra };
  if (resultado.SALE_FORMAT === "Unidad" && String(resultado.UNITS_PER_PACK ?? "").trim() !== "1") {
    resultado.UNITS_PER_PACK = "1";
  }
  if (resultado.SALE_FORMAT === "Pack") {
    const valor = String(resultado.UNITS_PER_PACK ?? "").trim();
    if (!valor || valor === "1") {
      throw new ReglaSaleFormatError(
        `Pusiste "Formato de venta: Pack" pero "Unidades por pack" quedó vacío o en 1 — Mercado Libre exige un número real mayor a 1 para un Pack. Complétalo con la cantidad real de unidades que trae el pack.`
      );
    }
  }
  return resultado;
}

const RESPALDO_DIMENSION_PRODUCTO: Record<string, [string | undefined, string]> = {
  WIDTH: ["", "cm"],
  HEIGHT: ["", "cm"],
  LENGTH: ["", "cm"],
  WEIGHT: ["", "g"],
};

// Ojo: "alto" del paquete mapea a HEIGHT, no a LENGTH.
function mapaRespaldoDesdeDimensiones(dim: DimensionesProducto): Record<string, [string | undefined, string]> {
  return {
    WIDTH: [dim.ancho, "cm"],
    HEIGHT: [dim.alto, "cm"],
    LENGTH: [dim.largo, "cm"],
    WEIGHT: [dim.peso, "g"],
  };
}

// Dos bugs reales encadenados (Mateo, 8 cuentas a la vez; "Esterilizador
// Compacto Grownsy", 4/8): algunas categorías piden WIDTH/HEIGHT/
// LENGTH/WEIGHT del PRODUCTO (no del paquete de envío), que Zilonix no
// tiene como campo propio. Precedencia exacta a preservar:
//  (1) texto con letras ya puesto → se deja intacto (incl. "No aplica").
//  (2) número puro ya puesto → se le concatena la unidad, SIN perder el
//      valor real (nunca se pisa con el respaldo del paquete).
//  (3) vacío/inválido con respaldo del paquete → "${respaldo} ${unidad}".
//  (4) vacío/inválido sin respaldo → se borra la clave (omitir > basura).
export function aplicarRespaldoDimensionesProducto(
  atributosExtra: Record<string, string>,
  dim: DimensionesProducto
): Record<string, string> {
  const resultado = { ...atributosExtra };
  const respaldos = mapaRespaldoDesdeDimensiones(dim);
  for (const [id, [valorRespaldo, unidad]] of Object.entries(respaldos)) {
    const actual = resultado[id];
    const actualTexto = actual !== undefined && actual !== null ? String(actual).trim() : "";
    const actualYaTieneUnidad = actualTexto !== "" && /[a-zA-ZÀ-ÿ]/.test(actualTexto);
    const actualEsNumeroPuro = actualTexto !== "" && !actualYaTieneUnidad && esValorNumericoValido(actualTexto);
    if (actualYaTieneUnidad) continue;
    if (actualEsNumeroPuro) {
      resultado[id] = `${actualTexto} ${unidad}`;
      continue;
    }
    if (valorRespaldo) {
      resultado[id] = `${valorRespaldo} ${unidad}`;
    } else {
      delete resultado[id];
    }
  }
  return resultado;
}

const IDS_PAQUETE_MAYUSCULA: Record<string, string> = {
  peso: "SELLER_PACKAGE_WEIGHT",
  largo: "SELLER_PACKAGE_LENGTH",
  ancho: "SELLER_PACKAGE_WIDTH",
  alto: "SELLER_PACKAGE_HEIGHT",
};
const IDS_PAQUETE_MINUSCULA: Record<string, string> = {
  peso: "seller_package_weight",
  largo: "seller_package_length",
  ancho: "seller_package_width",
  alto: "seller_package_height",
};

// BUG real (Melissa, categoría "Juguetes para Piñata" MCO457486, x3 —
// item.attribute.invalid.seller.package.dimensions): categorías
// creadas en 2024 exponen estos 4 atributos en MAYÚSCULA — mandarlos en
// minúscula hace que Mercado Libre no los reconozca (los rechaza como
// "inválidos", nunca como "faltantes"). Se detecta mirando cuál forma
// aparece de verdad en la categoría; si ninguna aparece, se cae a la
// minúscula de siempre (sin cambios para el resto de categorías).
export function resolverIdsPaquete(idsRealesCategoria: Set<string>): Record<"peso" | "largo" | "ancho" | "alto", string> {
  const resultado: Record<string, string> = {};
  for (const clave of Object.keys(IDS_PAQUETE_MAYUSCULA)) {
    resultado[clave] = idsRealesCategoria.has(IDS_PAQUETE_MAYUSCULA[clave]) ? IDS_PAQUETE_MAYUSCULA[clave] : IDS_PAQUETE_MINUSCULA[clave];
  }
  return resultado as Record<"peso" | "largo" | "ancho" | "alto", string>;
}

function normalizarParaComparar(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

export class ValorListaCerradaInvalidoError extends Error {}

// BUG real (Mateo, 28/9 — invalid.item.attribute.values:
// "Attribute [SUPPLEMENT_CLASS] is not valid, item values
// [(null:Colágeno hidrolizado)]"): el panel deja escribir cualquier
// texto a mano, pero Mercado Libre marca varios atributos como
// value_type "list" — una lista CERRADA, no una sugerencia. Se busca el
// valor real que coincida sin importar mayúsculas/tildes/espacios y se
// manda ESE (con el nombre exacto que espera Mercado Libre); si no
// coincide con ninguno, se avisa con las opciones válidas reales en vez
// de dejar pasar un texto que Mercado Libre va a rechazar igual.
export function canonicalizarValorListaCerrada(defAtributo: DefinicionAtributoMl, texto: string): string {
  if (defAtributo.value_type !== "list" || !defAtributo.values?.length) return texto;
  const normalizado = normalizarParaComparar(texto);
  const real = defAtributo.values.find((v) => normalizarParaComparar(v.name) === normalizado);
  if (!real) {
    const opciones = defAtributo.values.slice(0, 15).map((v) => v.name).join(", ");
    const sufijo = defAtributo.values.length > 15 ? "…" : "";
    throw new ValorListaCerradaInvalidoError(
      `"${texto}" no es un valor válido para "${defAtributo.name}" en Mercado Libre — hay que elegir uno de la lista real. Opciones válidas: ${opciones}${sufijo}`
    );
  }
  return real.name;
}

// OJO: nunca tomar `values[0]` a ciegas para autocompletar un
// obligatorio sin valor — caso real: en BRAND metió "Abercrombie &
// Fitch" en vez de una opción neutra, lo cual no solo está mal sino que
// puede disparar validaciones más estrictas (exigir GTIN real). Se
// busca primero una opción genérica/neutra (o, para GENDER, la que
// corresponda al título); solo si no existe ninguna se cae al primer
// valor de la lista.
export function valorAutocompletadoSeguro(
  attrId: string,
  titulo: string,
  valores: ValorAtributoMl[]
): ValorAtributoMl {
  const preferido = attrId === "GENDER" ? detectarGeneroPorTitulo(titulo, valores) : null;
  const generico = preferido ?? valores.find((v) => REGEX_GENERICO.test(v.name));
  return generico ?? valores[0];
}

// Árbol de decisión exacto confirmado en vivo (dos bugs reales
// encadenados, MCO8830 dept "supply" y MCO39965 comercio FullyLemon):
//  1. GTIN escrito a mano y esGtinReal() ⇒ se manda GTIN tal cual.
//  2. Si no, y la categoría ofrece EMPTY_GTIN_REASON (sin importar si
//     la categoría lo marcó obligatorio: el segundo bug fue justo que a
//     veces ML lo exige igual sin listarlo) ⇒ se manda el valor que
//     matchee "no tiene código registrado", o el primero de la lista.
//  3. En cualquier otro caso ⇒ GTIN = "No aplica" (siempre se manda
//     algo, nunca nada).
export function decidirAtributoGtin(
  gtinEscrito: string | undefined,
  emptyGtinReasonDef: DefinicionAtributoMl | null | undefined
): { id: string; value_name: string } {
  if (gtinEscrito && esGtinReal(gtinEscrito)) {
    return { id: "GTIN", value_name: String(gtinEscrito) };
  }
  if (emptyGtinReasonDef?.values?.length) {
    const razon = emptyGtinReasonDef.values.find((v) => /no tiene c[oó]digo registrado/i.test(v.name)) ?? emptyGtinReasonDef.values[0];
    if (razon) return { id: "EMPTY_GTIN_REASON", value_name: razon.name };
  }
  return { id: "GTIN", value_name: "No aplica" };
}

export function truncarTitulo(titulo: string): string {
  return titulo.slice(0, 60).trim();
}

// Error real evitado: "Available quantity max. value is 99999" (16/9,
// reportado desde FullyLemon — mismo publicador de fondo).
export function limitarStock(stock: number): number {
  return Math.min(Number(stock) || 1, 99999);
}

// Toda la detección de errores de Mercado Libre en el sistema actual es
// por regex sobre el texto crudo de la respuesta — frágil por diseño,
// pero es lo único disponible sin parsear el JSON de error real de ML.
// Se mantiene igual que el original (regla de fidelidad al 100%), con
// cada regex en su propia función con nombre, para que el port sea
// legible y cada una se pueda probar sola.
export function esErrorDeFamilyName(textoRespuesta: string): boolean {
  return /family[ _]?name/i.test(textoRespuesta);
}

export function exigeGtinPorMarca(textoRespuesta: string): boolean {
  return /missing_conditional_required/i.test(textoRespuesta) && /\[GTIN\]/i.test(textoRespuesta);
}

export function esRechazoDeVariantesPorCategoria(textoRespuesta: string): boolean {
  return /variations.*invalid.*family/i.test(textoRespuesta);
}

export function faltanDimensionesPaquete(textoRespuesta: string): boolean {
  return /missing\.seller\.package\.dimensions/i.test(textoRespuesta);
}

export function itemNoModificablePorRevision(textoRespuesta: string): boolean {
  return /item\.status\.not_modifiable/i.test(textoRespuesta);
}

export function clipRequiereReputacion(textoRespuesta: string): boolean {
  return /PA_UNAUTHORIZED_RESULT_FROM_POLICIES/.test(textoRespuesta);
}
