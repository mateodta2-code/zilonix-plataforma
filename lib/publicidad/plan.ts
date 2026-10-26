// Issue #254 — qué rango pedir en cada corrida. La API solo guarda 90
// días y la atribución se mueve 14 días (api-research §2). La primera
// vez se cubren 62 días (mes en curso + el mismo corte del mes anterior)
// en tramos de 7, para poder retomar si una corrida se corta. Después,
// siempre los últimos 15.
//
// La zona del corte de Mercado Libre no está documentada (§8.6). El
// "hoy" del rango es el calendario de Bogotá. La fecha que se guarda es
// la que devuelve la API, no esta.

export const DIAS_BACKFILL = 62;
export const DIAS_INCREMENTAL = 15;
export const DIAS_TRAMO = 7;
export const DIAS_MAX_API = 90;
export const MINUTOS_REFRESCO_MANUAL = 10;
export const MINUTOS_EN_CURSO_ABANDONADO = 30;
// El curl del workflow corta a los 300 s. La corrida se detiene antes
// para poder cerrar la fila; lo que no entró queda para la siguiente.
export const PRESUPUESTO_CORRIDA_MS = 240_000;
export const MARGEN_CIERRE_MS = 15_000;
export const MAX_REINTENTOS_TRAMO = 3;

export { leerRetryAfterMs, msDeReintento429 } from "@/lib/ml/reintento-429";

const DIA_MS = 86_400_000;

export function hoyBogota(ahora: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

export function restarDiasIso(iso: string, dias: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("fecha inválida");
  const [anio, mes, dia] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  return fecha.toISOString().slice(0, 10);
}

export function diasEntreInclusive(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / DIA_MS) + 1;
}

export function diasDelRango(desde: string, hasta: string): string[] {
  const total = diasEntreInclusive(desde, hasta);
  if (total < 1 || total > DIAS_MAX_API) throw new Error("rango fuera de los 90 días de la API");
  const dias: string[] = [];
  for (let i = 0; i < total; i++) dias.push(restarDiasIso(desde, -i));
  return dias;
}

export type UltimaSync = {
  estado: "en_curso" | "ok" | "parcial" | "error";
  rangoDesde: string | null;
  rangoHasta: string | null;
  iniciadaTs: Date;
};

export type Tramo = {
  desde: string;
  hasta: string;
  // true cuando este tramo llega al inicio del backfill, o cuando ya
  // no hay backfill (corrida incremental).
  cierraBackfill: boolean;
};

export function decidirTramo(
  hoy: string,
  ultima: UltimaSync | null,
  yaTerminoBackfill: boolean,
  reintentosMismoTramo = 0
): Tramo {
  const piso = restarDiasIso(hoy, DIAS_MAX_API - 1);
  const objetivo = restarDiasIso(hoy, DIAS_BACKFILL - 1);
  const inicioObjetivo = objetivo < piso ? piso : objetivo;

  if (yaTerminoBackfill) {
    const desde = restarDiasIso(hoy, DIAS_INCREMENTAL - 1);
    return { desde: desde < piso ? piso : desde, hasta: hoy, cierraBackfill: true };
  }

  const mismoTramoAgotado = reintentosMismoTramo >= MAX_REINTENTOS_TRAMO;
  const reintenta =
    ultima &&
    !mismoTramoAgotado &&
    (ultima.estado === "error" || ultima.estado === "en_curso") &&
    ultima.rangoDesde &&
    ultima.rangoHasta &&
    ultima.rangoDesde >= piso &&
    ultima.rangoHasta <= hoy;

  if (reintenta && ultima.rangoDesde && ultima.rangoHasta) {
    return {
      desde: ultima.rangoDesde,
      hasta: ultima.rangoHasta,
      cierraBackfill: ultima.rangoDesde <= inicioObjetivo,
    };
  }

  const seguirAtras =
    ultima &&
    ultima.rangoDesde &&
    ultima.rangoDesde > inicioObjetivo &&
    (ultima.estado === "parcial" || (ultima.estado === "error" && mismoTramoAgotado));

  if (seguirAtras && ultima.rangoDesde) {
    const hasta = restarDiasIso(ultima.rangoDesde, 1);
    let desde = restarDiasIso(hasta, DIAS_TRAMO - 1);
    if (desde < inicioObjetivo) desde = inicioObjetivo;
    return { desde, hasta, cierraBackfill: desde <= inicioObjetivo };
  }

  let desde = restarDiasIso(hoy, DIAS_TRAMO - 1);
  if (desde < inicioObjetivo) desde = inicioObjetivo;
  return { desde, hasta: hoy, cierraBackfill: desde <= inicioObjetivo };
}

export function textoErrorCorto(error: unknown): string {
  const nombre = error instanceof Error ? error.name : "Error";
  const mensaje = error instanceof Error ? error.message : "";
  return `${nombre}: ${mensaje}`
    .replace(/Bearer\s+\S+/gi, "Bearer [omitido]")
    .replace(/access_token["']?\s*[:=]\s*\S+/gi, "access_token=[omitido]")
    .replace(/refresh_token["']?\s*[:=]\s*\S+/gi, "refresh_token=[omitido]")
    .replace(/client_secret["']?\s*[:=]\s*\S+/gi, "client_secret=[omitido]")
    .slice(0, 180);
}

// Nunca sincronizadas primero; después la última corrida más vieja.
// Así una corrida diaria no vuelve a tomar siempre las mismas primeras
// cuentas ordenadas por fecha de alta.
export type CuentaParaOrden = { id: string; creadoTs: number; ultimaSyncTs: number | null };

export function ordenarCuentasParaSync<T extends CuentaParaOrden>(cuentas: T[]): T[] {
  return [...cuentas].sort((a, b) => {
    if (a.ultimaSyncTs == null && b.ultimaSyncTs != null) return -1;
    if (a.ultimaSyncTs != null && b.ultimaSyncTs == null) return 1;
    if (a.ultimaSyncTs != null && b.ultimaSyncTs != null && a.ultimaSyncTs !== b.ultimaSyncTs) {
      return a.ultimaSyncTs - b.ultimaSyncTs;
    }
    if (a.creadoTs !== b.creadoTs) return a.creadoTs - b.creadoTs;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function backfillRealmenteCerrado(filas: { estado: string; cierraBackfill: boolean }[]): boolean {
  return filas.some((fila) => fila.estado === "ok" && fila.cierraBackfill);
}

// Un corte por tiempo no es un fallo de Mercado Libre: no consume el
// tope de reintentos del tramo. El texto lo arma textoErrorCorto.
export function esCorteDeTiempo(error: string | null): boolean {
  return Boolean(error && error.startsWith("CorridaIncompletaError"));
}

export function contarReintentosMismoTramo(
  filas: { estado: string; rangoDesde: string | null; rangoHasta: string | null; error: string | null }[]
): number {
  const ultima = filas[0];
  if (!ultima) return 0;
  if (ultima.estado !== "error" && ultima.estado !== "en_curso") return 0;
  let n = 0;
  for (const fila of filas) {
    if (fila.rangoDesde !== ultima.rangoDesde || fila.rangoHasta !== ultima.rangoHasta) break;
    if (esCorteDeTiempo(fila.error)) continue;
    if (fila.estado === "error" || fila.estado === "en_curso") n += 1;
    else break;
  }
  return n;
}

// Un 4xx al leer el costo de un ítem no puede tumbar la cuenta: el
// backfill de métricas ya guardado sigue. El corte por tiempo sí cierra
// el tramo para retomarlo. Cualquier otro fallo (token, 5xx) corta.
export function decisionAnteErrorDeCosto(error: unknown): "seguir" | "cerrar-tramo" | "fallar" {
  const nombre = error instanceof Error ? error.name : "";
  if (nombre === "CorridaIncompletaError") return "cerrar-tramo";
  if (nombre === "MlRespuestaInesperadaError") return "seguir";
  return "fallar";
}

export type DecisionRefresco =
  | { permitir: true }
  | { permitir: false; aviso: string };

export function evaluarRefrescoManual(ahora: Date, ultima: UltimaSync | null): DecisionRefresco {
  if (!ultima) return { permitir: true };
  const edadMs = ahora.getTime() - ultima.iniciadaTs.getTime();
  const enCursoVigente = ultima.estado === "en_curso" && edadMs < MINUTOS_EN_CURSO_ABANDONADO * 60_000;
  if (enCursoVigente) {
    return { permitir: false, aviso: "Ya hay una actualización de publicidad en curso para esta cuenta." };
  }
  if (edadMs >= 0 && edadMs < MINUTOS_REFRESCO_MANUAL * 60_000) {
    return {
      permitir: false,
      aviso: `Esta cuenta se actualizó hace menos de ${MINUTOS_REFRESCO_MANUAL} minutos. Esperá un poco para no pedir de más a Mercado Libre.`,
    };
  }
  return { permitir: true };
}
