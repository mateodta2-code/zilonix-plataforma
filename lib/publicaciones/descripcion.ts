// Publicar → «Crear con IA» — DESCRIPCIÓN. La IA redacta las partes de
// texto a partir de la ficha confirmada; el código arma el texto final y
// pone lo delicado SOLO con datos del vendedor:
// - «Se entrega con» sale de «Qué incluye» de la ficha confirmada.
// - «Garantía» solo si el vendedor la escribió; si no, no sale.
// - Se quita cualquier línea con promesas (días de prueba, garantías,
//   palabras que Mercado Libre no permite) y cualquier línea con una
//   cifra que no esté en la ficha (ej. «12 horas» inventado). Texto
//   plano, sin HTML ni emojis.

import { palabrasProhibidas } from "@/lib/ia/contenidoReglas";
import { extraerJson, fichaEnTexto, soloCifrasConfirmadas, type Ficha } from "./ficha";

export const LARGO_MAXIMO_DESCRIPCION = 5_000;

export type PartesDescripcion = {
  queEs: string | null;
  caracteristicas: string[];
  beneficios: string[];
  modoUso: string[];
  preguntas: { pregunta: string; respuesta: string }[];
};

type Encabezados = Record<"queEs" | "caracteristicas" | "beneficios" | "modoUso" | "incluye" | "garantia" | "preguntas", string>;

const ENCABEZADOS_ES: Encabezados = {
  queEs: "QUÉ ES",
  caracteristicas: "CARACTERÍSTICAS",
  beneficios: "BENEFICIOS",
  modoUso: "MODO DE USO",
  incluye: "SE ENTREGA CON",
  garantia: "GARANTÍA",
  preguntas: "PREGUNTAS FRECUENTES",
};
const ENCABEZADOS_PT: Encabezados = {
  queEs: "O QUE É",
  caracteristicas: "CARACTERÍSTICAS",
  beneficios: "BENEFÍCIOS",
  modoUso: "MODO DE USO",
  incluye: "CONTEÚDO DA EMBALAGEM",
  garantia: "GARANTIA",
  preguntas: "PERGUNTAS FREQUENTES",
};

export function encabezadosDe(idioma: string): Encabezados {
  return idioma.toLowerCase().startsWith("pt") ? ENCABEZADOS_PT : ENCABEZADOS_ES;
}

// Promesas que la IA no puede poner (son condiciones de venta o cifras sin
// confirmar). La garantía va SOLO en su sección, con el texto del vendedor.
const PROMESAS = [/\b\d+\s*d[ií]as?\b/i, /\bprueba\s+gratis\b/i, /\bgarant[ií]a\b|\bgarantia\b|\bgarantizad/i, /\bdevoluci[oó]n\b|\bdevolu[cç][aã]o\b/i, /\breembols/i];

const EMOJIS = /\p{Extended_Pictographic}/gu;

function limpiarLinea(texto: unknown, permitido: string): string | null {
  if (typeof texto !== "string") return null;
  const linea = texto.replace(/<[^>]*>/g, " ").replace(EMOJIS, "").replace(/^[\s\-•*·\d.)]+/, "").replace(/\s+/g, " ").trim();
  if (!linea) return null;
  if (PROMESAS.some((p) => p.test(linea))) return null;
  if (palabrasProhibidas([linea]).length > 0) return null;
  if (!soloCifrasConfirmadas(linea, permitido)) return null;
  return linea.slice(0, 400);
}

function lista(valor: unknown, permitido: string, maximo = 8): string[] {
  return (Array.isArray(valor) ? valor : [])
    .map((v) => limpiarLinea(v, permitido))
    .filter((v): v is string => v !== null)
    .slice(0, maximo);
}

// Palabras clave de los títulos (23-nov): la descripción las usa de forma
// natural para ayudar en la búsqueda, sin agregar datos por usarlas.
export const MAXIMO_PALABRAS_DESCRIPCION = 20;

export function limpiarPalabrasClave(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const vistas = new Set<string>();
  const palabras: string[] = [];
  for (const p of v) {
    if (typeof p !== "string") continue;
    const limpia = p.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    const clave = limpia.toLowerCase();
    if (limpia.length < 3 || vistas.has(clave)) continue;
    vistas.add(clave);
    palabras.push(limpia);
    if (palabras.length >= MAXIMO_PALABRAS_DESCRIPCION) break;
  }
  return palabras;
}

export function promptDescripcion(entrada: { ficha: Ficha; idioma: string; pais: string; palabrasClave?: string[] }): string {
  const palabras = entrada.palabrasClave ?? [];
  return [
    `Eres redactor de publicaciones de Mercado Libre ${entrada.pais}. Escribe las partes de la descripción de este producto.`,
    "",
    "Ficha confirmada por el vendedor (usa SOLO estos datos):",
    fichaEnTexto(entrada.ficha),
    "",
    ...(palabras.length > 0
      ? [
          `Palabras que la gente busca (úsalas de forma natural en el texto SOLO si describen este producto según la ficha; nunca agregues un dato nuevo por usarlas ni las repitas en lista): ${palabras.join(", ")}`,
          "",
        ]
      : []),
    "Reglas obligatorias:",
    `- En ${entrada.idioma}, con tildes y ortografía correctas. Frases cortas y claras.`,
    "- No inventes nada que no esté en la ficha: ni medidas, ni tiempos, ni cifras, ni materiales, ni usos.",
    "- No escribas garantías, devoluciones, días de prueba, envíos, precios ni promociones.",
    "- Sin promesas de salud ni palabras como curar, tratar, prevenir, eliminar, garantizado o expertos.",
    "- «preguntas»: responde las dudas del comprador de la ficha SOLO si la ficha tiene la respuesta; si no, no incluyas esa pregunta.",
    "",
    'Responde SOLO un JSON: {"queEs": "un párrafo", "caracteristicas": ["…"], "beneficios": ["…"], "modoUso": ["paso 1", "…"], "preguntas": [{"pregunta": "¿…?", "respuesta": "…"}]}',
  ].join("\n");
}

// `permitido`: la ficha confirmada en texto (las cifras válidas salen de ahí).
export function leerPartesDescripcion(respuesta: string, permitido: string): PartesDescripcion | null {
  const json = extraerJson(respuesta);
  if (!json) return null;
  const preguntas = (Array.isArray(json.preguntas) ? json.preguntas : [])
    .map((p) => {
      const o = p !== null && typeof p === "object" ? (p as Record<string, unknown>) : {};
      const pregunta = limpiarLinea(o.pregunta, permitido);
      const respuesta = limpiarLinea(o.respuesta, permitido);
      return pregunta && respuesta ? { pregunta, respuesta } : null;
    })
    .filter((p): p is { pregunta: string; respuesta: string } => p !== null)
    .slice(0, 6);
  return {
    queEs: limpiarLinea(json.queEs, permitido),
    caracteristicas: lista(json.caracteristicas, permitido),
    beneficios: lista(json.beneficios, permitido),
    modoUso: lista(json.modoUso, permitido),
    preguntas,
  };
}

// El texto final. «Se entrega con» y «Garantía» los pone el código con los
// datos del vendedor; una sección sin datos no sale.
export function armarDescripcion(partes: PartesDescripcion, entrada: { ficha: Ficha; garantia: string; idioma: string }): string {
  const e = encabezadosDe(entrada.idioma);
  const secciones: string[] = [];
  const seccion = (titulo: string, cuerpo: string[]) => {
    if (cuerpo.length > 0) secciones.push([titulo, ...cuerpo].join("\n"));
  };
  if (partes.queEs) seccion(e.queEs, [partes.queEs]);
  seccion(e.caracteristicas, partes.caracteristicas.map((c) => `- ${c}`));
  seccion(e.beneficios, partes.beneficios.map((b) => `- ${b}`));
  seccion(e.modoUso, partes.modoUso.map((p, i) => `${i + 1}. ${p}`));
  seccion(e.incluye, entrada.ficha.incluye.origen === "supuesto" ? [] : entrada.ficha.incluye.valor.map((i) => `- ${i}`));
  const garantia = entrada.garantia.replace(/<[^>]*>/g, " ").replace(EMOJIS, "").replace(/\s+/g, " ").trim();
  if (garantia) seccion(e.garantia, [garantia]);
  seccion(e.preguntas, partes.preguntas.map((p) => `${p.pregunta}\n${p.respuesta}`));
  return secciones.join("\n\n").slice(0, LARGO_MAXIMO_DESCRIPCION);
}
