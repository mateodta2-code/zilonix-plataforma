// Optimización — imágenes de contenido (informativas) con el prompt de
// contenido de Melissa / Zilonix (19-nov). Puro, sin servidor: lo usan
// la pantalla (revisar el copy mientras se edita, mostrar el prompt
// final) y el servidor (que vuelve a revisar todo antes de crear: nunca
// se confía en lo que manda el navegador).
//
// Flujo de aprobación del prompt: la IA de texto PROPONE título, copy y
// composición; la persona lo revisa/edita y solo con «CREAR» se genera
// la imagen. Un copy con palabras prohibidas no se crea.

export const TIPOS_CONTENIDO = [
  { id: "modo_uso", nombre: "Modo de uso", guia: "Modo de uso en pasos 1–2–3 con íconos simples.", min: 2, max: 4 },
  { id: "caracteristicas", nombre: "Características", guia: "4 a 6 especificaciones o datos de presentación del producto.", min: 3, max: 6 },
  { id: "beneficios", nombre: "Beneficios", guia: "Beneficios en lenguaje neutro (apoya, contribuye, sensación de…), sin promesas.", min: 3, max: 5 },
  { id: "ventajas", nombre: "Ventajas", guia: "Por qué elegirlo frente a opciones genéricas, sin nombrar marcas.", min: 3, max: 5 },
  { id: "incluye", nombre: "Qué incluye", guia: "Qué incluye y sus ingredientes o componentes, exactamente como dice la ficha.", min: 1, max: 6 },
  { id: "como_funciona", nombre: "Cómo funciona", guia: "Diagrama simple 1→2→3 de cómo funciona, sin lenguaje médico.", min: 2, max: 4 },
  {
    id: "comparacion",
    nombre: "Comparación",
    guia: "Tabla «Este producto» vs «Otras opciones», sin marcas. Cada línea: «Fila: este producto | otras opciones» (presentación, facilidad de uso, material o textura, qué incluye, uso diario, versatilidad).",
    min: 3,
    max: 6,
  },
  { id: "contexto", nombre: "Contexto de uso", guia: "Escena realista donde se usa (hogar, baño, escritorio, gym, según aplique), sin símbolos médicos; 0 a 2 textos muy cortos.", min: 0, max: 2 },
  {
    id: "opiniones",
    nombre: "Opiniones reales",
    guia: "3 a 5 opiniones REALES de compradores, sin resultados ni promesas. Nunca inventadas.",
    min: 1,
    max: 5,
  },
  { id: "faq", nombre: "Preguntas frecuentes", guia: "4 a 6 preguntas frecuentes, cada una «¿Pregunta? Respuesta de una línea».", min: 3, max: 6 },
] as const;

export type TipoContenido = (typeof TIPOS_CONTENIDO)[number]["id"];
export type Composicion = "izquierda" | "centro" | "derecha";
export const COMPOSICIONES: Composicion[] = ["izquierda", "centro", "derecha"];

export type ContenidoImagen = { tipo: TipoContenido; titulo: string; bullets: string[]; composicion: Composicion };

export const LARGO_TITULO = 60;
export const LARGO_BULLET = 110;

// «Opiniones reales» nunca las escribe la IA: inventar reseñas es
// publicidad engañosa. La persona pega opiniones reales de compradores.
export function tipoLoEscribeLaIA(tipo: TipoContenido): boolean {
  return tipo !== "opiniones";
}

export function tipoContenido(id: unknown): (typeof TIPOS_CONTENIDO)[number] | null {
  return TIPOS_CONTENIDO.find((t) => t.id === id) ?? null;
}

// Lista del prompt (cumplimiento de Mercado Libre). Se compara sin
// tildes y por palabra completa: «segura» no es «cura».
const PROHIBIDAS: { texto: string; patron: RegExp }[] = [
  ["cura / curar", /\bcur(a|ar|an|as|o|e|en|aron|acion|ativo|ativa|ara)\b/],
  ["tratar / tratamiento", /\btrat(a|ar|amiento|amientos)\b/],
  ["prevenir / prevención", /\bprevien\w*|\bpreven(ir|cion|tivo|tiva)\b/],
  ["alivio / alivia", /\bali(vio|via|viar)\b/],
  ["enfermedad / afección", /\benfermedad(es)?\b|\bafeccion(es)?\b/],
  ["diagnóstico", /\bdiagnostic\w*/],
  ["clínicamente probado", /\bclinicamente\b/],
  ["aprobado por médicos", /\bmedic(o|os|a|as)\b/],
  ["recomendado por expertos", /\bexpert(o|os|a|as)\b/],
  ["garantizado", /\bgarantizad(o|os|a|as)\b/],
  ["100 % efectivo", /\b100\s*%?\s*efectiv\w*/],
  ["elimina", /\belimin\w*/],
  ["combate", /\bcombat\w*/],
  ["rejuvenece", /\brejuvenec\w*/],
  ["anti-envejecimiento", /\banti-?\s?envejec\w*/],
  ["regenera", /\bregener\w*/],
  ["desinflama", /\bdesinflam\w*/],
  ["sana / sanar", /\bsan(a|ar|an)\b/],
  ["antes / después", /\bantes\s*(y|\/|-)\s*despues\b/],
  ["«desde el primer mes verás»", /\bprimer mes\b/],
].map(([texto, patron]) => ({ texto: texto as string, patron: patron as RegExp }));

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Las palabras prohibidas que aparecen en el copy (vacío = se puede crear).
export function palabrasProhibidas(textos: string[]): string[] {
  const todo = sinTildes(textos.join(" \n "));
  return PROHIBIDAS.filter((p) => p.patron.test(todo)).map((p) => p.texto);
}

export function limpiarContenido(crudo: unknown): ContenidoImagen | null {
  if (!crudo || typeof crudo !== "object") return null;
  const c = crudo as Record<string, unknown>;
  const tipo = tipoContenido(c.tipo);
  if (!tipo) return null;
  const titulo = typeof c.titulo === "string" ? c.titulo.replace(/\s+/g, " ").trim().slice(0, LARGO_TITULO) : "";
  const bullets = (Array.isArray(c.bullets) ? c.bullets : [])
    .filter((b): b is string => typeof b === "string")
    .map((b) => b.replace(/\s+/g, " ").replace(/^\s*(?:[-•*]+|\d{1,2}[.)])\s*/, "").trim().slice(0, LARGO_BULLET))
    .filter(Boolean)
    .slice(0, tipo.max);
  const composicion = COMPOSICIONES.includes(c.composicion as Composicion) ? (c.composicion as Composicion) : "izquierda";
  return { tipo: tipo.id, titulo, bullets, composicion };
}

// Qué le falta al contenido para poder crearse (null = listo).
export function faltaParaCrear(contenido: ContenidoImagen): string | null {
  const tipo = tipoContenido(contenido.tipo);
  if (!tipo) return "Elige qué imagen quieres crear.";
  if (!contenido.titulo) return "Escribe el título de la imagen.";
  if (contenido.bullets.length < tipo.min) return `Escribe al menos ${tipo.min} ${tipo.min === 1 ? "línea" : "líneas"} de texto.`;
  const prohibidas = palabrasProhibidas([contenido.titulo, ...contenido.bullets]);
  if (prohibidas.length > 0) return `Quita estas palabras, Mercado Libre no las permite: ${prohibidas.join(", ")}.`;
  return null;
}

// PROMPT FINAL (plantilla del prompt de contenido). Es el mismo que se
// muestra para copiar y el que se manda a la IA de imágenes.
export function promptImagenContenido(contenido: ContenidoImagen, tituloProducto: string | null): string {
  const tipo = tipoContenido(contenido.tipo);
  const textos = contenido.bullets.map((b, i) => `${i + 1}) ${b}`).join(" ");
  return [
    `Imagen publicitaria hiperrealista estilo e-commerce premium para Mercado Libre, formato cuadrado 1:1. Tipo de imagen: ${tipo?.nombre ?? ""} — ${tipo?.guia ?? ""}`,
    tituloProducto ? `El producto es: "${tituloProducto.slice(0, 120)}".` : "",
    "Producto real EXACTAMENTE igual a las fotos de referencia: mismo color, forma, etiqueta, logo, textos y proporciones. No inventes ingredientes, usos, certificaciones, sellos, registros ni accesorios.",
    "Iluminación de estudio suave (studio soft light), sombras suaves, nitidez alta. Fondo creativo y llamativo pero limpio (gradiente premium y formas sutiles) que no distraiga. El producto siempre protagonista.",
    `Composición: producto a la ${contenido.composicion === "centro" ? "mitad (centro)" : contenido.composicion}.`,
    `Título de la imagen, grande y legible: "${contenido.titulo}".`,
    textos ? `Textos cortos, exactamente así, con íconos y gráficos minimalistas (flechas, bloques) sin saturar: ${textos}` : "Sin textos adicionales: la escena comunica sola.",
    contenido.tipo === "comparacion" ? "Dibuja una tabla limpia de dos columnas, «Este producto» y «Otras opciones», sin marcas ni logos de terceros." : "",
    "Tipografía moderna, legible en celular, ortografía en español correcta. No agregues ningún otro texto.",
    "Cumplimiento Mercado Libre: lenguaje informativo, sin promesas, sin curas ni tratamientos, sin «expertos», sin antes/después, sin símbolos médicos.",
  ]
    .filter(Boolean)
    .join(" ");
}
