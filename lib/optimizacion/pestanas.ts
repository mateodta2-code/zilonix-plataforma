// Optimización — query string de las pestañas Análisis y Rendimiento:
// conservan la cuenta y el período (periodo, dias, desde, hasta). Lo que no
// sea de esa lista se descarta, nunca se reenvía lo que mande la URL.

const CLAVES_PERIODO = ["periodo", "dias", "desde", "hasta"] as const;

export function sufijoPestanas(cuentaId: string | null | undefined, periodo: Record<string, string>): string {
  const q = new URLSearchParams();
  if (cuentaId) q.set("cuenta", cuentaId);
  for (const clave of CLAVES_PERIODO) if (periodo[clave]) q.set(clave, periodo[clave]);
  const texto = q.toString();
  return texto ? `?${texto}` : "";
}
