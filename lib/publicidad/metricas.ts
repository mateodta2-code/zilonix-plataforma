// Issue #254 — traduce el JSON de métricas de Product Ads (F1) a
// strings de `numeric` y enteros. Los nombres salen del glosario de
// api-research.md. Un campo que no vino queda null: no se inventa un 0.

import { DecimalInvalidoError, aEscala, normalizarDecimal, textoDeNumeroJson } from "@/lib/numeros/normalizar-decimal";

export type MetricasNormalizadas = {
  clicks: number | null;
  impresiones: number | null;
  costo: string | null;
  montoDirecto: string | null;
  montoIndirecto: string | null;
  montoTotal: string | null;
  unidadesDirectas: number | null;
  unidadesIndirectas: number | null;
  unidadesTotal: number | null;
  ventasPublicidad: number | null;
  ventasOrganicasCant: number | null;
  ventasOrganicasMonto: string | null;
  acos: string | null;
  roas: string | null;
  tacos: string | null;
  sov: string | null;
  cvr: string | null;
  ctr: string | null;
  cpc: string | null;
};

const VACIAS: MetricasNormalizadas = {
  clicks: null,
  impresiones: null,
  costo: null,
  montoDirecto: null,
  montoIndirecto: null,
  montoTotal: null,
  unidadesDirectas: null,
  unidadesIndirectas: null,
  unidadesTotal: null,
  ventasPublicidad: null,
  ventasOrganicasCant: null,
  ventasOrganicasMonto: null,
  acos: null,
  roas: null,
  tacos: null,
  sov: null,
  cvr: null,
  ctr: null,
  cpc: null,
};

function leerCrudo(fuente: Record<string, unknown>, claves: string[]): unknown {
  for (const clave of claves) {
    if (fuente[clave] != null) return fuente[clave];
  }
  return null;
}

function escalar(valor: unknown, escala: number): string | null {
  if (typeof valor === "number") return aEscala(textoDeNumeroJson(valor), escala, { origenJson: true });
  if (typeof valor === "string" && valor.trim()) return aEscala(valor.trim(), escala);
  return null;
}

function campo<K extends keyof MetricasNormalizadas>(
  nombre: K,
  leer: () => MetricasNormalizadas[K],
  destino: MetricasNormalizadas,
  invalidos: (keyof MetricasNormalizadas)[]
): void {
  try {
    const valor = leer();
    destino[nombre] = valor;
    // Ausente o null: no se marca como "leído". El upsert no escribe
    // ese null encima de un valor que ya estaba.
    if (valor == null) invalidos.push(nombre);
  } catch (error) {
    if (!(error instanceof DecimalInvalidoError)) throw error;
    destino[nombre] = null;
    invalidos.push(nombre);
  }
}

function dinero(valor: unknown): string | null {
  return escalar(valor, 2);
}

function ratio(valor: unknown): string | null {
  return escalar(valor, 4);
}

function entero(valor: unknown): number | null {
  if (valor == null) return null;
  if (typeof valor === "number" && Number.isInteger(valor) && Math.abs(valor) <= Number.MAX_SAFE_INTEGER) return valor;
  if (typeof valor === "string" && /^-?\d+$/.test(valor.trim())) {
    const n = Number(valor.trim());
    if (Number.isSafeInteger(n)) return n;
  }
  throw new DecimalInvalidoError("entero inválido");
}

export type MetricasLeidas = { metricas: MetricasNormalizadas; invalidos: (keyof MetricasNormalizadas)[] };

export function metricasDesdeApi(raw: unknown): MetricasLeidas {
  const metricas: MetricasNormalizadas = { ...VACIAS };
  const invalidos: (keyof MetricasNormalizadas)[] = [];
  if (!raw || typeof raw !== "object") return { metricas, invalidos };
  const registro = raw as Record<string, unknown>;
  const fuente =
    registro.metrics && typeof registro.metrics === "object"
      ? (registro.metrics as Record<string, unknown>)
      : registro;
  campo("clicks", () => entero(leerCrudo(fuente, ["clicks", "CLICKS"])), metricas, invalidos);
  campo("impresiones", () => entero(leerCrudo(fuente, ["prints", "PRINTS"])), metricas, invalidos);
  campo("costo", () => dinero(leerCrudo(fuente, ["cost", "COST"])), metricas, invalidos);
  campo("montoDirecto", () => dinero(leerCrudo(fuente, ["direct_amount", "DIRECT_AMOUNT"])), metricas, invalidos);
  campo("montoIndirecto", () => dinero(leerCrudo(fuente, ["indirect_amount", "INDIRECT_AMOUNT"])), metricas, invalidos);
  campo("montoTotal", () => dinero(leerCrudo(fuente, ["total_amount", "TOTAL_AMOUNT"])), metricas, invalidos);
  campo("unidadesDirectas", () => entero(leerCrudo(fuente, ["direct_units_quantity", "DIRECT_UNITS_QUANTITY"])), metricas, invalidos);
  campo("unidadesIndirectas", () => entero(leerCrudo(fuente, ["indirect_units_quantity", "INDIRECT_UNITS_QUANTITY"])), metricas, invalidos);
  campo("unidadesTotal", () => entero(leerCrudo(fuente, ["units_quantity", "UNITS_QUANTITY"])), metricas, invalidos);
  campo("ventasPublicidad", () => entero(leerCrudo(fuente, ["advertising_items_quantity", "ADVERTISING_ITEMS_QUANTITY"])), metricas, invalidos);
  campo("ventasOrganicasCant", () => entero(leerCrudo(fuente, ["organic_items_quantity", "ORGANIC_ITEMS_QUANTITY"])), metricas, invalidos);
  campo("ventasOrganicasMonto", () => dinero(leerCrudo(fuente, ["organic_units_amount", "ORGANIC_UNITS_AMOUNT"])), metricas, invalidos);
  campo("acos", () => ratio(leerCrudo(fuente, ["acos", "ACOS"])), metricas, invalidos);
  campo("roas", () => ratio(leerCrudo(fuente, ["roas", "ROAS"])), metricas, invalidos);
  campo("tacos", () => ratio(leerCrudo(fuente, ["tacos", "TACOS"])), metricas, invalidos);
  campo("sov", () => ratio(leerCrudo(fuente, ["sov", "SOV"])), metricas, invalidos);
  campo("cvr", () => ratio(leerCrudo(fuente, ["cvr", "CVR"])), metricas, invalidos);
  campo("ctr", () => ratio(leerCrudo(fuente, ["ctr", "CTR"])), metricas, invalidos);
  campo("cpc", () => dinero(leerCrudo(fuente, ["cpc", "CPC"])), metricas, invalidos);
  return { metricas, invalidos };
}

// acos = 100 / roas. La doc dice que acos_target se calcula así y que
// puede ya no venir (api-research §2). Se rotula calculado en la fila.
export function acosDesdeRoas(roas: string): string | null {
  const normal = normalizarDecimal(roas);
  if (normal.startsWith("-")) return null;
  const [enteroTxt, fraccionTxt = ""] = normal.split(".");
  const escala = fraccionTxt.length;
  const divisor = BigInt(enteroTxt + fraccionTxt);
  if (divisor === BigInt(0)) return null;
  const escalaSalida = 4;
  const numerador = BigInt(100) * BigInt(10) ** BigInt(escalaSalida + escala);
  const cociente = numerador / divisor;
  const resto = numerador % divisor;
  const redondeado = resto * BigInt(2) >= divisor ? cociente + BigInt(1) : cociente;
  const texto = redondeado.toString().padStart(escalaSalida + 1, "0");
  const corte = texto.length - escalaSalida;
  return `${texto.slice(0, corte)}.${texto.slice(corte)}`;
}

export type FilaDiaria = {
  fecha: string;
  entidadIdMl: string | null;
  metricas: MetricasNormalizadas;
  invalidos: (keyof MetricasNormalizadas)[];
};

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

function fechaDe(raw: Record<string, unknown>): string | null {
  const fecha = raw.date;
  return typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;
}

function idDe(raw: Record<string, unknown>): string | null {
  const id = raw.id ?? raw.campaign_id ?? raw.ad_group_id ?? raw.item_id;
  if (typeof id === "number" && Number.isSafeInteger(id)) return String(id);
  if (typeof id === "string" && /^\d+$|^MCO\d+$/.test(id)) return id;
  return null;
}

// El ejemplo de F1 para aggregation_type=DAILY en campaigns/search trae
// `date` + métricas y ningún id, y además repite la misma fecha. Hasta
// verlo en una cuenta real, dos filas del mismo día sin id no se
// fusionan: se descartan y se avisa.
export function filasDiariasDeCuenta(results: unknown[]): { filas: FilaDiaria[]; ambiguo: boolean } {
  const cuentas: FilaDiaria[] = [];
  const conId: FilaDiaria[] = [];
  const porFecha = new Map<string, number>();
  for (const raw of results) {
    if (!esRegistro(raw)) continue;
    const fecha = fechaDe(raw);
    if (!fecha) continue;
    const id = idDe(raw);
    const leidas = metricasDesdeApi(raw);
    const fila: FilaDiaria = { fecha, entidadIdMl: id, metricas: leidas.metricas, invalidos: leidas.invalidos };
    if (id && (raw.id != null || raw.campaign_id != null)) conId.push(fila);
    else {
      porFecha.set(fecha, (porFecha.get(fecha) ?? 0) + 1);
      cuentas.push(fila);
    }
  }
  const ambiguo = [...porFecha.values()].some((n) => n > 1);
  return { filas: ambiguo ? conId : [...conId, ...cuentas], ambiguo };
}

export function filasDiariasDeCampana(results: unknown[], campanaId: string): FilaDiaria[] {
  const filas: FilaDiaria[] = [];
  for (const raw of results) {
    if (!esRegistro(raw)) continue;
    const fecha = fechaDe(raw);
    if (!fecha) continue;
    const leidas = metricasDesdeApi(raw);
    filas.push({ fecha, entidadIdMl: idDe(raw) ?? campanaId, metricas: leidas.metricas, invalidos: leidas.invalidos });
  }
  return filas;
}
