// Ayuda para sacar la API key según el proveedor. Solo texto y enlaces
// oficiales (verificados el 21/11/2026); no toca la lógica de guardado.

export type ProveedorIA = "anthropic" | "openai" | "google" | "xai" | "otro_compatible_openai";

export type AyudaProveedor = {
  url: string | null;
  etiquetaEnlace: string;
  pasos: string[];
  modeloEjemplo: string;
  saldo: boolean;
};

export const NOTA_SUSCRIPCION =
  "La suscripción mensual (ChatGPT Plus, Claude Pro, Gemini o SuperGrok) no sirve aquí: la API se paga aparte, según el uso.";

export const NOTA_IMAGENES_OPENAI =
  "Para \"Generación de imágenes\", la cuenta debe tener acceso a los modelos gpt-image; OpenAI puede pedir verificar la organización en Settings → Organization.";

function pasosComunes(cargar: string, modeloEjemplo: string, entrada: string): string[] {
  return [
    `${entrada}`,
    cargar,
    "Crea una clave nueva y cópiala (se muestra una sola vez).",
    `Pégala aquí, elige el modelo de la lista (ya viene el recomendado, por ejemplo ${modeloEjemplo}) y guarda.`,
  ];
}

export const AYUDA_PROVEEDOR: Record<ProveedorIA, AyudaProveedor> = {
  openai: {
    url: "https://platform.openai.com/api-keys",
    etiquetaEnlace: "Crear mi API key en OpenAI ↗",
    modeloEjemplo: "gpt-6.2-sol",
    saldo: true,
    pasos: pasosComunes("Carga saldo en Billing: la API no funciona sin saldo.", "gpt-6.2-sol", "Crea tu cuenta en OpenAI o entra a la que ya tienes."),
  },
  anthropic: {
    url: "https://platform.claude.com/settings/keys",
    etiquetaEnlace: "Crear mi API key en Anthropic ↗",
    modeloEjemplo: "claude-sonnet-5-5",
    saldo: true,
    pasos: pasosComunes("Carga saldo en Billing: la API no funciona sin saldo.", "claude-sonnet-5-5", "Crea tu cuenta en Anthropic o entra a la que ya tienes."),
  },
  google: {
    url: "https://aistudio.google.com/app/apikey",
    etiquetaEnlace: "Crear mi API key en Google ↗",
    modeloEjemplo: "gemini-3.8-flash",
    saldo: false,
    pasos: pasosComunes(
      "Tiene nivel gratuito; para uso mayor o para imágenes, activa la facturación.",
      "gemini-3.8-flash",
      "Entra a Google AI Studio con tu cuenta de Google."
    ),
  },
  xai: {
    url: "https://console.x.ai",
    etiquetaEnlace: "Crear mi API key en xAI ↗",
    modeloEjemplo: "grok-4.7",
    saldo: true,
    pasos: pasosComunes("Carga créditos en la consola.", "grok-4.7", "Crea tu cuenta en la consola de xAI o entra, y abre «API Keys»."),
  },
  otro_compatible_openai: {
    url: null,
    etiquetaEnlace: "",
    modeloEjemplo: "el modelo de tu proveedor",
    saldo: false,
    pasos: ["Usa la URL base y la clave que te dé tu proveedor."],
  },
};
