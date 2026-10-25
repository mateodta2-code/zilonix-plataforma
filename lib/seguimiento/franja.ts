// Issue #244 (decisión de Sharel, 2026-10-25) — "2 fotos al día": antes
// de esto, seguimiento_fotos tenía como mucho UNA foto por
// seguimiento_id+fecha (índice único). Ahora puede tener hasta DOS,
// una por "franja" del día — así se puede medir una venta PARCIAL de
// hoy (foto de la tarde − foto de la mañana), sin esperar al cierre
// del día siguiente. Puro, sin Postgres ni fetch, para poder probar la
// regla del corte sola.

export type Franja = "manana" | "tarde";

// America/Bogota no observa horario de verano: es UTC-5 todo el año
// (mismo criterio y mismo valor que lib/panel-kpis.ts/lib/filtros-listado.ts).
// Railway corre en UTC, así que el reloj de Bogotá se lee restando este
// offset y usando getters UTC, sin depender de la zona del servidor.
const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000;

// Punto medio entre las dos corridas reales del cron (~09:00 y ~18:00
// Bogotá, ver .github/workflows/revision-diaria-seguimiento.yml) — con
// margen de sobra para una corrida manual o un atraso puntual de
// GitHub Actions (schedule nunca garantiza el minuto exacto). Antes de
// esta hora en Bogotá es "manana", desde esta hora es "tarde".
const HORA_CORTE_BOGOTA = 13;

// La franja (mañana/tarde) en la que cae un instante, según el reloj
// de Bogotá — nunca el huso horario del servidor (Railway/CI corren en
// UTC).
export function franjaBogota(ahora: Date = new Date()): Franja {
  const relojBogota = new Date(ahora.getTime() - OFFSET_BOGOTA_MS);
  return relojBogota.getUTCHours() < HORA_CORTE_BOGOTA ? "manana" : "tarde";
}

// El instante exacto (UTC) en que la franja de HOY cambia de "manana"
// a "tarde" — mismo corte que franjaBogota(), pero como Date, para
// poder comparar `ultima_revision_ts` con lt()/gte() en SQL sin
// reimplementar la cuenta de huso horario ahí (ver
// obtenerSeguimientosPendientesDeHoy, lib/trabajos/revisionDiariaSeguimiento.ts).
// `hoyMedianocheUtc` tiene que ser la medianoche UTC del día que se
// quiere evaluar (mismo valor que fechaDeHoy() en ese archivo).
export function limiteFranjaDeHoy(hoyMedianocheUtc: Date): Date {
  return new Date(hoyMedianocheUtc.getTime() + OFFSET_BOGOTA_MS + HORA_CORTE_BOGOTA * 60 * 60 * 1000);
}
