// Issue #422 (Bloque 2, diagnóstico) — verificación liviana de los
// endpoints oficiales de Mercado Pago con el token OAuth real.
//
// En staging se confirmó que `GET /users/{user_id}/mercadopago_account/balance`
// responde 403 ForbiddenApiError para apps OAuth, así que esa llamada se
// quitó. Mientras se diseña el bloque definitivo de Disponible y Por cobrar
// ML, solo se consulta qué responden:
//   - GET /v1/account/release_report/list (liberaciones)
//   - GET /v1/payments/search?limit=1     (pagos)
//
// Módulo puro: sin base de datos (el token vigente lo entrega
// lib/mp/cuentas.ts), para poder probarlo solo con fetch simulado. Nunca se
// logea ni se devuelve el token ni el body completo de Mercado Pago: solo el
// status HTTP, una cantidad y, si viene, un código corto (`error` o `code`)
// que pase la lista blanca de abajo.

export type CodigoErrorEndpointMp = "mp_403" | "mp_401" | "mp_http" | "mp_red";

export type EstadoEndpointMp =
  | { ok: true; status: number; cantidad?: number }
  | { ok: false; status?: number; codigo: CodigoErrorEndpointMp; codigoMp?: string };

export type VerificacionEndpointsMp = {
  liberaciones: EstadoEndpointMp;
  pagos: EstadoEndpointMp;
};

const TIMEOUT_MS = 5_000;
const CODIGO_MP_SEGURO = /^[a-z0-9_.-]{1,40}$/i;

export const URL_RELEASE_REPORT_LIST = "https://api.mercadopago.com/v1/account/release_report/list";
export const URL_PAYMENTS_SEARCH = "https://api.mercadopago.com/v1/payments/search?limit=1";

function codigoMpDe(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const registro = data as Record<string, unknown>;
  for (const clave of ["error", "code"]) {
    const valor = registro[clave];
    if (typeof valor === "string" && CODIGO_MP_SEGURO.test(valor)) return valor;
  }
  return undefined;
}

// release_report/list responde un array de reportes.
function cantidadLiberaciones(data: unknown): number | undefined {
  return Array.isArray(data) ? data.length : undefined;
}

// payments/search responde { paging, results: [...] }.
function cantidadPagos(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const results = (data as Record<string, unknown>).results;
  return Array.isArray(results) ? results.length : undefined;
}

async function consultarEndpoint(
  url: string,
  accessToken: string,
  contar: (data: unknown) => number | undefined
): Promise<EstadoEndpointMp> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Red caída, DNS o timeout: nada del error se expone (podría traer la URL).
    return { ok: false, codigo: "mp_red" };
  }

  // Un body que no es JSON (o JSON con otra forma) no es un error del
  // diagnóstico: se informa el status y, si no se puede contar, sin cantidad.
  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const codigoMp = codigoMpDe(data);
    const codigo: CodigoErrorEndpointMp = res.status === 403 ? "mp_403" : res.status === 401 ? "mp_401" : "mp_http";
    return { ok: false, status: res.status, codigo, ...(codigoMp ? { codigoMp } : {}) };
  }

  const cantidad = contar(data);
  return { ok: true, status: res.status, ...(cantidad !== undefined ? { cantidad } : {}) };
}

export async function verificarEndpointsMp(accessToken: string): Promise<VerificacionEndpointsMp> {
  const [liberaciones, pagos] = await Promise.all([
    consultarEndpoint(URL_RELEASE_REPORT_LIST, accessToken, cantidadLiberaciones),
    consultarEndpoint(URL_PAYMENTS_SEARCH, accessToken, cantidadPagos),
  ]);
  return { liberaciones, pagos };
}
