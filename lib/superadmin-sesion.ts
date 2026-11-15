// Sesión APARTE del panel superadmin (rama feat/superadmin-login-aparte).
// Módulo puro (solo Web Crypto, sin Next ni Clerk ni base) para poder
// usarlo tanto en el middleware (runtime edge) como en las páginas, y
// para probarlo solo.

export const NOMBRE_COOKIE_SUPERADMIN = "zx_superadmin";
export const RUTA_COOKIE_SUPERADMIN = "/superadmin";
// Vence por INACTIVIDAD: cada uso válido la vuelve a emitir con 30
// minutos nuevos (ver middleware.ts).
export const INACTIVIDAD_SUPERADMIN_MS = 30 * 60 * 1000;

// SUPERADMIN_CORREOS: separados por coma, sin distinguir mayúsculas,
// con trim. Cerrado por defecto: variable ausente o vacía = lista
// vacía = nadie entra.
export function parsearCorreosSuperadmin(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
}

export function correoEstaAutorizado(correo: string | null | undefined, lista: string[]): boolean {
  if (!correo) return false;
  const normalizado = correo.trim().toLowerCase();
  return normalizado.length > 0 && lista.includes(normalizado);
}

const codificador = new TextEncoder();

function aBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(texto)) return null;
  const relleno = texto.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (texto.length % 4)) % 4);
  try {
    const binario = atob(relleno);
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function claveHmac(secreto: string, usos: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", codificador.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, usos);
}

// Valor de la cookie: base64url(JSON {u: id de usuario de Clerk, exp: ms}) + "." + base64url(HMAC-SHA256).
export async function firmarCookieSuperadmin(clerkUserId: string, ahoraMs: number, secreto: string): Promise<string> {
  const carga = aBase64Url(codificador.encode(JSON.stringify({ u: clerkUserId, exp: ahoraMs + INACTIVIDAD_SUPERADMIN_MS })));
  const firma = await crypto.subtle.sign("HMAC", await claveHmac(secreto, ["sign"]), codificador.encode(carga));
  return `${carga}.${aBase64Url(new Uint8Array(firma))}`;
}

// La firma se compara con crypto.subtle.verify, que es en tiempo
// constante (nunca con === sobre el texto de la firma).
export async function verificarCookieSuperadmin(
  valor: string | undefined | null,
  clerkUserIdEsperado: string,
  ahoraMs: number,
  secreto: string | undefined,
): Promise<boolean> {
  if (!valor || !secreto) return false;
  const partes = valor.split(".");
  if (partes.length !== 2) return false;
  const [carga, firmaTexto] = partes;
  const firma = deBase64Url(firmaTexto);
  if (!firma) return false;

  const firmaValida = await crypto.subtle.verify("HMAC", await claveHmac(secreto, ["verify"]), firma, codificador.encode(carga));
  if (!firmaValida) return false;

  const bytes = deBase64Url(carga);
  if (!bytes) return false;
  try {
    const datos = JSON.parse(new TextDecoder().decode(bytes)) as { u?: unknown; exp?: unknown };
    return datos.u === clerkUserIdEsperado && typeof datos.exp === "number" && datos.exp > ahoraMs;
  } catch {
    return false;
  }
}

export function opcionesCookieSuperadmin() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: RUTA_COOKIE_SUPERADMIN,
    maxAge: INACTIVIDAD_SUPERADMIN_MS / 1000,
  };
}
