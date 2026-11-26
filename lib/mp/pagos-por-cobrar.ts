// Issue #422 (por cobrar) — pagos de Mercado Pago que todavía no son plata
// disponible, con GET /v1/payments/search y el token OAuth de cuentas_mp.
// Sin base de datos: lib/finanzas/por-cobrar-consulta.ts guarda la foto en
// pagos_mp_por_cobrar. Nunca se logea el token ni el body: los errores
// salen como un código corto (CodigoErrorPagosMp).

export const URL_BUSQUEDA_PAGOS = "https://api.mercadopago.com/v1/payments/search";
const TIMEOUT_MS = 10_000;
const LIMITE = 50;
// Tope de seguridad por consulta: 40 páginas = 2.000 pagos.
const MAX_PAGINAS = 40;
// Mercado Pago no pagina más allá de offset 10.000.
const MAX_OFFSET = 9_950;
const DIA_MS = 86_400_000;

export type CodigoErrorPagosMp = "mp_401" | "mp_403" | "mp_429" | "mp_http" | "mp_red";

export class ErrorPagosMp extends Error {
  constructor(readonly codigo: CodigoErrorPagosMp, readonly status?: number) {
    super(`Búsqueda de pagos de Mercado Pago: ${codigo}${status ? ` (${status})` : ""}`);
    this.name = "ErrorPagosMp";
  }
}

function codigoPorStatus(status: number): CodigoErrorPagosMp {
  if (status === 401) return "mp_401";
  if (status === 403) return "mp_403";
  if (status === 429) return "mp_429";
  return "mp_http";
}

export type TipoPagoPorCobrar = "por_liberar" | "retenido";

export type PagoMpPorCobrar = {
  pagoIdExterno: string;
  ordenIdExterno: string | null;
  estado: string;
  estadoLiberacion: string | null;
  fechaLiberacion: Date | null;
  // 2 decimales en texto; null = Mercado Pago no mandó el neto.
  montoNeto: string | null;
  moneda: string;
  tipo: TipoPagoPorCobrar;
};

// ---------- Clasificación (pura) ----------

const PATRON_MONEDA = /^[A-Z]{3}$/;
const PATRON_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const ESTADOS_DESCARTADOS = new Set(["refunded", "charged_back"]);

// Número o texto decimal → texto con 2 decimales, redondeando la mitad lejos
// de cero con BigInt (sin aritmética de float). String(12345.67) ya es la
// representación más corta del número JSON; la notación exponencial
// (1e21) no se acepta.
export function aMontoDosDecimales(valor: unknown): string | null {
  if (typeof valor !== "number" && typeof valor !== "string") return null;
  if (typeof valor === "number" && !Number.isFinite(valor)) return null;
  const m = PATRON_DECIMAL.exec(String(valor).trim());
  if (!m) return null;
  const decimales = m[3] ?? "";
  let centavos = BigInt(m[2]) * BigInt(100) + BigInt((decimales + "00").slice(0, 2));
  if (decimales.length > 2 && Number(decimales[2]) >= 5) centavos += BigInt(1);
  const texto = `${centavos / BigInt(100)}.${(centavos % BigInt(100)).toString().padStart(2, "0")}`;
  return m[1] === "-" && centavos !== BigInt(0) ? `-${texto}` : texto;
}

function textoId(valor: unknown): string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  if (typeof valor === "string" && valor.trim()) return valor.trim();
  return null;
}

function fecha(valor: unknown): Date | null {
  if (typeof valor !== "string" || !valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

// null = no es plata por cobrar de esta cuenta. `ahora` se recibe por
// contrato (la fecha de liberación ya pasada no cambia el tipo: queda
// «por_liberar» y lib/finanzas/por-cobrar.ts la marca «vencida»).
export function clasificarPagoMp(pagoJson: unknown, collectorId: string, _ahora: Date): PagoMpPorCobrar | null {
  if (!pagoJson || typeof pagoJson !== "object") return null;
  const p = pagoJson as Record<string, unknown>;

  const collector = textoId(p.collector_id) ?? textoId((p.collector as Record<string, unknown> | undefined)?.id);
  // Pagos donde esta cuenta fue la compradora: no son plata por cobrar.
  if (collector === null || collector !== collectorId) return null;

  const id = textoId(p.id);
  const estado = typeof p.status === "string" ? p.status : null;
  if (!id || !estado || ESTADOS_DESCARTADOS.has(estado)) return null;
  const estadoLiberacion = typeof p.money_release_status === "string" ? p.money_release_status : null;
  if (estadoLiberacion === "released") return null;

  let tipo: TipoPagoPorCobrar;
  if (estado === "in_mediation") tipo = "retenido";
  else if (estado === "approved") tipo = "por_liberar";
  else return null;

  const moneda = typeof p.currency_id === "string" ? p.currency_id : "";
  if (!PATRON_MONEDA.test(moneda)) return null;

  const detalles = p.transaction_details as Record<string, unknown> | undefined;
  const orden = p.order as Record<string, unknown> | undefined;
  return {
    pagoIdExterno: id,
    ordenIdExterno: textoId(orden?.id),
    estado,
    estadoLiberacion,
    fechaLiberacion: fecha(p.money_release_date),
    montoNeto: aMontoDosDecimales(detalles?.net_received_amount),
    moneda,
    tipo,
  };
}

// ---------- Llamadas ----------

async function buscarPagina(accessToken: string, params: Record<string, string>, offset: number): Promise<{ results: unknown[]; total: number }> {
  const query = new URLSearchParams({ ...params, limit: String(LIMITE), offset: String(offset) });
  let res: Response;
  try {
    res = await fetch(`${URL_BUSQUEDA_PAGOS}?${query.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ErrorPagosMp("mp_red");
  }
  if (!res.ok) throw new ErrorPagosMp(codigoPorStatus(res.status), res.status);
  let cuerpo: unknown;
  try {
    cuerpo = await res.json();
  } catch {
    throw new ErrorPagosMp("mp_http", res.status);
  }
  const c = cuerpo as { results?: unknown; paging?: { total?: unknown } } | null;
  const results = Array.isArray(c?.results) ? c.results : [];
  const total = typeof c?.paging?.total === "number" ? c.paging.total : results.length;
  return { results, total };
}

async function paginar(accessToken: string, params: Record<string, string>, alRecibir: (pago: unknown) => void): Promise<void> {
  let offset = 0;
  for (let pagina = 0; pagina < MAX_PAGINAS && offset <= MAX_OFFSET; pagina++) {
    const { results, total } = await buscarPagina(accessToken, params, offset);
    results.forEach(alRecibir);
    if (results.length === 0) return;
    offset += results.length;
    if (offset >= total) return;
  }
}

const iso = (d: Date) => d.toISOString();

export function consultasBusquedaPagos(collectorId: string, ahora: Date) {
  const base = { "collector.id": collectorId };
  return {
    // A: aprobados por liberar, por fecha de liberación (puede ser futura).
    aprobados: {
      ...base,
      status: "approved",
      range: "money_release_date",
      begin_date: iso(new Date(ahora.getTime() - 60 * DIA_MS)),
      end_date: iso(new Date(ahora.getTime() + 180 * DIA_MS)),
      sort: "money_release_date",
      criteria: "asc",
    },
    // A (fallback si Mercado Pago rechaza el end_date futuro con 400).
    aprobadosRespaldo: {
      ...base,
      status: "approved",
      range: "date_approved",
      begin_date: "NOW-90DAYS",
      end_date: "NOW",
      sort: "date_approved",
      criteria: "desc",
    },
    // B: retenidos en reclamo.
    enReclamo: {
      ...base,
      status: "in_mediation",
      range: "date_created",
      begin_date: "NOW-365DAYS",
      end_date: "NOW",
      sort: "date_created",
      criteria: "desc",
    },
  };
}

// Aprobados sin liberar + en reclamo, deduplicados por id de pago.
export async function buscarPagosPendientesMp(accessToken: string, collectorId: string, ahora: Date): Promise<PagoMpPorCobrar[]> {
  const consultas = consultasBusquedaPagos(collectorId, ahora);
  const porId = new Map<string, PagoMpPorCobrar>();
  const alRecibir = (pago: unknown) => {
    const clasificado = clasificarPagoMp(pago, collectorId, ahora);
    if (clasificado) porId.set(clasificado.pagoIdExterno, clasificado);
  };

  try {
    await paginar(accessToken, consultas.aprobados, alRecibir);
  } catch (error) {
    if (!(error instanceof ErrorPagosMp && error.status === 400)) throw error;
    await paginar(accessToken, consultas.aprobadosRespaldo, alRecibir);
  }
  await paginar(accessToken, consultas.enReclamo, alRecibir);
  return [...porId.values()];
}
