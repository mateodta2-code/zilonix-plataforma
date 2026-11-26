import { randomBytes } from "crypto";
import { urlPublicaBase } from "@/lib/url-publica";

// Issue #422 (Bloque 1) — habla directo con el OAuth de Mercado Pago.
// Sin nada de base de datos acá (eso es lib/mp/cuentas.ts), igual que
// lib/ml/oauth.ts y lib/canva/oauth.ts, para poder probarlo solo con
// fetch simulado.
//
// A diferencia de Mercado Libre, la app de Mercado Pago no exige PKCE:
// la protección contra CSRF es el `state` (cookie httpOnly de un solo
// uso, lib/mp/state-cookie.ts), comparado con timingSafeEqual en
// /api/mp/callback antes de canjear el code.

export type TokensMp = {
  accessToken: string;
  refreshToken: string;
  expiraEnSegundos: number;
  cuentaIdExterna: string;
};

const AUTORIZACION_URL = "https://auth.mercadopago.com/authorization";
const TOKEN_URL = "https://api.mercadopago.com/oauth/token";
const USUARIO_URL = "https://api.mercadopago.com/users/me";

function requerirVariable(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}.`);
  return valor;
}

// Debe coincidir EXACTO con la Redirect URI registrada en la app de
// Mercado Pago (staging y prod) y con la que se manda al canjear el code.
export function redirectUriMp(): string {
  return `${urlPublicaBase()}/api/mp/callback`;
}

async function pedirTokens(body: URLSearchParams): Promise<TokensMp> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    // Bloque 2: sin esto un Mercado Pago colgado dejaba el candado
    // renovando_ts tomado hasta los 30s de CANDADO_ABANDONADO_MS.
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    // Nunca se logea completo (ver /api/mp/callback y lib/mp/cuentas.ts:
    // solo error.name) — puede traer texto crudo de Mercado Pago.
    throw new Error(`Mercado Pago respondió ${res.status} al pedir el token: ${texto.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token || data.user_id === undefined || data.user_id === null) {
    throw new Error("Mercado Pago no devolvió access_token, refresh_token y user_id.");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiraEnSegundos: Number(data.expires_in),
    cuentaIdExterna: String(data.user_id),
  };
}

export async function intercambiarCodigo(code: string): Promise<TokensMp> {
  return pedirTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: requerirVariable("MP_CLIENT_ID"),
      client_secret: requerirVariable("MP_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUriMp(),
    })
  );
}

// Mercado Pago devuelve un refresh_token nuevo en cada renovación — el
// candado contra renovaciones dobles vive en lib/mp/cuentas.ts, no acá.
export async function renovarToken(refreshToken: string): Promise<TokensMp> {
  return pedirTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: requerirVariable("MP_CLIENT_ID"),
      client_secret: requerirVariable("MP_CLIENT_SECRET"),
      refresh_token: refreshToken,
    })
  );
}

export function construirUrlAutorizacion(state: string): string {
  const params = new URLSearchParams({
    client_id: requerirVariable("MP_CLIENT_ID"),
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: redirectUriMp(),
  });
  return `${AUTORIZACION_URL}?${params.toString()}`;
}

// state (RFC 6749 §10.12) — protección CSRF, mismo mecanismo que
// lib/ml/oauth.ts (32 bytes aleatorios, base64url).
export function generarState(): string {
  return randomBytes(32).toString("base64url");
}

// Best-effort: solo para mostrar un nombre legible en /panel/conectar-ml.
// Si /users/me falla o no responde, la conexión sigue igual (nickname
// null) — nunca tumba el flujo de OAuth.
export async function obtenerDatosUsuarioMp(accessToken: string): Promise<{ nickname: string | null }> {
  try {
    const res = await fetch(USUARIO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { nickname: null };
    const data = await res.json();
    const nickname = typeof data?.nickname === "string" && data.nickname ? data.nickname : typeof data?.email === "string" && data.email ? data.email : null;
    return { nickname };
  } catch {
    return { nickname: null };
  }
}
