// Revisión del PR #415: según la documentación, CreatedAt llega como
// "2025-04-03 12:00:00", sin zona horaria, y `new Date()` lo leía con la
// zona del servidor (UTC en Railway → 5 horas corridas). Es hora de
// Colombia (FACO, UTC-5 fijo, sin horario de verano). Si algún día llega
// con zona (ISO con "T" y offset/Z), se respeta tal cual.
export function parsearFechaFalabella(valor: string): Date {
  const sinZona = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(valor.trim());
  if (sinZona) return new Date(`${sinZona[1]}T${sinZona[2]}-05:00`);
  return new Date(valor);
}
