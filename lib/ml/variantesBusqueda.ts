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
// PanelDemanda.tsx) para no depender de otro viaje al servidor.

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
