// Optimización — la IA de TEXTO de la empresa propone el contenido de una
// imagen informativa (título, copy, composición) a partir de la ficha
// técnica y la descripción de la publicación. Es solo una propuesta: la
// persona la revisa y la aprueba con «CREAR» (lib/ia/contenidoReglas.ts).
// La respuesta de la IA nunca se confía: se busca el JSON, se limpia y
// se recorta con las mismas reglas que lo que escribe la persona.
import { llamarIA } from "./proveedores";
import {
  COMPOSICIONES,
  LARGO_BULLET,
  LARGO_TITULO,
  limpiarContenido,
  tipoContenido,
  type ContenidoImagen,
  type TipoContenido,
} from "./contenidoReglas";
import type { ConexionIAConClave } from "./tipos";

export const LARGO_MAXIMO_DESCRIPCION_PROMPT = 2_000;

export function promptPropuestaContenido(tipo: TipoContenido, tituloProducto: string | null, ficha: string, descripcion: string | null): string {
  const t = tipoContenido(tipo);
  return [
    "Eres fotógrafo profesional de e-commerce y diseñador de infografías para Mercado Libre Colombia.",
    `Propón el contenido de UNA imagen informativa del tipo «${t?.nombre}»: ${t?.guia}`,
    "",
    "Fuente principal (la ficha técnica del vendedor). Si no dice algo, no lo inventes:",
    `"""${ficha || "(sin ficha: usa solo el título y la descripción)"}"""`,
    tituloProducto ? `Título de la publicación: "${tituloProducto.slice(0, 160)}"` : "",
    descripcion ? `Descripción de la publicación (complemento, no contradice la ficha):\n"""${descripcion.slice(0, LARGO_MAXIMO_DESCRIPCION_PROMPT)}"""` : "",
    "",
    "Reglas obligatorias:",
    "- No inventes ingredientes, usos, componentes, certificaciones, sellos, registros ni accesorios.",
    "- Lenguaje neutro e informativo. Permitido: «diseñado para el uso diario», «apoya una rutina de cuidado», «contribuye al bienestar general», «sensación de frescura», «fórmula con…», «ideal para…».",
    "- Prohibido: curar, tratar, prevenir, alivio, enfermedades, diagnóstico, clínicamente probado, médicos, expertos, garantizado, 100 % efectivo, elimina, combate, rejuvenece, anti-envejecimiento, regenera, desinflama, sana, antes/después, promesas de resultados o de tiempo.",
    "- Sin marcas de terceros. Textos cortos, legibles en celular.",
    `- Título de máximo ${LARGO_TITULO} caracteres; cada línea de máximo ${LARGO_BULLET} caracteres; entre ${t?.min} y ${t?.max} líneas.`,
    "",
    `Responde SOLO un JSON, sin nada más: {"titulo": "...", "bullets": ["...", "..."], "composicion": "${COMPOSICIONES.join('" | "')}"}`,
  ]
    .filter((linea) => linea !== null)
    .join("\n");
}

// Saca el primer objeto JSON de la respuesta (algunas IA lo envuelven en
// ```json o le agregan una frase). null si no hay nada usable.
export function leerPropuestaContenido(tipo: TipoContenido, respuesta: string): ContenidoImagen | null {
  const inicio = respuesta.indexOf("{");
  const fin = respuesta.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return null;
  let crudo: unknown;
  try {
    crudo = JSON.parse(respuesta.slice(inicio, fin + 1));
  } catch {
    return null;
  }
  const contenido = limpiarContenido({ ...(crudo as Record<string, unknown>), tipo });
  return contenido && (contenido.titulo || contenido.bullets.length > 0) ? contenido : null;
}

export async function proponerContenido(
  conexion: ConexionIAConClave,
  tipo: TipoContenido,
  tituloProducto: string | null,
  ficha: string,
  descripcion: string | null
): Promise<ContenidoImagen | null> {
  const respuesta = await llamarIA(conexion, promptPropuestaContenido(tipo, tituloProducto, ficha, descripcion), { maxTokens: 800 });
  return leerPropuestaContenido(tipo, respuesta);
}
