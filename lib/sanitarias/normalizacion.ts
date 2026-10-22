// Issue #61 (Z-NV-03a) — port casi literal de la sección "Texto y
// registros sanitarios" de lib/alertas-sanitarias.js (zilonix-os,
// autor Frankie). Sin fetch, sin db, sin process.env — solo texto.

export function normalizar(texto: string | null | undefined): string {
  return String(texto || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Formatos que usa el INVIMA: RSA-0021928-2022, NSA-002598-2017, PSA-…,
// SD2019-0004321 (suplementos viejos), NSOC36162-24CO (cosméticos),
// PFM2015-0001234 (fitoterapéuticos), RSAD05I27915 (formato de 2005) e
// INVIMA 2019M-0012345 (medicamentos).
const PATRON_REGISTRO = new RegExp(
  [
    String.raw`\b(?:RSA|NSA|PSA|RSAE|NSAE|RSIA|NSIA)\s?-?\s?\d{3,7}\s?-?\s?(?:19|20)\d{2}\b`,
    String.raw`\bSD\s?(?:19|20)\d{2}\s?-\s?\d{5,7}\b`,
    String.raw`\bNSOC\s?\d{3,6}\s?-\s?\d{2}\s?[A-Z]{2}\b`,
    String.raw`\bPFM\s?(?:19|20)\d{2}\s?-?\s?\d{5,7}\b`,
    String.raw`\bRS[A-Z]{1,2}\d{2}[IM]\d{4,6}\b`,
    String.raw`\bINVIMA\s?(?:19|20)\d{2}\s?[A-Z]{1,3}\s?-\s?\d{5,8}(?:-R\d)?\b`,
  ].join("|"),
  "gi"
);

function registroNormal(r: string): string {
  return String(r).toUpperCase().replace(/^INVIMA\s*/, "INVIMA").replace(/\s/g, "");
}

export function extraerRegistros(texto: string | null | undefined): string[] {
  const vistos = new Set<string>();
  for (const m of String(texto || "").matchAll(PATRON_REGISTRO)) vistos.add(registroNormal(m[0]));
  return [...vistos].sort();
}

// El mismo registro aparece escrito de varias formas (RSA-0021928-2022 y
// RSA-021928-2022, "SD 2007-0000316" y "SD2007-0000316"). Para comparar se
// reduce a [prefijo, número sin ceros a la izquierda, año].
export function partesRegistro(r: string): [string, string, string] {
  const c = registroNormal(r).replace(/[^A-Z0-9]/g, "").replace(/^INVIMA/, "");
  let m = c.match(/^(SD|PFM)((?:19|20)\d{2})(\d+)$/);
  if (m) return [m[1], String(Number(m[3])), m[2]];
  m = c.match(/^([A-Z]+)(\d+?)((?:19|20)\d{2})$/);
  if (m && !c.startsWith("NSOC")) return [m[1], String(Number(m[2])), m[3]];
  return [c, "", ""];
}

export const clavePartes = (r: string): string => partesRegistro(r).join("|");

// Desde 2023 el INVIMA numera los RSA/NSA/PSA con 5 dígitos o más
// (NSA-0021547-2026). Un número de 2025 con 3 o 4 dígitos no sigue esa
// numeración: puede ser un error al escribirlo o un número que no existe.
export function formatoRaro(r: string): boolean {
  const [pre, num, anio] = partesRegistro(r);
  return ["RSA", "NSA", "PSA"].includes(pre) && Number(anio) >= 2023 && num.length > 0 && num.length < 5;
}

// Palabras que por sí solas no identifican un producto: ingredientes y
// términos de categoría. "Resveratrol" sale en catorce alertas de otras
// marcas; si contara, todo lo nuestro con resveratrol saldría alertado.
const GENERICAS = new Set(
  normalizar(`
  marca marcas suplemento suplementos dietario dietarios producto productos alimento polvo capsulas capsula
  tabletas tableta gomitas gomas colageno hidrolizado resveratrol vitamina vitaminas minerales magnesio biotina
  zinc calcio proteina whey omega natural original premium plus max forte ultra complex gold pro mujer hombre
  ninos te verde detox fibra crema gel serum mascarilla shampoo locion aceite extracto de del la el los las con
  y para en sin sabor mg ml g gr unidades unidad und maca moringa curcuma jengibre spirulina espirulina garcinia
  cambogia ashwagandha melena leon calostro bovino vinagre manzana colon linaza chia quemador grasa adelgazante
  keto cafe cacao ganoderma glucosamina hialuronico acido quitosan clorofila arandano berberina creatina creatine
  monohidratada monohydrate fenogreco aguaje pepino nad carnitina bisglicinato tiroides higado drenador digestivo
  energia sueno melatonina ginseng propoleo jalea real miel magnesium collagen vitamin protein oil capsules
  tablets gummies powder pura puro mix kit combo nuevo nueva frasco sobres sachets citrato x1 x2 x3 x4 x5 x6
  promocionados promocionado comercializacion ilegal fraudulento fraudulentos invima registro sanitario
`).split(" ")
);

export function clavesDistintivas(texto: string | null | undefined): Set<string> {
  return new Set(normalizar(texto).split(" ").filter((w) => w.length > 2 && !GENERICAS.has(w) && !/^\d+$/.test(w)));
}

// Palabras que no dicen nada del producto, para comparar nombres completos
// (sin quitar los ingredientes, que ahí sí importan: la alerta 326-2024 es
// sobre la mezcla "citrato de magnesio + citrato de potasio", sin marca).
const VACIAS = new Set(
  normalizar(`
  de del la el los las con y a o en para por sin x marca marcas producto productos base variedad variedades
  sabor sabores natural original alimento alimentos tipo presentacion unidades unidad und mg ml g gr kg
  suplemento suplementos dietario dietarios promocionado promocionados como bajo nombre
`).split(" ")
);

export function palabrasDelNombre(texto: string | null | undefined): Set<string> {
  return new Set(normalizar(texto).split(" ").filter((w) => w.length > 1 && !VACIAS.has(w) && !/^\d+$/.test(w)));
}

export function marcaDeNombre(nombre: string | null | undefined): string {
  const m = String(nombre || "").match(/\bmarcas?\s*:?\s+(.+)$/i);
  return m ? m[1] : "";
}

export const contiene = (grande: Set<string>, chico: Set<string>): boolean => [...chico].every((w) => grande.has(w));
