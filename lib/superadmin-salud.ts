// Salud de conexiones para /superadmin/conexiones (25-nov) — agregaciones
// puras (sin base ni Next), como lib/superadmin-metricas.ts. Solo conteos
// por empresa (decisión D8). La lectura está en lib/superadmin.ts
// (listarSaludConexiones).

// Mismos umbrales que la función SQL (solo para explicarlos en pantalla).
export const HORAS_SIN_RENOVAR = 24;
export const HORAS_AVISO_ATRASADO = 1;

export type SaludEmpresa = {
  empresaId: string;
  nombre: string;
  estado: string;
  mlConectadas: number;
  mlDesconectadas: number;
  mlSinRenovar: number;
  avisosAtrasados: number;
  publicidadConError: number;
  falabellaDesconectadas: number;
};

// Cuántos problemas tiene una empresa: cada cuenta caída, cada aviso
// atrasado y cada cuenta con publicidad en error suma uno. «Sin ninguna
// cuenta de Mercado Libre conectada» (habiendo tenido alguna) también.
// Una empresa suspendida no cuenta: sus procesos están parados a propósito.
export function problemasDe(e: SaludEmpresa): number {
  if (e.estado === "suspendida") return 0;
  const sinNingunaMl = e.mlConectadas === 0 && e.mlDesconectadas > 0 ? 1 : 0;
  return e.mlDesconectadas + e.mlSinRenovar + e.avisosAtrasados + e.publicidadConError + e.falabellaDesconectadas + sinNingunaMl;
}

export type ResumenSalud = {
  empresasConProblemas: number;
  mlDesconectadas: number;
  mlSinRenovar: number;
  avisosAtrasados: number;
  publicidadConError: number;
  falabellaDesconectadas: number;
};

// Puro: totales de la plataforma (sin las empresas suspendidas).
export function resumirSalud(filas: SaludEmpresa[]): ResumenSalud {
  const activas = filas.filter((f) => f.estado !== "suspendida");
  const suma = (k: keyof Omit<ResumenSalud, "empresasConProblemas">) => activas.reduce((t, f) => t + f[k], 0);
  return {
    empresasConProblemas: activas.filter((f) => problemasDe(f) > 0).length,
    mlDesconectadas: suma("mlDesconectadas"),
    mlSinRenovar: suma("mlSinRenovar"),
    avisosAtrasados: suma("avisosAtrasados"),
    publicidadConError: suma("publicidadConError"),
    falabellaDesconectadas: suma("falabellaDesconectadas"),
  };
}

// Puro: primero las que tienen más problemas; a igualdad, por nombre.
export function ordenarPorProblemas(filas: SaludEmpresa[]): SaludEmpresa[] {
  return [...filas].sort((a, b) => problemasDe(b) - problemasDe(a) || a.nombre.localeCompare(b.nombre, "es"));
}
