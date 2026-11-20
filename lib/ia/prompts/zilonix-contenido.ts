// Estilo «Contenido Zilonix»: el texto ORIGINAL de Mateo (Anexo B) pide,
// por cada una de las 10 imágenes, enviar ANTES de crear: título, copy,
// composición y PROMPT FINAL COPIABLE, y crear solo con «CREAR». Aquí:
// - la propuesta la arma la IA de TEXTO (promptPropuestaContenidoZilonix),
// - el código revisa el copy (revisarCopySeguro, la lista «Prohibido»),
// - el prompt final es la PLANTILLA del punto 6 del texto de Mateo, leída
//   del texto original (no copiada aparte) y con sus [ ] llenos.

import { palabrasProhibidas } from "@/lib/ia/contenidoReglas";
import { extraerJson } from "@/lib/publicaciones/ficha";
import { bloqueDatosProducto, type DatosProducto } from "./datosProducto";
import { TEXTO_ORIGINAL_CONTENIDO } from "./textoContenidoZilonix";

export { TEXTO_ORIGINAL_CONTENIDO };

export const ESTILO_ZILONIX_CONTENIDO = { id: "zilonix_contenido", etiqueta: "Contenido Zilonix" } as const;

// Los 10 tipos del punto 5 del texto de Mateo, en su orden. `testimonios`
// queda APAGADO y bloqueado hasta que Mateo decida (ver mensaje del
// 19-nov: reseñas escritas por la IA = publicidad engañosa). Extra:
// `opiniones_reales` (opiniones verdaderas que pega el vendedor).
export const TIPOS_CONTENIDO_ZILONIX = [
  { id: "modo_uso", nombre: "Modo de uso", porDefecto: true },
  { id: "caracteristicas", nombre: "Características", porDefecto: true },
  { id: "beneficios", nombre: "Beneficios", porDefecto: true },
  { id: "ventajas", nombre: "Ventajas", porDefecto: true },
  { id: "que_incluye", nombre: "Qué incluye + ingredientes/componentes", porDefecto: true, requiere: "incluye" },
  { id: "como_funciona", nombre: "Qué hace / cómo funciona", porDefecto: true },
  { id: "tabla_comparacion", nombre: "Tabla de comparación", porDefecto: true },
  { id: "contexto_uso", nombre: "Contexto de uso", porDefecto: true },
  { id: "testimonios", nombre: "Testimonios", porDefecto: false, bloqueado: "Pendiente de la decisión de Mateo: no se generan reseñas escritas por la IA." },
  { id: "preguntas_frecuentes", nombre: "Preguntas frecuentes", porDefecto: true },
  { id: "opiniones_reales", nombre: "Opiniones reales (las pegas tú)", porDefecto: false, soloVendedor: true },
] as const satisfies readonly { id: string; nombre: string; porDefecto: boolean; requiere?: string; bloqueado?: string; soloVendedor?: boolean }[];

export type TipoContenidoZilonix = (typeof TIPOS_CONTENIDO_ZILONIX)[number]["id"];
export type ComposicionContenido = "izquierda" | "derecha" | "centro";
export type PropuestaContenido = { tipo: TipoContenidoZilonix; titulo: string; copy: string[]; composicion: ComposicionContenido };

export const CHECKLIST_CONTENIDO = ["Producto idéntico a la foto", "Sin palabras prohibidas", "Textos cortos", "Fondo limpio", "Tabla sin marcas", "Aprobado (CREAR)"] as const;

// Promesas que no puede tener el copy aunque no estén en la lista
// literal: resultados en el tiempo, garantías, 100 %.
const PROMESAS = [/\bgarantizad\w*/i, /\bresultados?\s+(garantizad|asegurad)\w*/i, /\b100\s*%\s*(efectiv|natural|segur)\w*/i, /\bdesde\s+el\s+primer\s+(d[ií]a|mes|uso)\b/i];

// La lista «Prohibido» del punto 4 del texto de Mateo, en código.
// Devuelve lo que encontró (vacío = el copy se puede crear).
export function revisarCopySeguro(textos: string[]): string[] {
  const encontradas = new Set(palabrasProhibidas(textos));
  for (const t of textos) for (const p of PROMESAS) if (p.test(t)) encontradas.add("promesa de resultados");
  return [...encontradas];
}

// La plantilla del punto 6, tal cual está en el texto de Mateo.
export function plantillaContenido(): string {
  const m = /6\) PLANTILLA[^\n]*\n"([^"]+)"/.exec(TEXTO_ORIGINAL_CONTENIDO);
  if (!m) throw new Error("No se encontró la plantilla del punto 6 en el texto de Mateo.");
  return m[1];
}

export function promptFinalContenido(p: PropuestaContenido, datos: DatosProducto): string {
  const plantilla = plantillaContenido().replace("[izquierda/derecha/centro]", p.composicion).replace("[bullets]", [p.titulo, ...p.copy].join(" · "));
  return [
    plantilla,
    "",
    "AJUSTES DE ZILONIX SELLER:",
    `- País de esta publicación: ${datos.nombrePais}. Idioma de todo el texto: ${datos.idioma}, con tildes y ortografía correctas.`,
    `- Escribe EXACTAMENTE estos textos y ningún otro: título «${p.titulo}»; ${p.copy.map((c) => `«${c}»`).join(", ")}.`,
    "- Este fondo con degradado es para imágenes secundarias, nunca para la foto principal.",
    datos.registroSanitario ? `- Registro sanitario confirmado: ${datos.registroSanitario}.` : "- No muestres ningún registro, sello ni certificación.",
  ].join("\n");
}

export function promptPropuestaContenidoZilonix(tipo: TipoContenidoZilonix, datos: DatosProducto, ajuste: string): string {
  const info = TIPOS_CONTENIDO_ZILONIX.find((t) => t.id === tipo);
  return [
    TEXTO_ORIGINAL_CONTENIDO,
    "",
    bloqueDatosProducto(datos),
    "",
    `Prepara SOLO la propuesta de la imagen «${info?.nombre}» (no crees la imagen).`,
    ajuste ? `El vendedor pidió AJUSTAR: «${ajuste.slice(0, 300)}».` : "",
    `Idioma: ${datos.idioma}. País: ${datos.nombrePais}.`,
    'Responde SOLO un JSON: {"titulo": "…", "copy": ["…", "…"], "composicion": "izquierda" | "derecha" | "centro"}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function leerPropuestaContenidoZilonix(tipo: TipoContenidoZilonix, respuesta: string): PropuestaContenido | null {
  const json = extraerJson(respuesta);
  if (!json) return null;
  const titulo = typeof json.titulo === "string" ? json.titulo.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const copy = (Array.isArray(json.copy) ? json.copy : [])
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.replace(/\s+/g, " ").replace(/^[-•*\s]+/, "").trim().slice(0, 110))
    .filter(Boolean)
    .slice(0, 6);
  const composicion: ComposicionContenido = json.composicion === "derecha" || json.composicion === "centro" ? json.composicion : "izquierda";
  return titulo ? { tipo, titulo, copy, composicion } : null;
}

// Qué tipos se pueden crear con esta ficha: `que_incluye` pide lo
// incluido confirmado; `testimonios` sigue bloqueado.
export function tipoContenidoDisponible(tipo: TipoContenidoZilonix, datos: DatosProducto): { ok: true } | { ok: false; motivo: string } {
  const info = TIPOS_CONTENIDO_ZILONIX.find((t) => t.id === tipo);
  if (!info) return { ok: false, motivo: "Tipo desconocido." };
  if ("bloqueado" in info) return { ok: false, motivo: info.bloqueado };
  if ("requiere" in info && info.requiere === "incluye" && !datos.incluye) return { ok: false, motivo: "Confirma qué incluye para crear esta imagen." };
  return { ok: true };
}
