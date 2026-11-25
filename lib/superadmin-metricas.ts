// Agregaciones puras de /superadmin/metricas (sin base ni Next). Solo
// conteos (decisión D8): nunca productos, pedidos ni compradores.
import type { EmpresaConConteo, Plan } from "@/lib/superadmin";
import { PLANES } from "@/lib/superadmin";

export type EmpresaParaMetricas = Pick<EmpresaConConteo, "creadoTs" | "plan" | "estado" | "miembros" | "cuentasMl" | "cuentasFalabella">;

export type SemanaEmpresas = { inicio: string; empresas: number };

export type MetricasGlobales = {
  empresasPorSemana: SemanaEmpresas[];
  empresasActivas: number;
  empresasSuspendidas: number;
  empresasPorPlan: Record<Plan, number>;
  empresasConMl: number;
  empresasConFalabella: number;
  miembros: number;
  bodegasActivas: number;
};

const MS_DIA = 24 * 60 * 60 * 1000;

// Lunes 00:00 UTC de la semana de `d`.
export function inicioDeSemana(d: Date): Date {
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diasDesdeLunes = (d.getUTCDay() + 6) % 7;
  return new Date(base - diasDesdeLunes * MS_DIA);
}

export function calcularMetricas(
  empresas: EmpresaParaMetricas[],
  bodegas: { estado: string }[],
  ahora: Date,
  semanas = 8,
): MetricasGlobales {
  const lunesActual = inicioDeSemana(ahora).getTime();
  const porSemana = Array.from({ length: semanas }, (_, i) => ({
    inicio: new Date(lunesActual - (semanas - 1 - i) * 7 * MS_DIA).toISOString().slice(0, 10),
    empresas: 0,
  }));
  const empresasPorPlan = Object.fromEntries(PLANES.map((p) => [p, 0])) as Record<Plan, number>;
  const m: MetricasGlobales = {
    empresasPorSemana: porSemana,
    empresasActivas: 0,
    empresasSuspendidas: 0,
    empresasPorPlan,
    empresasConMl: 0,
    empresasConFalabella: 0,
    miembros: 0,
    bodegasActivas: bodegas.filter((b) => b.estado === "activa").length,
  };
  for (const e of empresas) {
    if (e.estado === "suspendida") m.empresasSuspendidas++;
    else m.empresasActivas++;
    if (e.plan in empresasPorPlan) empresasPorPlan[e.plan]++;
    if (e.cuentasMl > 0) m.empresasConMl++;
    if (e.cuentasFalabella > 0) m.empresasConFalabella++;
    m.miembros += e.miembros;
    const idx = Math.floor((inicioDeSemana(e.creadoTs).getTime() - (lunesActual - (semanas - 1) * 7 * MS_DIA)) / (7 * MS_DIA));
    if (idx >= 0 && idx < semanas) porSemana[idx].empresas++;
  }
  return m;
}
