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
async function llamarCompatibleOpenAI(baseUrl: string, conexion: ConexionIAConClave, prompt: string, maxTokens: number): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${conexion.apiKey}` },
    body: JSON.stringify({ model: conexion.modelo, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new ErrorProveedorIA("No se pudo conectar con el proveedor de IA a tiempo.");
  });
  if (!res.ok) throw new ErrorProveedorIA(`El proveedor de IA respondió con error (${res.status}).`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function llamarGoogle(conexion: ConexionIAConClave, prompt: string, maxTokens: number): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(conexion.modelo)}:generateContent?key=${encodeURIComponent(conexion.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    case "otro_compatible_openai":
      if (!conexion.baseUrl) throw new ErrorProveedorIA("Falta la URL base del proveedor de IA compatible con OpenAI.");
      return llamarCompatibleOpenAI(conexion.baseUrl.replace(/\/$/, ""), conexion, prompt, maxTokens);
    case "google":
      return llamarGoogle(conexion, prompt, maxTokens);
  }
}
