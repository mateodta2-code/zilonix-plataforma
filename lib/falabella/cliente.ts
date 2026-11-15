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
// - Incógnita real, no resuelta por la documentación pública: los
//   nombres exactos de los parámetros de filtro de fecha/paginación de
//   GetOrders (la tabla de parámetros queda colapsada sin credenciales
//   reales) — se confirman en el primer uso contra una cuenta real.

import { createHmac } from "crypto";

const BASE_URL = "https://sellercenter-api.falabella.com/";

// FACO = Colombia (único país que opera Zilonix hoy). Chile es FACL,
// Perú es FAPE — agregar acá si algún día se conecta una tienda de otro
// país, nunca adivinar un código nuevo.
const CODIGO_PAIS = "FACO";

export class FalabellaApiError extends Error {
  codigo: string;
  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "FalabellaApiError";
    this.codigo = codigo;
  }
}

// RFC 3986: encodeURIComponent no escapa !'()* — Falabella exige que sí
// se escapen (confirmado contra el ejemplo de referencia de la
// documentación, que da un vector de firma esperado para comprobarlo).
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

  const res = await fetch(`${BASE_URL}?${query.toString()}`, {
    method: "GET",
    headers: {
      // Formato exigido por la documentación: SELLER_ID/TECNOLOGIA/VERSION/TIPO_INTEGRACION/CODIGO_PAIS
      "User-Agent": `${sellerId}/ZilonixSeller/1.0/API/${CODIGO_PAIS}`,
    },
  });

  const cuerpo = await res.json().catch(() => null);
  if (!cuerpo) {
    throw new FalabellaApiError("respuesta_invalida", `Falabella respondió ${res.status} sin cuerpo JSON legible.`);
  }
  if (cuerpo.ErrorResponse) {
    const err = cuerpo.ErrorResponse;
    throw new FalabellaApiError(String(err.ErrorCode ?? "desconocido"), String(err.ErrorMessage ?? "Error desconocido de Falabella."));
  }
  return cuerpo.SuccessResponse?.Body as T;
}
