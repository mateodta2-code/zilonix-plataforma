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
