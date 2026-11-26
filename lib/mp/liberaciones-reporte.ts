import { diaBogota } from "@/lib/finanzas/utilidad-venta";

// Issue #422 — saldo disponible de Mercado Pago con la API oficial de
// Reporte de Liberaciones (/v1/account/release_report). Sin base de datos:
// lib/finanzas/disponible-consulta.ts guarda el resultado en cuentas_mp.
// Nunca se logea el token ni el contenido del CSV: los errores salen como
// un código corto (CodigoErrorLiberacionesMp).

export const URL_REPORTE_LIBERACIONES = "https://api.mercadopago.com/v1/account/release_report";
const TIMEOUT_MS = 10_000;

// Columnas mínimas para leer el saldo, solo si el vendedor aún no tiene
// configuración (nunca se pisa una existente).
export const COLUMNAS_MINIMAS_LIBERACIONES = [
  "DATE",
  "RECORD_TYPE",
  "DESCRIPTION",
  "BALANCE_AMOUNT",
  "NET_CREDIT_AMOUNT",
  "NET_DEBIT_AMOUNT",
  "SOURCE_ID",
  "CURRENCY",
] as const;
export const PREFIJO_REPORTE_LIBERACIONES = "zilonix-release";

export type CodigoErrorLiberacionesMp =
  | "mp_401"
  | "mp_403"
  | "mp_404"
  | "mp_http"
  | "mp_red"
  | "mp_sin_config"
  | "mp_sin_datos"
  | "mp_reporte_no_creado";

export class ErrorLiberacionesMp extends Error {
  constructor(readonly codigo: CodigoErrorLiberacionesMp, readonly status?: number) {
    super(`Reporte de liberaciones de Mercado Pago: ${codigo}${status ? ` (${status})` : ""}`);
    this.name = "ErrorLiberacionesMp";
  }
}

function codigoPorStatus(status: number): CodigoErrorLiberacionesMp {
  if (status === 401) return "mp_401";
  if (status === 403) return "mp_403";
  if (status === 404) return "mp_404";
  return "mp_http";
}

async function llamar(accessToken: string, ruta: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<Response> {
  try {
    return await fetch(`${URL_REPORTE_LIBERACIONES}${ruta}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ErrorLiberacionesMp("mp_red");
  }
}

async function jsonSeguro(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---------- Configuración ----------

export type ResultadoConfigLiberaciones = "existente" | "creada" | { estado: "omitida"; status: number };

// GET /config: 200 = ya existe y se respeta tal cual. Solo con 404 se
// crea una con las columnas mínimas. Si el POST responde 409, la
// configuración ya existía. Con 400/403 (visto en staging: el GET da 404
// pero el POST se rechaza) no se bloquea el reporte: se devuelve
// "omitida" y Mercado Pago lo genera con sus columnas por defecto.
export async function asegurarConfigReporteLiberaciones(accessToken: string): Promise<ResultadoConfigLiberaciones> {
  const res = await llamar(accessToken, "/config");
  if (res.ok) return "existente";
  if (res.status !== 404) throw new ErrorLiberacionesMp(codigoPorStatus(res.status), res.status);

  const creada = await llamar(accessToken, "/config", {
    method: "POST",
    body: {
      file_name_prefix: PREFIJO_REPORTE_LIBERACIONES,
      columns: COLUMNAS_MINIMAS_LIBERACIONES.map((key) => ({ key })),
      display_timezone: "GMT-05",
      include_withdrawal_at_end: true,
      frequency: { hour: 0, type: "monthly", value: 1 },
    },
  });
  if (creada.ok) return "creada";
  if (creada.status === 409) return "existente";
  if (creada.status === 400 || creada.status === 403) return { estado: "omitida", status: creada.status };
  throw new ErrorLiberacionesMp("mp_sin_config", creada.status);
}

// ---------- Solicitar, listar y descargar ----------

const DIAS_DEL_REPORTE = 7;
const MARGEN_FIN_MS = 2 * 60_000;

// Últimos 7 días hasta now − 2 min: nunca una fecha futura para Mercado
// Pago. En UTC, sin milisegundos.
export function rangoReporteLiberaciones(ahora: Date): { beginDateIso: string; endDateIso: string } {
  const fin = new Date(ahora.getTime() - MARGEN_FIN_MS);
  const inicio = new Date(fin.getTime() - DIAS_DEL_REPORTE * 86_400_000);
  const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
  return { beginDateIso: iso(inicio), endDateIso: iso(fin) };
}

export type SolicitudReporteLiberaciones = { fileName: string } | { taskId: string };

export async function solicitarReporteLiberaciones(
  accessToken: string,
  beginDateIso: string,
  endDateIso: string
): Promise<SolicitudReporteLiberaciones> {
  const res = await llamar(accessToken, "", { method: "POST", body: { begin_date: beginDateIso, end_date: endDateIso } });
  if (!res.ok) throw new ErrorLiberacionesMp(codigoPorStatus(res.status), res.status);
  // Según la doc de Mercado Pago, 203 = el reporte NO se creó: hay que
  // reintentar más tarde.
  if (res.status === 203) throw new ErrorLiberacionesMp("mp_reporte_no_creado", 203);
  const cuerpo = (await jsonSeguro(res)) as { file_name?: unknown; id?: unknown; task_id?: unknown } | null;
  if (cuerpo && typeof cuerpo.file_name === "string" && cuerpo.file_name) return { fileName: cuerpo.file_name };
  const id = cuerpo?.task_id ?? cuerpo?.id;
  if (typeof id === "string" || typeof id === "number") return { taskId: String(id) };
  // 202 sin cuerpo útil: igual quedó pedido; se reconoce después por fecha.
  return { taskId: "solicitado" };
}

// GET /task/{id}: estado de un reporte pedido ("pending", "processing",
// "processed", "failed", "deleted") y, cuando está listo, su file_name.
export type TareaReporteLiberaciones = { status: string; fileName: string | null };

export async function consultarTareaReporteLiberaciones(accessToken: string, taskId: string): Promise<TareaReporteLiberaciones> {
  const res = await llamar(accessToken, `/task/${encodeURIComponent(taskId)}`);
  if (!res.ok) throw new ErrorLiberacionesMp(codigoPorStatus(res.status), res.status);
  const cuerpo = (await jsonSeguro(res)) as { status?: unknown; file_name?: unknown } | null;
  return {
    status: typeof cuerpo?.status === "string" ? cuerpo.status.toLowerCase() : "",
    fileName: typeof cuerpo?.file_name === "string" && cuerpo.file_name ? cuerpo.file_name : null,
  };
}

export type ReporteLiberacionesListado = {
  id: string | null;
  fileName: string;
  creadoTs: Date | null;
  listo: boolean;
};

export async function listarReportesLiberaciones(accessToken: string): Promise<ReporteLiberacionesListado[]> {
  const res = await llamar(accessToken, "/list");
  if (!res.ok) throw new ErrorLiberacionesMp(codigoPorStatus(res.status), res.status);
  const cuerpo = await jsonSeguro(res);
  const lista = Array.isArray(cuerpo) ? cuerpo : Array.isArray((cuerpo as { results?: unknown })?.results) ? (cuerpo as { results: unknown[] }).results : [];
  return lista.flatMap((item): ReporteLiberacionesListado[] => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    if (typeof r.file_name !== "string" || !r.file_name) return [];
    const fecha = [r.date_created, r.generation_date, r.last_modified].find((v): v is string => typeof v === "string");
    const creado = fecha ? new Date(fecha) : null;
    return [
      {
        id: typeof r.id === "string" || typeof r.id === "number" ? String(r.id) : null,
        fileName: r.file_name,
        creadoTs: creado && !Number.isNaN(creado.getTime()) ? creado : null,
        // Con status, solo "processed" está listo (pending, processing,
        // failed y deleted no). Sin status, se asume listo.
        listo: typeof r.status === "string" ? r.status.toLowerCase() === "processed" : true,
      },
    ];
  });
}

// file_name viene de Mercado Pago, pero igual se valida antes de armar la
// URL: sin "/", "..", ni caracteres raros (evita path traversal).
export function esNombreReporteValido(fileName: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(fileName) && fileName !== "." && fileName !== "..";
}

export async function descargarReporteLiberaciones(accessToken: string, fileName: string): Promise<string> {
  if (!esNombreReporteValido(fileName)) throw new ErrorLiberacionesMp("mp_sin_datos");
  const res = await llamar(accessToken, `/${encodeURIComponent(fileName)}`);
  if (!res.ok) throw new ErrorLiberacionesMp(codigoPorStatus(res.status), res.status);
  return res.text();
}

// ---------- CSV → saldo (puro) ----------

export type SaldoLiberaciones = {
  saldo: string; // exactamente 2 decimales, compatible con aCentavos
  moneda: string;
  fecha: string | null; // AAAA-MM-DD (Bogotá) del último registro
};

function detectarSeparador(primeraLinea: string): "," | ";" {
  let comas = 0;
  let puntoYComa = 0;
  let enComillas = false;
  for (const c of primeraLinea) {
    if (c === '"') enComillas = !enComillas;
    else if (!enComillas && c === ",") comas++;
    else if (!enComillas && c === ";") puntoYComa++;
  }
  return puntoYComa > comas ? ";" : ",";
}

function parsearCsv(texto: string, sep: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') enComillas = false;
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((v) => v.trim() !== ""));
}

// "1234.5" / "-1.234,56" / "1,234.56" → "1234.50" / "-1234.56". null si no
// es un número. Más de 2 decimales se redondean (mitad hacia afuera).
export function montoADosDecimales(valor: string): string | null {
  let t = valor.trim().replace(/\s/g, "");
  if (!t) return null;
  const ultimaComa = t.lastIndexOf(",");
  const ultimoPunto = t.lastIndexOf(".");
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    t = ultimaComa > ultimoPunto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    t = t.replace(",", ".");
  }
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const decimales = (m[3] ?? "").padEnd(3, "0");
  let centavos = BigInt(m[2]) * BigInt(100) + BigInt(decimales.slice(0, 2));
  if (Number(decimales[2]) >= 5) centavos += BigInt(1);
  const negativo = m[1] === "-" && centavos !== BigInt(0);
  const texto = `${centavos / BigInt(100)}.${(centavos % BigInt(100)).toString().padStart(2, "0")}`;
  return negativo ? `-${texto}` : texto;
}

function restar(a: string, b: string): string {
  const c = (s: string) => {
    const neg = s.startsWith("-");
    const [ent, dec] = s.replace("-", "").split(".");
    const v = BigInt(ent) * BigInt(100) + BigInt(dec);
    return neg ? -v : v;
  };
  const r = c(a) - c(b);
  const abs = r < BigInt(0) ? -r : r;
  const texto = `${abs / BigInt(100)}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
  return r < BigInt(0) ? `-${texto}` : texto;
}

function fechaDeRegistro(valor: string): string | null {
  const t = valor.trim();
  if (!t) return null;
  // Con hora: se pasa al día de Bogotá.
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return diaBogota(d);
  }
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  if (iso) return iso[1];
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

// Busca la fila RECORD_TYPE = total: BALANCE_AMOUNT si es numérico; si no,
// NET_CREDIT_AMOUNT − NET_DEBIT_AMOUNT. Sin fila total: el último
// BALANCE_AMOUNT numérico. null si el CSV no trae un saldo legible.
export function extraerSaldoDeCsvLiberaciones(csvTexto: string): SaldoLiberaciones | null {
  const texto = csvTexto.replace(/^﻿/, "");
  const primeraLinea = texto.split(/\r?\n/, 1)[0] ?? "";
  if (!primeraLinea.trim()) return null;
  const filas = parsearCsv(texto, detectarSeparador(primeraLinea));
  if (filas.length < 2) return null;

  const encabezados = filas[0].map((h) => h.trim().toUpperCase());
  const col = (nombre: string) => encabezados.indexOf(nombre);
  const iTipo = col("RECORD_TYPE");
  const iBalance = col("BALANCE_AMOUNT");
  const iCredito = col("NET_CREDIT_AMOUNT");
  const iDebito = col("NET_DEBIT_AMOUNT");
  const iMoneda = col("CURRENCY");
  const iFecha = col("DATE");
  if (iBalance < 0 && (iCredito < 0 || iDebito < 0)) return null;

  const datos = filas.slice(1);
  const valor = (fila: string[], i: number) => (i >= 0 ? (fila[i] ?? "").trim() : "");

  let saldo: string | null = null;
  let filaSaldo: string[] | null = null;
  const total = iTipo >= 0 ? [...datos].reverse().find((f) => valor(f, iTipo).toLowerCase() === "total") : undefined;
  if (total) {
    saldo = montoADosDecimales(valor(total, iBalance));
    if (saldo === null) {
      const credito = montoADosDecimales(valor(total, iCredito));
      const debito = montoADosDecimales(valor(total, iDebito));
      if (credito !== null && debito !== null) saldo = restar(credito, debito);
    }
    if (saldo !== null) filaSaldo = total;
  }
  if (saldo === null) {
    for (let i = datos.length - 1; i >= 0; i--) {
      const s = montoADosDecimales(valor(datos[i], iBalance));
      if (s !== null) {
        saldo = s;
        filaSaldo = datos[i];
        break;
      }
    }
  }
  if (saldo === null || filaSaldo === null) return null;

  let moneda = "COP";
  if (iMoneda >= 0) {
    const candidatas = [filaSaldo, ...[...datos].reverse()].map((f) => valor(f, iMoneda).toUpperCase());
    const valida = candidatas.find((m) => /^[A-Z]{3}$/.test(m));
    if (!valida) return null;
    moneda = valida;
  }

  // Fecha del último registro con fecha legible (la fila total suele no
  // traer DATE).
  let fecha: string | null = null;
  if (iFecha >= 0) {
    for (let i = datos.length - 1; i >= 0 && fecha === null; i--) fecha = fechaDeRegistro(valor(datos[i], iFecha));
  }

  return { saldo, moneda, fecha };
}
