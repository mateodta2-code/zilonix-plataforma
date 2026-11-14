export function formatoFechaForo(fecha: Date): string {
  return new Date(fecha).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
}
