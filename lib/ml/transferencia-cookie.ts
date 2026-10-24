import { cifrarToken, descifrarToken, type TokenCifrado } from "@/lib/cifrado";
import type { TokensMl } from "@/lib/ml/oauth";

// Issue #181 — entre que Mercado Libre confirma el OAuth y quien
// conecta decide "transferir" o "cancelar" hay que guardar los tokens
// nuevos en ALGÚN lado, sin tocar la base todavía (la fila real sigue
// siendo de la otra empresa hasta que se confirme) y sin que viajen
// nunca en texto plano — regla explícita: nunca en la URL ni en un
// log. Una cookie httpOnly, cifrada con el mismo AES-256-GCM
// versionado de lib/cifrado.ts (los tokens de cuentas_ml ya usan esa
// misma protección), de vida corta (10 min — mismo criterio que
// NOMBRE_COOKIE_VERIFIER/STATE en pkce-cookie.ts) alcanza: no hace
// falta guardar nada en Postgres solo para este estado intermedio.
export const NOMBRE_COOKIE_TRANSFERENCIA = "ml_transferencia_pendiente";

export const OPCIONES_COOKIE_TRANSFERENCIA = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: 600,
  // La confirmación y el cancelar viven bajo esta misma ruta — no hace
  // falta (ni conviene) que la cookie viaje a ningún otro lado.
  path: "/panel/conectar-ml",
};

export type TransferenciaPendiente = {
  cuentaIdExterna: string;
  nickname: string;
  tokens: TokensMl;
};

export function cifrarTransferenciaPendiente(datos: TransferenciaPendiente): string {
  const cifrado = cifrarToken(JSON.stringify(datos));
  // El valor de una cookie no puede llevar ';', ',' ni espacios tal
  // cual — base64 (alfabeto A-Za-z0-9+/=) nunca usa ninguno de esos.
  return Buffer.from(JSON.stringify(cifrado)).toString("base64");
}

export function descifrarTransferenciaPendiente(valorCookie: string): TransferenciaPendiente | null {
  try {
    const cifrado = JSON.parse(Buffer.from(valorCookie, "base64").toString("utf8")) as TokenCifrado;
    return JSON.parse(descifrarToken(cifrado)) as TransferenciaPendiente;
  } catch {
    // Cookie vencida, manipulada, o de una clave de cifrado rotada —
    // nunca reventar la pantalla por esto: se trata igual que "no hay
    // ninguna transferencia pendiente".
    return null;
  }
}
