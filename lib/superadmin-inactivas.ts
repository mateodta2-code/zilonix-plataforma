// Empresas inactivas (25-nov) — lógica pura para /superadmin/empresas.
// Solo una fecha por empresa (el último ingreso al panel), nunca quién
// entró ni qué hizo (D8).

export const DIAS_INACTIVIDAD = [7, 15, 30] as const;
export type DiasInactividad = (typeof DIAS_INACTIVIDAD)[number];

export function leerDiasInactividad(valor: string | undefined): DiasInactividad | null {
  const n = Number(valor);
  return (DIAS_INACTIVIDAD as readonly number[]).includes(n) ? (n as DiasInactividad) : null;
}

// Inactiva = activa y nadie entró en esos días. Sin registro (null) también
// cuenta: nadie ha entrado desde que se empezó a anotar. Una suspendida no
// cuenta: está parada a propósito.
export function esInactiva(e: { estado: string; ultimoIngresoTs: Date | null }, dias: number, ahora: Date): boolean {
  if (e.estado !== "activa") return false;
  if (!e.ultimoIngresoTs) return true;
  return ahora.getTime() - e.ultimoIngresoTs.getTime() > dias * 24 * 3600_000;
}

// La que lleva más tiempo sin entrar, primero (sin registro, antes que todas).
export function ordenarPorIngreso<T extends { ultimoIngresoTs: Date | null }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => (a.ultimoIngresoTs?.getTime() ?? -Infinity) - (b.ultimoIngresoTs?.getTime() ?? -Infinity));
}

export function diasSinIngresar(ultimo: Date | null, ahora: Date): number | null {
  return ultimo ? Math.floor((ahora.getTime() - ultimo.getTime()) / (24 * 3600_000)) : null;
}
