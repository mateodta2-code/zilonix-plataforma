// Issue #225 — primer cliente de Anthropic en esta plataforma. Zilonix
// OS (zilonix-os-web, lib/anthropic.js) ya lo tiene desde antes — mismo
// modelo, mismo fetch directo sin librería, portado tal cual (nunca
// adivinado). Server SOLO: usa ANTHROPIC_API_KEY (Railway), nunca se
// importa desde un Client Component ni se expone al navegador.
//
// Secreto real necesario en Railway, documentado en el PR (nunca
// inventado ni pegado en texto): ANTHROPIC_API_KEY. Si esta plataforma
// ya tiene otra variable con la llave de Claude para otro uso, usar
// ESA — revisar las variables reales de Railway antes de pedir una
// nueva.
const MODEL = "claude-sonnet-5";

export async function askClaude(prompt: string, { maxTokens = 1024 }: { maxTokens?: number } = {}): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY — todavía no se conectó la llave de Claude en esta plataforma (ver PR del issue #225).");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      // Issue #225 — mismo bug real ya encontrado en producción en
      // zilonix-os-web (lib/anthropic.js): sin esto, el modelo puede
      // gastar TODO el presupuesto de tokens "pensando" por dentro y
      // no dejar nada para la respuesta visible (les pasó de verdad:
      // 700/700 tokens en "thinking", texto vacío).
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`Claude respondió con error (${res.status}): ${texto.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: { text?: string }[]; stop_reason?: string };
  const texto = (data.content ?? []).map((c) => c.text || "").join("\n").trim();
  if (!texto && data.stop_reason === "max_tokens") {
    throw new Error("La respuesta de Claude se cortó por límite de tokens antes de escribir nada — subí maxTokens.");
  }
  return texto;
}
