import { createHash, randomBytes } from "crypto";

// Tarea 2.3 — habla directo con el endpoint OAuth de Mercado Libre. Sin
// nada de base de datos acá (eso es lib/ml/cuentas.ts) para poder probar
// esta parte sola, con fetch simulado.
//
// Formato de petición confirmado contra el código real ya en producción
// del Zilonix OS actual (zilonix-os-web/lib/mercadolibre.js y
// lib/mercadolibre-promo.js) — no inventado, copiado del mismo que ya
// funciona hoy con cuentas reales. Esa app vieja ("Zilonix OS") no
// exige PKCE; la app nueva ("Zilonix Plataforma"), sí — bug real
// encontrado en vivo (ML respondió "code_verifier is a required
// parameter" al primer intento de conectar un TESTUSER).

export type TokensMl = {
  accessToken: string;
  refreshToken: string;
  expiraEnSegundos: number;
  cuentaIdExterna: string;
};

async function pedirTokens(body: URLSearchParams): Promise<TokensMl> {
  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`Mercado Libre respondió ${res.status} al pedir el token: ${texto.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.refresh_token) {
    // Pasa si la app de ML Developers no tiene activado "Refresh Token"
    // en sus Flujos OAuth — un problema de configuración, no de código.
    throw new Error("Mercado Libre no devolvió un refresh_token — revisar que 'Refresh Token' esté activo en la app.");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiraEnSegundos: data.expires_in,
    cuentaIdExterna: String(data.user_id),
  };
}

// Primera conexión: cambia el "code" que ML pone en la URL de vuelta por
// un par de tokens reales. code_verifier tiene que ser EXACTAMENTE el
// mismo string (sin cifrar, en texto plano) que se usó para calcular el
// code_challenge al armar el link de autorización — ML lo compara.
export async function intercambiarCodigo(code: string, redirectUri: string, codeVerifier: string): Promise<TokensMl> {
  return pedirTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: requerirVariable("ML_CLIENT_ID"),
      client_secret: requerirVariable("ML_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })
  );
}

// El access_token de ML dura pocas horas — esto pide uno nuevo con el
// refresh_token guardado. OJO: el refresh_token de ML sirve UNA sola
// vez (devuelve uno nuevo en la respuesta) — dos llamadas a esta función
// a la vez con el mismo refresh_token desconectan la cuenta. El candado
// contra eso vive en lib/ml/cuentas.ts, no acá.
export async function renovarToken(refreshToken: string): Promise<TokensMl> {
  return pedirTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: requerirVariable("ML_CLIENT_ID"),
      client_secret: requerirVariable("ML_CLIENT_SECRET"),
      refresh_token: refreshToken,
    })
  );
}

// Dominio de autorización de Mercado Libre Colombia — único país en
// alcance hoy (D2/D4 del plan técnico no mencionan otros países
// todavía). Si algún día se opera en otro país, esto pasa a depender
// del site_id de la empresa, no antes.
const DOMINIO_AUTORIZACION = "https://auth.mercadolibre.com.co/authorization";

export function construirUrlAutorizacion(redirectUri: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: requerirVariable("ML_CLIENT_ID"),
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${DOMINIO_AUTORIZACION}?${params.toString()}`;
}

// PKCE (RFC 7636) — el verifier es un secreto de un solo uso que nunca
// sale del servidor hasta el intercambio final; lo que viaja en la URL
// de autorización es solo su hash (code_challenge), para que nadie que
// intercepte el "code" en el camino de vuelta pueda canjearlo solo sin
// también tener el verifier original.
export function generarCodeVerifier(): string {
  return randomBytes(32).toString("base64url"); // 43 caracteres, cumple el mínimo de RFC 7636
}

export function calcularCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export async function obtenerNickname(accessToken: string): Promise<string> {
  const res = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al pedir los datos del vendedor.`);
  const data = await res.json();
  return data.nickname;
}

function requerirVariable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}.`);
  return valor;
}
