// Issue #422 (Bloque 2) — saldo en vivo de una cuenta de Mercado Pago.
// Módulo puro: sin base de datos (el token vigente lo entrega
// lib/mp/cuentas.ts), para poder probarlo solo con fetch simulado.
//
// Nunca se logea ni se devuelve el token ni el body completo de Mercado
// Pago: solo el status HTTP y, si viene, un código corto (`error` o
// `code`) que pase la lista blanca de abajo.

export type SaldoMpOk = {
  estado: "ok";
  // Montos en texto con 2 decimales («1234.50», «-10.00»): mismo formato
  // que acepta aCentavos en lib/finanzas/disponible.ts.
  disponible: string;
  porLiberar: string | null;
  moneda: string;
};

export type CodigoErrorSaldoMp = "mp_403" | "mp_401" | "mp_http" | "mp_red" | "mp_respuesta_invalida";

export type SaldoMpError = {
  estado: "error";
  codigo: CodigoErrorSaldoMp;
  status?: number;
  codigoMp?: string;
};

export type ResultadoSaldoMp = SaldoMpOk | SaldoMpError;

const TIMEOUT_MS = 5_000;
const CODIGO_MP_SEGURO = /^[a-z0-9_.-]{1,40}$/i;
const MONEDA_VALIDA = /^[A-Z]{3}$/;

function urlSaldo(userId: string): string {
  return `https://api.mercadopago.com/users/${encodeURIComponent(userId)}/mercadopago_account/balance`;
}

// Número finito (o texto numérico) → texto con 2 decimales. Se redondea
// en centavos enteros para no arrastrar basura de coma flotante.
export function montoMpATexto(valor: unknown): string | null {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() !== "" ? Number(valor) : NaN;
  if (!Number.isFinite(n)) return null;
  const centavos = Math.round(Math.abs(n) * 100);
  if (!Number.isSafeInteger(centavos)) return null;
  const texto = `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
  return n < 0 && centavos > 0 ? `-${texto}` : texto;
}

function codigoMpDe(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const registro = data as Record<string, unknown>;
  for (const clave of ["error", "code"]) {
    const valor = registro[clave];
    if (typeof valor === "string" && CODIGO_MP_SEGURO.test(valor)) return valor;
  }
  return undefined;
}

export async function consultarSaldoMp(accessToken: string, userId: string): Promise<ResultadoSaldoMp> {
  let res: Response;
  try {
    res = await fetch(urlSaldo(userId), {
      headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Red caída, DNS o timeout: nada del error se expone (podría traer la URL).
    return { estado: "error", codigo: "mp_red" };
  }

  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    const codigoMp = codigoMpDe(data);
    const codigo: CodigoErrorSaldoMp = res.status === 403 ? "mp_403" : res.status === 401 ? "mp_401" : "mp_http";
    return { estado: "error", codigo, status: res.status, ...(codigoMp ? { codigoMp } : {}) };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { estado: "error", codigo: "mp_respuesta_invalida", status: res.status };
  }
  if (!data || typeof data !== "object") return { estado: "error", codigo: "mp_respuesta_invalida", status: res.status };

  const registro = data as Record<string, unknown>;
  const disponible = montoMpATexto(registro.available_balance);
  const moneda = typeof registro.currency_id === "string" ? registro.currency_id.trim().toUpperCase() : "";
  if (disponible === null || !MONEDA_VALIDA.test(moneda)) {
    return { estado: "error", codigo: "mp_respuesta_invalida", status: res.status };
  }
  return { estado: "ok", disponible, porLiberar: montoMpATexto(registro.unavailable_balance), moneda };
}
