// Conector Falabella (15/11, pedido de Mateo/Debora — adelanta la tarea
// 5.1 del plan técnico). A partir de acá, toda llamada a la API de
// Falabella pasa por este archivo (mismo criterio que CLAUDE.md ya exige
// para lib/ml/cliente.ts con Mercado Libre) — nunca un fetch suelto en
// otro archivo de lib/falabella/.
//
// Diferencias reales con Mercado Libre, confirmadas contra
// developers.falabella.com (docs/getting-started, docs/signing-requests,
// docs/orders/getordersv2, docs/orders/getorderitems — no adivinadas):
// - No es OAuth. Es una API Key estática por usuario de Seller Center
//   (UserID = el correo), sin refresh token.
// - Cada llamada se firma con HMAC-SHA256 usando la API Key como clave:
//   se ordenan TODOS los parámetros menos Signature, se arma
//   "name=value&name=value..." (RFC 3986 URL-encoded) y el HMAC-SHA256
//   en hex minúsculas de esa cadena es la firma.
// - No hay ambiente de pruebas (sandbox) — la propia documentación
//   recomienda probar con productos de bajo valor directo en producción.
// - Parámetros de filtro/paginación de GetOrders (la tabla queda
//   colapsada en la documentación pública): `CreatedAfter`, `Limit` y
//   `Offset` ya se confirmaron con una cuenta real en staging (15/11,
//   issue #422).

import { createHmac } from "crypto";

const BASE_URL = "https://sellercenter-api.falabella.com/";

// FACO = Colombia (único país que opera Zilonix hoy). Chile es FACL,
// Perú es FAPE — agregar acá si algún día se conecta una tienda de otro
// país, nunca adivinar un código nuevo.
const CODIGO_PAIS = "FACO";

const TIMEOUT_MS = 15_000;

// Versión mayor del Node que corre el servidor (ej. "20"), para el
// User-Agent que pide Falabella.
const VERSION_MAYOR_NODE = process.versions.node.split(".")[0];

// Solo letras, números, "_", "." y "-" — el Seller ID va en el header
// User-Agent (revisión del PR #415).
export const SELLER_ID_VALIDO = /^[A-Za-z0-9_.-]{1,100}$/;

// Revisión del PR #415: "Falabella no respondió bien" (5xx, algo que no
// es JSON, timeout, red caída) es un problema distinto de "Falabella
// rechazó las credenciales" — nunca se le dice al usuario que su key es
// mala cuando el que falló fue Falabella.
export class FalabellaNoDisponibleError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "FalabellaNoDisponibleError";
  }
}

export class FalabellaApiError extends Error {
  codigo: string;
  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "FalabellaApiError";
    this.codigo = codigo;
  }
}

// RFC 3986: encodeURIComponent no escapa !'()*, y la documentación de
// firma de Falabella (/reference/signing-requests) pide codificar según
// RFC 3986. OJO: todavía NO se comprobó contra el vector oficial de firma
// de la documentación (queda pendiente, ver PR #415) — solo contra el
// texto de la especificación.
function codificarRfc3986(valor: string): string {
  return encodeURIComponent(valor).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function firmarSolicitud(params: Record<string, string>, apiKey: string): string {
  const cadena = Object.keys(params)
    .sort()
    .map((clave) => `${codificarRfc3986(clave)}=${codificarRfc3986(params[clave])}`)
    .join("&");
  return createHmac("sha256", apiKey).update(cadena).digest("hex");
}

type LlamarFalabellaOpciones = {
  userId: string;
  apiKey: string;
  sellerId: string;
  action: string;
  version: string;
  parametros?: Record<string, string>;
};

export async function llamarFalabella<T>({ userId, apiKey, sellerId, action, version, parametros = {} }: LlamarFalabellaOpciones): Promise<T> {
  const base: Record<string, string> = {
    Action: action,
    Format: "JSON",
    Timestamp: new Date().toISOString(),
    UserID: userId,
    Version: version,
    ...parametros,
  };
  const signature = firmarSolicitud(base, apiKey);
  const query = new URLSearchParams({ ...base, Signature: signature });

  // Revisión del PR #415: el sellerId lo escribe el usuario y va dentro
  // de una cabecera — se revalida acá también (no solo en la Server
  // Action) para que ningún llamador futuro pueda colar caracteres raros.
  if (!SELLER_ID_VALIDO.test(sellerId)) {
    throw new FalabellaApiError("seller_id_invalido", "El Seller ID tiene caracteres no permitidos.");
  }

  // Revisión del PR #415 (bloqueante 2): sin timeout, un Falabella lento
  // dejaba la petición colgada sin límite. 15 s por llamada, y sin seguir
  // redirecciones — la BASE_URL es fija y una redirección nunca es
  // esperada (evita que la firma y el User-Agent viajen a otro host).
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}?${query.toString()}`, {
    method: "GET",
    headers: {
      // Formato exigido por developers.falabella.com/docs/signing-requests:
      // SELLER_ID/TECNOLOGÍA/VERSIÓN/TIPO_INTEGRACIÓN/CÓDIGO_PAÍS (issue
      // #422 — antes iba "ZilonixSeller/1.0/API", que no sigue ese orden).
      "User-Agent": `${sellerId}/Node/${VERSION_MAYOR_NODE}/ZILONIX/${CODIGO_PAIS}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
    cache: "no-store",
    });
  } catch (error) {
    // Timeout (AbortSignal), redirección rechazada o red caída.
    throw new FalabellaNoDisponibleError(`No se pudo hablar con Falabella: ${error instanceof Error ? error.name : "error de red"}.`);
  }

  if (res.status >= 500) {
    throw new FalabellaNoDisponibleError(`Falabella respondió ${res.status}.`);
  }
  const cuerpo = await res.json().catch(() => null);
  if (!cuerpo || typeof cuerpo !== "object") {
    throw new FalabellaNoDisponibleError(`Falabella respondió ${res.status} sin cuerpo JSON legible.`);
  }
  if (cuerpo.ErrorResponse) {
    const err = cuerpo.ErrorResponse;
    throw new FalabellaApiError(String(err.ErrorCode ?? "desconocido"), String(err.ErrorMessage ?? "Error desconocido de Falabella."));
  }
  if (!cuerpo.SuccessResponse) {
    throw new FalabellaNoDisponibleError( `Falabella respondió ${res.status} sin SuccessResponse ni ErrorResponse.`);
  }
  return cuerpo.SuccessResponse.Body as T;
}

// Revisión del PR #415 (bloqueante 1): antes se guardaba la cuenta sin
// comprobar nada, y como user_id es único global, cualquiera podía
// "apartar" el correo de otro vendedor con una key inventada. Ahora,
// antes de guardar, se hace la llamada firmada más barata posible
// (GetOrders con Limit=1): si Falabella la acepta, la API Key es de
// verdad de ese UserID. Lanza FalabellaApiError si Falabella la rechaza
// y FalabellaNoDisponibleError si Falabella falla (5xx, no-JSON, timeout)
// — para no confundir "Falabella caído" con "credenciales malas".
export async function verificarCredenciales(credenciales: { userId: string; apiKey: string; sellerId: string }): Promise<void> {
  await llamarFalabella({
    ...credenciales,
    action: "GetOrders",
    version: "2.0",
    // CreatedAfter incluido porque en la familia Seller Center GetOrders
    // exige CreatedAfter o UpdatedAfter — se pide 1 día para que la
    // respuesta sea mínima.
    parametros: { CreatedAfter: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), Limit: "1" },
  });
}
