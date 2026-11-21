import { obtenerConexionIAConClavePorId } from "./conexion";
import type { ProveedorIA } from "./tipos";

// SOLO servidor. Lista los modelos de texto que tiene una cuenta, para que
// la persona no tenga que escribir el nombre del modelo. fetch directo (sin
// SDK). La clave va solo en cabeceras (nunca en la URL: una URL con ?key=
// queda en logs) y nunca en un error ni en console.*.

export const ERRORES_MODELOS_IA = {
  clave: "La API key no es válida. Revisa que la copiaste completa.",
  saldo: "La cuenta no tiene saldo o no tiene acceso a la API. Revisa el saldo (Billing) en la página del proveedor.",
  vacia: "Esta cuenta no tiene modelos de texto disponibles.",
  red: "No se pudo consultar la lista de modelos. Intenta de nuevo o escribe el modelo.",
  manual: "Este proveedor se configura escribiendo el modelo.",
} as const;
export type ClaveError = keyof typeof ERRORES_MODELOS_IA;

export type ResultadoModelos = { ok: true; modelos: string[] } | { ok: false; error: ClaveError };

type ProveedorConLista = Exclude<ProveedorIA, "otro_compatible_openai">;

// Revisado 21/11/2026. Se usa el primero que exista en la cuenta; si
// ninguno existe, el primero de la lista filtrada.
export const MODELOS_RECOMENDADOS: Record<ProveedorConLista, string[]> = {
  openai: ["gpt-6.2-sol", "gpt-6-luna", "gpt-6.1-terra", "gpt-5-mini"],
  anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-sonnet-5"],
  google: ["gemini-3.8-flash", "gemini-4-hydrogen", "gemini-3.5-flash-lite"],
  xai: ["grok-4.7", "latest"],
};

const EXCLUIR_OPENAI_XAI = [
  "embedding", "whisper", "tts", "audio", "moderation", "transcribe", "realtime",
  "dall-e", "gpt-image", "image", "search", "computer-use", "davinci", "babbage",
];
const EXCLUIR_GOOGLE = ["embedding", "tts", "image", "live"];
const MAX_PAGINAS = 3;

export function elegirRecomendado(proveedor: ProveedorIA, modelos: string[]): string {
  const prefs = proveedor === "otro_compatible_openai" ? [] : MODELOS_RECOMENDADOS[proveedor];
  return prefs.find((m) => modelos.includes(m)) ?? modelos[0] ?? "";
}

function ordenar(proveedor: ProveedorConLista, ids: string[]): string[] {
  const unicos = Array.from(new Set(ids));
  const prefs = MODELOS_RECOMENDADOS[proveedor].filter((m) => unicos.includes(m));
  const resto = unicos.filter((m) => !prefs.includes(m)).sort((a, b) => a.localeCompare(b));
  return [...prefs, ...resto];
}

type Pagina = { ids: string[]; siguiente: string | null };
type Json = Record<string, unknown>;

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function paginaOpenAiXai(json: Json): Pagina {
  const data = Array.isArray(json.data) ? (json.data as Json[]) : [];
  const ids = data.map((d) => texto(d.id)).filter((id) => id && !EXCLUIR_OPENAI_XAI.some((x) => id.toLowerCase().includes(x)));
  return { ids, siguiente: null };
}

function paginaAnthropic(json: Json): Pagina {
  const data = Array.isArray(json.data) ? (json.data as Json[]) : [];
  return { ids: data.map((d) => texto(d.id)).filter(Boolean), siguiente: json.has_more === true ? texto(json.last_id) || null : null };
}

function paginaGoogle(json: Json): Pagina {
  const modelos = Array.isArray(json.models) ? (json.models as Json[]) : [];
  const ids = modelos
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && (m.supportedGenerationMethods as unknown[]).includes("generateContent"))
    .map((m) => texto(m.name).replace(/^models\//, ""))
    .filter((id) => id && !EXCLUIR_GOOGLE.some((x) => id.toLowerCase().includes(x)));
  return { ids, siguiente: texto(json.nextPageToken) || null };
}

function peticion(proveedor: ProveedorConLista, apiKey: string, cursor: string | null): { url: string; headers: Record<string, string> } {
  if (proveedor === "anthropic") {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("after_id", cursor);
    return { url: url.toString(), headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } };
  }
  if (proveedor === "google") {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (cursor) url.searchParams.set("pageToken", cursor);
    return { url: url.toString(), headers: { "x-goog-api-key": apiKey } };
  }
  const base = proveedor === "xai" ? "https://api.x.ai/v1/models" : "https://api.openai.com/v1/models";
  return { url: base, headers: { Authorization: `Bearer ${apiKey}` } };
}

export async function listarModelosProveedor(proveedor: ProveedorIA, apiKey: string): Promise<ResultadoModelos> {
  if (proveedor === "otro_compatible_openai") return { ok: false, error: "manual" };
  const leer = proveedor === "anthropic" ? paginaAnthropic : proveedor === "google" ? paginaGoogle : paginaOpenAiXai;
  const ids: string[] = [];
  let cursor: string | null = null;
  try {
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const { url, headers } = peticion(proveedor, apiKey, cursor);
      const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
      if (res.status === 401) return { ok: false, error: "clave" };
      if (res.status === 402 || res.status === 403 || res.status === 429) return { ok: false, error: "saldo" };
      if (!res.ok) return { ok: false, error: "red" };
      const pagina = leer((await res.json()) as Json);
      ids.push(...pagina.ids);
      cursor = pagina.siguiente;
      if (!cursor) break;
    }
  } catch {
    // Timeout, red o JSON roto: mensaje fijo, sin detalle del proveedor.
    return { ok: false, error: "red" };
  }
  const modelos = ordenar(proveedor, ids);
  return modelos.length === 0 ? { ok: false, error: "vacia" } : { ok: true, modelos };
}

// Lista los modelos usando la clave GUARDADA de una conexión de la empresa.
// La lectura de la clave vive aquí (como en probarConexionIA): quien llama
// recibe solo el proveedor guardado y el resultado, nunca la clave.
// null = la conexión no existe en esa empresa.
export async function listarModelosDeConexion(
  empresaId: string,
  conexionId: string,
): Promise<{ proveedor: ProveedorIA; resultado: ResultadoModelos } | null> {
  const guardada = await obtenerConexionIAConClavePorId(empresaId, conexionId);
  if (!guardada) return null;
  return { proveedor: guardada.proveedor, resultado: await listarModelosProveedor(guardada.proveedor, guardada.apiKey) };
}
