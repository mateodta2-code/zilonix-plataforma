import { createHash, randomBytes } from "crypto";

// Conexión de Canva por usuario+empresa (a diferencia de zilonix-os-web,
// que usa UNA sola cuenta de Canva compartida por todo el negocio, sin
// cifrado — confirmado leyendo lib/canva.js de ese repo). Acá cada
// usuario conecta SU propia cuenta, igual de PKCE-estricto que
// lib/ml/oauth.ts (ver ese archivo para el motivo real de por qué PKCE
// es obligatorio, no opcional).
//
// Endpoints y forma del payload confirmados contra el código real que
// ya corre en producción en zilonix-os-web/lib/canva.js — no inventados.

export type TokensCanva = {
  accessToken: string;
  refreshToken: string;
  expiraEnSegundos: number;
};

const AUTORIZACION_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";

// Mismos 3 scopes que ya usa zilonix-os-web contra la cuenta real de
// Canva (confirmados funcionando en producción) — design:content:read
// y design:meta:read para leer el diseño, asset:read porque el export
// de un diseño con imágenes/elementos propios lo puede necesitar.
const SCOPES = "design:content:read design:meta:read asset:read";

function requerirVariable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}.`);
  return valor;
}

async function pedirTokens(body: URLSearchParams): Promise<TokensCanva> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`Canva respondió ${res.status} al pedir el token: ${texto.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.refresh_token) {
    throw new Error("Canva no devolvió un refresh_token.");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiraEnSegundos: data.expires_in,
  };
}

// Primera conexión: cambia el "code" que Canva pone en la URL de vuelta
// por un par de tokens reales. code_verifier tiene que ser EXACTAMENTE
// el mismo string que se usó para calcular el code_challenge al armar
// el link de autorización.
export async function intercambiarCodigo(code: string, redirectUri: string, codeVerifier: string): Promise<TokensCanva> {
  return pedirTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: requerirVariable("CANVA_CLIENT_ID"),
      client_secret: requerirVariable("CANVA_CLIENT_SECRET"),
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    })
  );
}

// El access_token de Canva dura unas horas — esto pide uno nuevo con el
// refresh_token guardado. El candado contra renovaciones dobles vive
// junto a la tabla de conexiones (mismo criterio que lib/ml/cuentas.ts),
// no acá.
export async function renovarToken(refreshToken: string): Promise<TokensCanva> {
  return pedirTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: requerirVariable("CANVA_CLIENT_ID"),
      client_secret: requerirVariable("CANVA_CLIENT_SECRET"),
      refresh_token: refreshToken,
    })
  );
}

export function construirUrlAutorizacion(redirectUri: string, codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: requerirVariable("CANVA_CLIENT_ID"),
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTORIZACION_URL}?${params.toString()}`;
}

// PKCE (RFC 7636) — mismo mecanismo que lib/ml/oauth.ts: el verifier es
// un secreto de un solo uso que nunca sale del servidor hasta el
// intercambio final.
export function generarCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

// state (RFC 6749 §10.12) — protección CSRF, nunca el mismo valor que
// el code_verifier aunque la generación sea idéntica.
export function generarState(): string {
  return randomBytes(32).toString("base64url");
}

export function calcularCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

// Pedido de Pablo/Mateo — al desconectar, intentar revocar el token en
// Canva (RFC 7009, mismo endpoint /revoke que usan la mayoría de
// proveedores OAuth2). zilonix-os-web nunca desconecta su única cuenta
// compartida, así que esto no está confirmado contra un caso real en
// producción como el resto de este archivo — "si la API lo permite"
// (pedido explícito): un 404/405 de Canva (si el endpoint no existe o
// cambió) nunca debe bloquear la desconexión, solo se loguea. Quien
// llama (lib/canva/conexiones.ts) ya borra los tokens de la base sin
// esperar esto.
export async function revocarTokenSiEsPosible(refreshToken: string): Promise<void> {
  try {
    const res = await fetch("https://api.canva.com/rest/v1/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: refreshToken,
        client_id: requerirVariable("CANVA_CLIENT_ID"),
        client_secret: requerirVariable("CANVA_CLIENT_SECRET"),
      }),
    });
    if (!res.ok) {
      console.warn(`[lib/canva/oauth] Canva respondió ${res.status} al revocar el token — se desconecta igual.`);
    }
  } catch (error) {
    console.warn("[lib/canva/oauth] no se pudo revocar el token en Canva — se desconecta igual:", error instanceof Error ? error.name : String(error));
  }
}
