import { exigirUrlBaseIASegura } from "./validarUrlBase";
import type { ConexionIAConClave } from "./tipos";

// Rama feat-promociones, punto 6 — un dispatcher por proveedor, cada
// uno contra el contrato PÚBLICO y documentado de esa API (nunca
// adivinado — distinto de Mercado Libre, donde CLAUDE.md exige
// evidencia real de producción: estos 4 contratos son documentación
// pública y estable de cada proveedor). Mismo "fetch directo, sin
// SDK" que ya usa lib/anthropic.ts, para no agregar 4 dependencias
// nuevas solo para esto.
export class ErrorProveedorIA extends Error {}

const TIMEOUT_MS = 30_000;

async function llamarAnthropic(conexion: ConexionIAConClave, prompt: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": conexion.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: conexion.modelo, max_tokens: maxTokens, thinking: { type: "disabled" }, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new ErrorProveedorIA("No se pudo conectar con Anthropic a tiempo.");
  });
  if (!res.ok) throw new ErrorProveedorIA(`Anthropic respondió con error (${res.status}).`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  return (data.content ?? []).map((c) => c.text || "").join("\n").trim();
}

// OpenAI, xAI (Grok) y cualquier "otro compatible con OpenAI" hablan
// el MISMO formato de Chat Completions — un solo helper para los 3.
// `redirectManual` solo lo pide otro_compatible_openai (ver llamarIA):
// openai/xai son hosts fijos y de confianza, sin riesgo de SSRF por
// redirect; una baseUrl configurada por la empresa sí lo tiene.
async function llamarCompatibleOpenAI(
  baseUrl: string,
  conexion: ConexionIAConClave,
  prompt: string,
  maxTokens: number,
  opciones: { redirectManual?: boolean } = {}
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${conexion.apiKey}` },
    body: JSON.stringify({ model: conexion.modelo, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(opciones.redirectManual ? { redirect: "manual" as const } : {}),
  }).catch(() => {
    throw new ErrorProveedorIA("No se pudo conectar con el proveedor de IA a tiempo.");
  });
  // Re-review de Pablo — HIGH: SSRF por redirect. exigirUrlBaseIASegura
  // valida el host de la baseUrl guardada, pero un `fetch` con
  // redirect:"follow" (el default) seguiría a ciegas un 3xx hacia
  // CUALQUIER otro host — incluida una IP privada o de metadata — sin
  // volver a pasar por esa validación. Con redirect:"manual" nunca se
  // sigue solo: en Node/undici un redirect real llega como un 3xx
  // normal con Location (o como "opaqueredirect" según el runtime,
  // mismo criterio que lib/ml/video-externo.ts) — cualquiera de los
  // dos se trata como error, JAMÁS como un segundo fetch.
  if (opciones.redirectManual && (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400))) {
    throw new ErrorProveedorIA("El proveedor de IA respondió con un redirect — no se sigue.");
  }
  if (!res.ok) throw new ErrorProveedorIA(`El proveedor de IA respondió con error (${res.status}).`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function llamarGoogle(conexion: ConexionIAConClave, prompt: string, maxTokens: number): Promise<string> {
  // La llave va en la cabecera x-goog-api-key (contrato público de la API
  // de Gemini), nunca en la URL: una URL con ?key= puede quedar en logs de
  // proxies o del proveedor. Mismo criterio que lib/ia/imagen.ts.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(conexion.modelo)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": conexion.apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new ErrorProveedorIA("No se pudo conectar con Google a tiempo.");
  });
  if (!res.ok) throw new ErrorProveedorIA(`Google respondió con error (${res.status}).`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text || "").join("\n").trim();
}

export async function llamarIA(conexion: ConexionIAConClave, prompt: string, opciones: { maxTokens?: number } = {}): Promise<string> {
  const maxTokens = opciones.maxTokens ?? 1024;
  switch (conexion.proveedor) {
    case "anthropic":
      return llamarAnthropic(conexion, prompt, maxTokens);
    case "openai":
      return llamarCompatibleOpenAI("https://api.openai.com/v1", conexion, prompt, maxTokens);
    case "xai":
      return llamarCompatibleOpenAI("https://api.x.ai/v1", conexion, prompt, maxTokens);
    case "otro_compatible_openai": {
      if (!conexion.baseUrl) throw new ErrorProveedorIA("Falta la URL base del proveedor de IA compatible con OpenAI.");
      // Code review de Pablo — HIGH 3: la URL base ya se validó al
      // guardar (app/api/configuracion/ia-conexion/route.ts), pero una
      // conexión se guarda una vez y se usa muchas veces después — el
      // DNS de ese hostname puede cambiar entre medio (DNS rebinding).
      // Se revalida OTRA VEZ, acá, justo antes del fetch real — nunca
      // se confía en que "ya se validó alguna vez".
      let urlSegura: URL;
      try {
        urlSegura = await exigirUrlBaseIASegura(conexion.baseUrl);
      } catch {
        throw new ErrorProveedorIA("Esa URL base no se puede usar — no es https o no resuelve a una dirección pública.");
      }
      // Re-review de Pablo — HIGH: se arma la URL final con la URL YA
      // PARSEADA y validada (origin + pathname), nunca con el string
      // crudo que guardó la empresa — evita un "//" duplicado
      // (ej. "https://x.test//chat/completions") y cualquier
      // diferencia entre lo que se validó y lo que de verdad se llama.
      const baseNormalizada = (urlSegura.origin + urlSegura.pathname).replace(/\/$/, "");
      return llamarCompatibleOpenAI(baseNormalizada, conexion, prompt, maxTokens, { redirectManual: true });
    }
    case "google":
      return llamarGoogle(conexion, prompt, maxTokens);
  }
}

// Rama feat-investigacion-buscar-por-foto — visión: misma conexión de IA
// de cada empresa (nunca la llave de la plataforma), mismo fetch directo
// sin SDK y la misma protección SSRF que llamarIA. Función APARTE a
// propósito: llamarIA (solo texto) no cambia.
export type ImagenIA = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

// La IA conectada rechazó la imagen (modelo sin visión o formato no
// aceptado). Clase propia para que la ruta responda el mensaje exacto
// «no lee imágenes» sin confundirlo con una caída del proveedor.
export class ErrorIASinVision extends ErrorProveedorIA {}

// Cada proveedor contesta 400/415/422 cuando el modelo no acepta imágenes
// (contrato público de cada API); 401/403/429/5xx son otra cosa y siguen
// siendo un ErrorProveedorIA normal.
const ESTADOS_SIN_VISION = [400, 415, 422];

function errorPorEstado(res: Response, nombre: string): ErrorProveedorIA {
  if (ESTADOS_SIN_VISION.includes(res.status)) return new ErrorIASinVision(`${nombre} no aceptó la imagen (${res.status}).`);
  return new ErrorProveedorIA(`${nombre} respondió con error (${res.status}).`);
}

async function llamarAnthropicConImagenes(conexion: ConexionIAConClave, prompt: string, imagenes: ImagenIA[], maxTokens: number): Promise<string> {
  const content = [
    ...imagenes.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.base64 } })),
    { type: "text", text: prompt },
  ];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": conexion.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: conexion.modelo, max_tokens: maxTokens, thinking: { type: "disabled" }, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new ErrorProveedorIA("No se pudo conectar con Anthropic a tiempo.");
  });
  if (!res.ok) throw errorPorEstado(res, "Anthropic");
  const data = (await res.json()) as { content?: { text?: string }[] };
  return (data.content ?? []).map((c) => c.text || "").join("\n").trim();
}

async function llamarCompatibleOpenAIConImagenes(
  baseUrl: string,
  conexion: ConexionIAConClave,
  prompt: string,
  imagenes: ImagenIA[],
  maxTokens: number,
  opciones: { redirectManual?: boolean } = {}
): Promise<string> {
  const content = [
    { type: "text", text: prompt },
    ...imagenes.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.base64}` } })),
  ];
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${conexion.apiKey}` },
    body: JSON.stringify({ model: conexion.modelo, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(opciones.redirectManual ? { redirect: "manual" as const } : {}),
  }).catch(() => {
    throw new ErrorProveedorIA("No se pudo conectar con el proveedor de IA a tiempo.");
  });
  // Mismo criterio SSRF que llamarCompatibleOpenAI: un redirect nunca se sigue.
  if (opciones.redirectManual && (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400))) {
    throw new ErrorProveedorIA("El proveedor de IA respondió con un redirect — no se sigue.");
  }
  if (!res.ok) throw errorPorEstado(res, "El proveedor de IA");
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function llamarGoogleConImagenes(conexion: ConexionIAConClave, prompt: string, imagenes: ImagenIA[], maxTokens: number): Promise<string> {
  // La llave va en la cabecera x-goog-api-key (contrato público de la API
  // de Gemini), nunca en la URL: una URL con ?key= puede quedar en logs de
  // proxies o del proveedor. Mismo criterio que lib/ia/imagen.ts.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(conexion.modelo)}:generateContent`;
  const parts = [{ text: prompt }, ...imagenes.map((i) => ({ inline_data: { mime_type: i.mediaType, data: i.base64 } }))];
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": conexion.apiKey },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new ErrorProveedorIA("No se pudo conectar con Google a tiempo.");
  });
  if (!res.ok) throw errorPorEstado(res, "Google");
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text || "").join("\n").trim();
}

export async function llamarIAConImagenes(
  conexion: ConexionIAConClave,
  prompt: string,
  imagenes: ImagenIA[],
  opciones: { maxTokens?: number } = {}
): Promise<string> {
  const maxTokens = opciones.maxTokens ?? 1024;
  switch (conexion.proveedor) {
    case "anthropic":
      return llamarAnthropicConImagenes(conexion, prompt, imagenes, maxTokens);
    case "openai":
      return llamarCompatibleOpenAIConImagenes("https://api.openai.com/v1", conexion, prompt, imagenes, maxTokens);
    case "xai":
      return llamarCompatibleOpenAIConImagenes("https://api.x.ai/v1", conexion, prompt, imagenes, maxTokens);
    case "otro_compatible_openai": {
      if (!conexion.baseUrl) throw new ErrorProveedorIA("Falta la URL base del proveedor de IA compatible con OpenAI.");
      // Misma revalidación justo antes del fetch que llamarIA (DNS rebinding).
      let urlSegura: URL;
      try {
        urlSegura = await exigirUrlBaseIASegura(conexion.baseUrl);
      } catch {
        throw new ErrorProveedorIA("Esa URL base no se puede usar — no es https o no resuelve a una dirección pública.");
      }
      const baseNormalizada = (urlSegura.origin + urlSegura.pathname).replace(/\/$/, "");
      return llamarCompatibleOpenAIConImagenes(baseNormalizada, conexion, prompt, imagenes, maxTokens, { redirectManual: true });
    }
    case "google":
      return llamarGoogleConImagenes(conexion, prompt, imagenes, maxTokens);
  }
}
