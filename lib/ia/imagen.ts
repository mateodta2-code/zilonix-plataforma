// Optimización — crear una foto de la publicación con IA a partir de una
// foto REAL del producto (decisión de producto: nunca desde texto solo,
// para que el producto siga siendo el que se vende). Usa la conexión de
// IA de cada empresa (Configuración → IA): solo OpenAI y Google generan
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
export const LARGO_MAXIMO_INDICACIONES = 300;

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

// Portada: lo que pide Mercado Libre (fondo blanco, solo el producto,
// sin textos). Informativa: el mismo producto con textos cortos. En las
// dos se pide no cambiar el producto ni inventar sellos o promociones.
export function promptImagenIA(tipo: TipoImagenIA, titulo: string | null, indicaciones: string): string {
  const producto = titulo ? `El producto es: "${titulo.slice(0, 120)}".` : "";
  const fiel =
    "Usa EXACTAMENTE el mismo producto de la foto: misma forma, colores, materiales, marca y detalles. No lo cambies, no le agregues ni quites piezas.";
  if (tipo === "portada") {
    return [
      "Crea la foto de portada de una publicación de Mercado Libre a partir de esta foto.",
      producto,
      fiel,
      "El producto centrado, ocupando la mayor parte del cuadro, sobre fondo blanco puro (#FFFFFF), con luz de estudio y una sombra suave.",
      "Sin textos, sin logos agregados, sin marcas de agua, sin bordes, sin otros objetos. Formato cuadrado.",
      indicaciones ? `Indicaciones del vendedor: ${indicaciones}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    "Crea una imagen informativa para una publicación de Mercado Libre a partir de esta foto.",
    producto,
    fiel,
    "Agrega de 2 a 4 textos cortos en español, grandes y legibles, que destaquen características reales del producto, con un diseño limpio y profesional. Formato cuadrado.",
    "No inventes certificaciones, garantías, precios, descuentos ni promociones.",
    indicaciones ? `Destaca esto, según el vendedor: ${indicaciones}` : "Si no sabes una característica, destaca solo lo que se ve en la foto.",
  ]
    .filter(Boolean)
    .join(" ");
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

async function conOpenAI(apiKey: string, foto: { buffer: Buffer; tipo: TipoImagenDetectado }, prompt: string): Promise<Buffer> {
  const form = new FormData();
  form.append("model", MODELO_IMAGEN_OPENAI);
  form.append("image", new Blob([foto.buffer], { type: foto.tipo }), `base.${foto.tipo.split("/")[1]}`);
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

async function conGoogle(apiKey: string, foto: { buffer: Buffer; tipo: TipoImagenDetectado }, prompt: string): Promise<Buffer> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IMAGEN_GOOGLE}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: foto.tipo, data: foto.buffer.toString("base64") } }] }],
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
  if (status === 401 || status === 403) return `${proveedor} rechazó la clave de IA de la empresa (revisa Configuración → IA).`;
  if (status === 429) return `${proveedor} pidió esperar (límite o saldo de la cuenta de IA). Intenta más tarde.`;
  if (status === 400) return `${proveedor} no aceptó la foto o la instrucción. Prueba con otra foto.`;
  return `${proveedor} respondió con un error (${status}). Intenta de nuevo.`;
}

// Devuelve la imagen generada, ya verificada como JPG/PNG/WEBP real.
export async function generarImagenDesdeFoto(
  conexion: ConexionIAConClave,
  foto: { buffer: Buffer; tipo: TipoImagenDetectado },
  prompt: string
): Promise<{ buffer: Buffer; tipo: TipoImagenDetectado }> {
  if (!proveedorGeneraImagenes(conexion.proveedor)) {
    throw new ErrorImagenIA("La IA conectada no genera imágenes. Conecta OpenAI o Google en Configuración → IA.");
  }
  const buffer = conexion.proveedor === "openai" ? await conOpenAI(conexion.apiKey, foto, prompt) : await conGoogle(conexion.apiKey, foto, prompt);
  const tipo = tipoImagenPorMagicBytes(buffer);
  if (!tipo || buffer.byteLength > TOPE_BYTES) throw new ErrorImagenIA("La IA devolvió algo que no es una imagen válida.");
  return { buffer, tipo };
}
