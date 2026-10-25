// Issue #225 — "Analizar estilo OS": 4 variantes de búsqueda generadas
// por IA, mismo espíritu y mismo prompt (confirmado contra el código
// real que corre en producción, nunca adivinado) que zilonix-os-web,
// lib/busqueda-productos.js (generarVariantes). Server SOLO — importa
// lib/anthropic.ts (ANTHROPIC_API_KEY), nunca se importa desde un
// Client Component.
//
// Nunca lanza: si la IA falla, viene vacía, o repite el término, el
// llamador (app/panel/investigacion/actions.ts, con
// completarQueriesAnalizar de lib/ml/variantesBusqueda.ts) completa con
// la heurística de reglas hasta 5 únicas — Analizar nunca se rompe por
// esto, en el peor caso escanea solo con las variantes de reglas.
import { askClaude } from "@/lib/anthropic";

export async function generarVariantesIA(termino: string): Promise<string[]> {
  const prompt = `Dame 4 variantes cortas (2-4 palabras cada una) en español de Colombia para buscar el producto "${termino}" en Mercado Libre — sinónimos o formas alternativas que alguien usaría para buscarlo. Responde SOLO con un array JSON de 4 strings, sin texto adicional ni explicación. Ejemplo exacto de formato: ["variante uno","variante dos","variante tres","variante cuatro"]`;
  try {
    const texto = await askClaude(prompt, { maxTokens: 220 });
    const match = texto.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(match ? match[0] : texto);
    if (Array.isArray(arr) && arr.length) return arr.slice(0, 4).map(String).filter(Boolean);
  } catch {
    // Sin variantes de IA — el llamador completa con la heurística de
    // reglas, nunca se rompe Analizar por esto.
  }
  return [];
}

// Issue #225 (parte B) — mismo espíritu, mismos prompts (confirmados
// contra el código real de zilonix-os-web, nunca adivinados) que:
//   - Amazon: lib/busqueda-productos-amazon.js (generarTerminosBusqueda)
//   - Alibaba: lib/busqueda-productos-alibaba.js (idem)
//   - Temu/AliExpress/Shein: lib/busqueda-productos-{temu,aliexpress,shein}.js
// Amazon y Alibaba piden la traducción al inglés (son sitios en inglés,
// aunque la persona escriba en español); Temu/AliExpress/Shein piden
// variantes en español de Colombia (sitios ya localizados). A
// diferencia de generarVariantesIA (Mercado Libre, arriba), estas 5
// SIEMPRE piden las 5 queries completas a la IA (OS no tiene una
// heurística de reglas para otro idioma) — el respaldo si la IA falla
// es simplemente [terminoOriginal] (igual que OS), nunca inventa una
// traducción propia.
export type PlataformaMultiplataforma = "amazon" | "temu" | "aliexpress" | "shein" | "alibaba";

const PROMPTS_POR_PLATAFORMA: Record<PlataformaMultiplataforma, (termino: string) => string> = {
  amazon: (termino) =>
    `Quiero buscar en Amazon.com (en inglés) este producto, descrito posiblemente en español: "${termino}". Dame 5 términos de búsqueda CORTOS EN INGLÉS (2-4 palabras cada uno) que un comprador real usaría en Amazon para encontrarlo — el primero debe ser la traducción o término principal más directo, los demás sinónimos o variantes reales de compradores. Responde SOLO con un array JSON de 5 strings en inglés, sin texto adicional ni explicación. Ejemplo exacto de formato: ["main term","variant two","variant three","variant four","variant five"]`,
  alibaba: (termino) =>
    `Quiero buscar en Alibaba.com este producto, descrito posiblemente en español: "${termino}". Dame 5 términos de búsqueda CORTOS EN INGLÉS (2-4 palabras cada uno) que un comprador mayorista real usaría para encontrarlo en Alibaba. El primero debe ser la traducción o término principal más directo. Responde SOLO con un array JSON de 5 strings en inglés, sin texto adicional ni explicación. Ejemplo exacto de formato: ["main term","variant two","variant three","variant four","variant five"]`,
  temu: (termino) =>
    `Dame 5 variantes cortas (2-4 palabras cada una) en español de Colombia para buscar el producto "${termino}" en Temu — sinónimos o formas alternativas que alguien usaría para buscarlo. El primero debe ser el término más directo y específico. Responde SOLO con un array JSON de 5 strings, sin texto adicional ni explicación. Ejemplo exacto de formato: ["termino uno","termino dos","termino tres","termino cuatro","termino cinco"]`,
  aliexpress: (termino) =>
    `Dame 5 variantes cortas (2-4 palabras cada una) en español de Colombia para buscar el producto "${termino}" en AliExpress — sinónimos o formas alternativas que alguien usaría para buscarlo. El primero debe ser el término más directo y específico. Responde SOLO con un array JSON de 5 strings, sin texto adicional ni explicación. Ejemplo exacto de formato: ["termino uno","termino dos","termino tres","termino cuatro","termino cinco"]`,
  shein: (termino) =>
    `Dame 5 variantes cortas (2-4 palabras cada una) en español de Colombia para buscar el producto "${termino}" en Shein — sinónimos o formas alternativas que alguien usaría para buscarlo. El primero debe ser el término más directo y específico. Responde SOLO con un array JSON de 5 strings, sin texto adicional ni explicación. Ejemplo exacto de formato: ["termino uno","termino dos","termino tres","termino cuatro","termino cinco"]`,
};

export async function generarVariantesPlataforma(termino: string, plataforma: PlataformaMultiplataforma): Promise<string[]> {
  const prompt = PROMPTS_POR_PLATAFORMA[plataforma](termino);
  try {
    const texto = await askClaude(prompt, { maxTokens: 260 });
    const match = texto.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(match ? match[0] : texto);
    if (Array.isArray(arr) && arr.length) return arr.slice(0, 5).map(String).filter(Boolean);
  } catch {
    // Sin variantes de IA — mismo respaldo que zilonix-os-web: el
    // término original tal cual, nunca una traducción inventada.
  }
  return [termino];
}
