// Optimización — crear una foto de la publicación con IA a partir de
// fotos REALES del producto (decisión de producto: nunca desde texto solo,
// para que el producto siga siendo el que se vende). Usa la conexión de
// IA de cada empresa (Administración → Conectar IA): solo OpenAI y Google generan
// imágenes; Anthropic y los compatibles con OpenAI no.
//
// Contratos públicos de cada proveedor (mismo criterio que
// lib/ia/proveedores.ts: fetch directo, sin SDK):
// - OpenAI: POST /v1/images/edits, multipart (model, image, prompt,
//   size, quality). Los modelos gpt-image devuelven siempre base64 en
//   data[0].b64_json.
// - Google: POST /v1beta/models/{modelo}:generateContent con la foto en
//   parts[].inline_data; la imagen vuelve en candidates[0].content.parts
//   como inlineData (o inline_data).
// El modelo de imagen es fijo (el de la conexión es de texto).
import { tipoImagenPorMagicBytes, type TipoImagenDetectado } from "@/app/panel/publicar/fotos/validar-url-externa";
import type { ConexionIAConClave, ProveedorIA } from "./tipos";

export const MODELO_IMAGEN_OPENAI = "gpt-image-1";
export const MODELO_IMAGEN_GOOGLE = "gemini-2.5-flash-image";

// Una imagen tarda bastante más que un texto.
const TIMEOUT_GENERAR_MS = 120_000;
const TIMEOUT_DESCARGA_MS = 15_000;
const TOPE_BYTES = 10 * 1024 * 1024;
// Ficha técnica / información del producto que escribe el vendedor.
export const LARGO_MAXIMO_INDICACIONES = 1_500;
// Fotos reales que se mandan como referencia (la elegida + otras de la
// galería, para que la IA vea detalles y lo que incluye sin inventar).
export const MAXIMO_FOTOS_REFERENCIA = 3;

export type TipoImagenIA = "portada" | "informativa";

export class ErrorImagenIA extends Error {}

export function proveedorGeneraImagenes(proveedor: ProveedorIA): boolean {
  return proveedor === "openai" || proveedor === "google";
}

export function leerTipoImagenIA(valor: unknown): TipoImagenIA {
  return valor === "informativa" ? "informativa" : "portada";
}

export function limpiarIndicaciones(valor: unknown): string {
  return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim().slice(0, LARGO_MAXIMO_INDICACIONES) : "";
}

// Portada de venta (prompt maestro de Melissa / Zilonix, 2026-10-24):
// el producto protagonista sobre fondo blanco y, alrededor, la escena de
// uso, detalles reales y lo que incluye, sin ningún texto. Cada variante
// cambia ángulo, composición y escena para que las portadas no se
// repitan. La informativa no sale de acá: usa el contenido aprobado
// (lib/ia/contenidoReglas.ts, promptImagenContenido).
export const COMPOSICIONES_PORTADA = [
  // La distribución de referencia que mandó el equipo (esquema, no diseño final).
  "Producto en vista frontal tres cuartos, grande, ocupando el centro y la izquierda del cuadro; un círculo grande con la escena de uso arriba a la derecha, parcialmente detrás del producto; un círculo pequeño con un detalle funcional real a la derecha, a media altura bajo la escena; lo que incluye (o, si no trae nada, otra característica real) ordenado en una franja horizontal en la parte inferior.",
  "Producto girado levemente hacia la izquierda en primer plano; detrás, la escena de uso real desenfocada que se funde suavemente con el fondo blanco por la derecha.",
  "Producto visto desde arriba en ángulo de 45 grados; en un círculo a la izquierda, unas manos usándolo en una situación cotidiana; un detalle de material o textura en una ventana pequeña.",
  "Producto a la derecha, grande y nítido; a la izquierda, una persona usándolo en su entorno real, con una transición de luz suave hacia el blanco.",
  "Producto centrado; dos círculos de detalle a los lados (uno de materiales o texturas, otro de un mecanismo, conexión o función real); lo que incluye en fila debajo.",
  "Producto de perfil o en vista lateral que muestre su forma y grosor; en una ventana superior, el resultado visible de usarlo (lo que logra), sin textos ni cifras.",
  "Producto en contrapicado leve, con presencia heroica; la escena de uso amplia aparece arriba y se desvanece hacia el fondo blanco.",
  "Producto completo en primer plano con una mano interactuando con él de forma natural; un acercamiento de su parte funcional más importante en un círculo lateral.",
  "Composición en diagonal: producto cruzando el cuadro; escena de uso en la esquina superior izquierda; lo que incluye ordenado en la esquina inferior derecha.",
  "Producto principal en tres cuartos y, más pequeña al costado, una vista complementaria (posterior o de otro ángulo); la escena de uso en un círculo pequeño arriba.",
] as const;

export const MAXIMO_VARIANTES_PORTADA = COMPOSICIONES_PORTADA.length;

export function leerVariante(valor: unknown): number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 ? valor % MAXIMO_VARIANTES_PORTADA : 0;
}

export function promptImagenIA(tipo: TipoImagenIA, titulo: string | null, indicaciones: string, variante = 0): string {
  const producto = titulo ? `El producto es: "${titulo.slice(0, 120)}".` : "";
  const fiel =
    "Usa EXACTAMENTE el mismo producto de las fotos de referencia: misma forma, proporciones, colores, materiales, marca, componentes y detalles. No lo cambies, no le agregues ni quites piezas, no inventes funciones.";
  if (tipo === "portada") {
    return [
      "Actúa como diseñador gráfico publicitario profesional especializado en fotografía comercial hiperrealista y portadas de productos para Mercado Libre.",
      "Crea UNA portada de venta (no infografía, no ficha técnica, no imagen de beneficios) a partir de las fotos reales del producto, que son referencia obligatoria.",
      producto,
      indicaciones ? `Información del producto según el vendedor (qué es, para qué sirve, qué incluye): ${indicaciones}` : "",
      fiel,
      "El comprador debe entender en menos de un segundo qué es, para qué sirve y cómo se usa, solo mirando la imagen.",
      "PRODUCTO: protagonista absoluto, en primer plano, completo, grande y nítido, entre el 50 % y el 65 % del cuadro, en perspectiva fotográfica tridimensional, con iluminación comercial, sombras suaves y reflejos naturales.",
      "USO: integra una escena secundaria real y cotidiana donde se usa el producto (persona, manos o entorno relacionado con su función), detrás, a un costado o en un círculo integrado, con desenfoque suave para que nunca compita con el producto. No basta el producto solo sobre fondo vacío.",
      "DETALLES: algunos acercamientos de detalles REALES (materiales, texturas, conexiones o mecanismos) en círculos o ventanas integradas; solo los que ayuden a entender el producto.",
      "INCLUYE: si el producto trae accesorios o piezas (según las fotos o el vendedor), muéstralos ordenados en una zona secundaria con sus proporciones y colores reales, separados para identificarlos; no agregues nada que no esté incluido. Si no trae, usa ese espacio para otro detalle funcional real.",
      `COMPOSICIÓN DE ESTA PORTADA: ${COMPOSICIONES_PORTADA[leerVariante(variante)]}`,
      "FONDO: blanco puro #FFFFFF o predominantemente blanco. Nunca negro, oscuro, degradado, de color ni de paisaje.",
      "Todo integrado en un mismo diseño moderno, limpio y premium: no debe parecer un collage de fotos sueltas. Fotografía comercial hiperrealista de alta gama, colores fieles, sin aspecto de ilustración, caricatura ni render 3D artificial.",
      "PROHIBIDO: textos, títulos, frases, beneficios escritos, llamados a la acción, etiquetas, logos inventados, marcas de agua, precios, sellos y promesas o afirmaciones de salud. La imagen comunica sola.",
      "Formato cuadrado 1:1, una sola imagen final.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  // La informativa se arma con el contenido aprobado
  // (promptImagenContenido, lib/ia/contenidoReglas.ts).
  throw new ErrorImagenIA("La imagen informativa necesita su contenido aprobado.");
}

// Solo fotos que ya son de la publicación (Mercado Libre) o que la
// galería subió a Cloudinary. https, sin seguir redirects, con tope de
// tamaño y firma binaria real.
export function esUrlFotoBasePermitida(urlCruda: string): boolean {
  try {
    const url = new URL(urlCruda);
    if (url.protocol !== "https:") return false;
    return url.hostname === "mlstatic.com" || url.hostname.endsWith(".mlstatic.com") || url.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

export async function descargarFotoBase(url: string): Promise<{ buffer: Buffer; tipo: TipoImagenDetectado }> {
  if (!esUrlFotoBasePermitida(url)) throw new ErrorImagenIA("Esa foto no se puede usar como base.");
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_DESCARGA_MS) }).catch(() => {
    throw new ErrorImagenIA("No se pudo descargar la foto base.");
  });
  if (!res.ok) throw new ErrorImagenIA("No se pudo descargar la foto base.");
  const largo = Number(res.headers.get("content-length") ?? "0");
  if (largo > TOPE_BYTES) throw new ErrorImagenIA("La foto base es demasiado grande.");
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > TOPE_BYTES) throw new ErrorImagenIA("La foto base es demasiado grande.");
  const tipo = tipoImagenPorMagicBytes(buffer);
  if (!tipo) throw new ErrorImagenIA("La foto base no es una imagen JPG, PNG o WEBP.");
  return { buffer, tipo };
}

export type FotoBase = { buffer: Buffer; tipo: TipoImagenDetectado };

// Con más de una foto, gpt-image-1 las recibe como image[] (hasta 16).
async function conOpenAI(apiKey: string, fotos: FotoBase[], prompt: string): Promise<Buffer> {
  const form = new FormData();
  form.append("model", MODELO_IMAGEN_OPENAI);
  for (const [i, foto] of fotos.entries()) {
    form.append(fotos.length > 1 ? "image[]" : "image", new Blob([foto.buffer], { type: foto.tipo }), `base${i + 1}.${foto.tipo.split("/")[1]}`);
  }
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("quality", "medium");
  form.append("n", "1");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_GENERAR_MS),
  }).catch(() => {
    throw new ErrorImagenIA("OpenAI no respondió a tiempo.");
  });
  if (!res.ok) throw new ErrorImagenIA(mensajeHttp("OpenAI", res.status));
  const data = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null;
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new ErrorImagenIA("OpenAI no devolvió una imagen.");
  return Buffer.from(b64, "base64");
}

async function conGoogle(apiKey: string, fotos: FotoBase[], prompt: string): Promise<Buffer> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IMAGEN_GOOGLE}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...fotos.map((foto) => ({ inline_data: { mime_type: foto.tipo, data: foto.buffer.toString("base64") } }))] }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_GENERAR_MS),
  }).catch(() => {
    throw new ErrorImagenIA("Google no respondió a tiempo.");
  });
  if (!res.ok) throw new ErrorImagenIA(mensajeHttp("Google", res.status));
  type Parte = { inlineData?: { data?: string }; inline_data?: { data?: string } };
  const data = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: Parte[] } }[] } | null;
  const parte = (data?.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data || p.inline_data?.data);
  const b64 = parte?.inlineData?.data ?? parte?.inline_data?.data;
  if (!b64) throw new ErrorImagenIA("Google no devolvió una imagen (puede que la haya bloqueado por sus reglas de contenido).");
  return Buffer.from(b64, "base64");
}

function mensajeHttp(proveedor: string, status: number): string {
  if (status === 401 || status === 403) return `${proveedor} rechazó la clave de IA de la empresa (revisa Administración → Conectar IA).`;
  if (status === 429) return `${proveedor} pidió esperar (límite o saldo de la cuenta de IA). Intenta más tarde.`;
  if (status === 400) return `${proveedor} no aceptó la foto o la instrucción. Prueba con otra foto.`;
  return `${proveedor} respondió con un error (${status}). Intenta de nuevo.`;
}

// Devuelve la imagen generada, ya verificada como JPG/PNG/WEBP real.
// La primera foto es la base; las demás, referencias del mismo producto.
export async function generarImagenDesdeFoto(conexion: ConexionIAConClave, fotos: FotoBase[], prompt: string): Promise<FotoBase> {
  if (fotos.length === 0) throw new ErrorImagenIA("Falta la foto base.");
  if (!proveedorGeneraImagenes(conexion.proveedor)) {
    throw new ErrorImagenIA("La IA conectada no genera imágenes. Conecta OpenAI o Google en Administración → Conectar IA.");
  }
  const buffer = conexion.proveedor === "openai" ? await conOpenAI(conexion.apiKey, fotos.slice(0, MAXIMO_FOTOS_REFERENCIA), prompt) : await conGoogle(conexion.apiKey, fotos.slice(0, MAXIMO_FOTOS_REFERENCIA), prompt);
  const tipo = tipoImagenPorMagicBytes(buffer);
  if (!tipo || buffer.byteLength > TOPE_BYTES) throw new ErrorImagenIA("La IA devolvió algo que no es una imagen válida.");
  return { buffer, tipo };
}
