// Retry-After de Mercado Libre. El header gana al backoff propio, con
// tope para que un valor enorme no se coma el presupuesto de la corrida.
// Acepta segundos o una fecha HTTP.

export function msDeReintento429(baseMs: number, retryAfterMs: number | null): number {
  const header = retryAfterMs == null ? 0 : Math.min(Math.max(0, retryAfterMs), 60_000);
  return Math.max(baseMs, header);
}

export function leerRetryAfterMs(valor: string | null, ahora = Date.now()): number | null {
  if (!valor) return null;
  const texto = valor.trim();
  if (/^\d+(\.\d+)?$/.test(texto)) return msDeReintento429(0, Math.round(Number(texto) * 1000));
  const fecha = Date.parse(texto);
  if (Number.isNaN(fecha)) return null;
  return msDeReintento429(0, fecha - ahora);
}
