// Issue #221 — "Analizar estilo OS": con la extensión instalada, un
// solo clic en "Analizar" también escanea el listado REAL de Mercado
// Libre (no solo la API de catálogo) para el término escrito y unas
// pocas variantes — amplía la cobertura a publicaciones que la API
// de catálogo no enlaza. Esta heurística de texto genera esas
// variantes.
//
// A propósito NUNCA es IA/semántica real — el pedido lo pide
// explícito ("heurística OK si no hay IA lista; documentá TODO"):
// son transforms mecánicos de texto, cada uno documentado con su
// propia limitación conocida, nunca una lista de sinónimos adivinada
// ni un término no relacionado con lo que la persona escribió.
//
// Puro, sin I/O — se usa del lado del cliente (app/panel/investigacion/
// PanelInvestigacion.tsx) para no depender de otro viaje al servidor.

// Quita diacríticos (tildes/diéresis) — transform puramente mecánico
// (Unicode NFD + quitar los acentos combinados). Mucha gente busca
// sin tilde y Mercado Libre indexa las dos formas.
function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Singular/plural del último token — regla ingenua de español (si
// termina en "s" se la quita, si no termina en "s" se la agrega).
// NUNCA correcta para todos los casos reales (ej. "lápiz"/"lápices",
// "ley"/"leyes" no siguen esta regla) — aceptada a propósito como
// aproximación barata mientras no haya IA lista (pedido explícito),
// nunca presentada como gramaticalmente correcta.
function alternarPlural(ultimaPalabra: string): string {
  return ultimaPalabra.endsWith("s") ? ultimaPalabra.slice(0, -1) : `${ultimaPalabra}s`;
}

function agregarSiNuevo(lista: string[], candidato: string): void {
  const limpio = candidato.trim();
  if (!limpio) return;
  const normalizado = limpio.toLowerCase();
  if (lista.some((v) => v.toLowerCase() === normalizado)) return; // nunca una variante repetida -> nunca una pestaña repetida de más
  lista.push(limpio);
}

// Devuelve el término tal cual (siempre primero) + hasta `tope - 1`
// variantes mecánicas, sin duplicados — "~término + 3-4" del pedido.
export function generarVariantesBusqueda(termino: string, tope = 4): string[] {
  const base = termino.trim();
  if (!base) return [];

  const variantes = [base];
  agregarSiNuevo(variantes, sinTildes(base));

  const palabras = base.split(/\s+/).filter(Boolean);
  // Orden de palabras invertido — solo tiene sentido con 2+ palabras
  // (invertir una sola palabra no cambia nada).
  if (palabras.length >= 2) agregarSiNuevo(variantes, [...palabras].reverse().join(" "));

  if (palabras.length >= 1) {
    const ultimaAlternada = alternarPlural(palabras[palabras.length - 1]);
    agregarSiNuevo(variantes, [...palabras.slice(0, -1), ultimaAlternada].join(" "));
  }

  return variantes.slice(0, Math.max(1, tope));
}

// Issue #225 — "5 búsquedas = término + 4 variantes de IA, con
// respaldo de reglas si la IA falla/viene vacía/repite": combina el
// término + las variantes que trajo generarVariantesIA (lib/ml/variantesIA.ts,
// server-only, nunca importado acá) + esta misma heurística mecánica
// como respaldo, hasta completar TOPE_QUERIES_ANALIZAR únicas. Puro —
// nunca llama a la IA directamente (eso vive en lib/ml/variantesIA.ts
// y en el Server Action que llama a los dos), así que se puede probar
// con vitest simulando cualquier resultado de la IA (vacío, repetido,
// con tildes de más) sin red ni mock de fetch.
export const TOPE_QUERIES_ANALIZAR = 5; // término + hasta 4 variantes

// Normaliza para COMPARAR, nunca para mostrar: minúsculas + sin
// tildes + espacios colapsados. Dos variantes que solo difieren en
// mayúsculas, un acento o espacios de más cuentan como LA MISMA —
// nunca se abren dos pestañas casi idénticas por una diferencia así.
function normalizarParaComparar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

// Issue #225 (parte B) — mismo dedup, genérico para cualquier lista de
// queries (no solo las de Mercado Libre) — Amazon/Temu/AliExpress/
// Shein/Alibaba lo reusan tal cual para deduplicar lo que devuelve la
// IA (lib/ml/variantesIA.ts, generarVariantesPlataforma) sin necesitar
// la heurística de reglas (que es específica de texto en español).
export function dedupQueries(queries: string[], tope: number): string[] {
  const resultado: string[] = [];
  const vistos = new Set<string>();
  for (const candidato of queries) {
    const limpio = candidato.trim();
    if (!limpio) continue;
    const clave = normalizarParaComparar(limpio);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    resultado.push(limpio);
    if (resultado.length >= tope) break;
  }
  return resultado;
}

export function completarQueriesAnalizar(termino: string, variantesIA: string[]): string[] {
  const base = termino.trim();
  if (!base) return [];

  const queries: string[] = [];
  const vistos = new Set<string>();
  function agregar(candidato: string) {
    const limpio = candidato.trim();
    if (!limpio) return;
    const clave = normalizarParaComparar(limpio);
    if (vistos.has(clave)) return; // ya está (exacto, o solo distinto en may/min, tilde o espacios) — nunca una query repetida
    vistos.add(clave);
    queries.push(limpio);
  }

  agregar(base);
  for (const variante of variantesIA) agregar(variante);

  // Respaldo de reglas — corre SIEMPRE que todavía falten queries,
  // nunca solo cuando variantesIA viene vacío: si la IA repitió el
  // término o trajo menos de 4, el respaldo completa lo que falte
  // hasta llegar a TOPE_QUERIES_ANALIZAR (o hasta que la heurística
  // misma se quede sin variantes nuevas que ofrecer).
  if (queries.length < TOPE_QUERIES_ANALIZAR) {
    for (const variante of generarVariantesBusqueda(base, TOPE_QUERIES_ANALIZAR)) agregar(variante);
  }

  return queries.slice(0, TOPE_QUERIES_ANALIZAR);
}
