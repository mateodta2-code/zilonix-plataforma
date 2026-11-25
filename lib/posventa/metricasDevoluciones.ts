// Posventa-Devoluciones (Refs #648) — métricas de devoluciones. Funciones
// puras: reciben filas ya leídas de Mercado Libre y las ventas del periodo
// (tabla de pedidos, con RLS) y no leen ni guardan nada.

import type { FilaMetrica } from "@/lib/ml/devoluciones";

export const PERIODOS_DIAS = [30, 90] as const;
export type PeriodoDias = (typeof PERIODOS_DIAS)[number];

export function leerPeriodoDias(valor: string | string[] | undefined): PeriodoDias {
  return valor === "90" ? 90 : 30;
}

export function desdePeriodoMs(dias: number, ahoraMs: number): number {
  return ahoraMs - dias * 24 * 60 * 60 * 1000;
}

// null cuando no hay ventas: la pantalla muestra «—», nunca divide por 0.
export function porcentajeSobreVentas(devoluciones: number, ventas: number): number | null {
  if (!Number.isFinite(ventas) || ventas <= 0) return null;
  return (devoluciones / ventas) * 100;
}

export type ConteoMotivo = { motivoId: string | null; texto: string | null; cantidad: number };
export type RankingItem = { clave: string; titulo: string | null; cantidad: number };
export type CostoPorMoneda = { moneda: string; total: number };

export type ResumenMetricas = {
  cantidad: number;
  motivos: ConteoMotivo[];
  costos: CostoPorMoneda[];
  porProducto: RankingItem[];
  porCuenta: RankingItem[];
};

function topN<T extends { cantidad: number }>(mapa: Map<string, T>, n: number): T[] {
  return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, n);
}

export function calcularMetricas(filas: FilaMetrica[], tope = 5): ResumenMetricas {
  const motivos = new Map<string, ConteoMotivo>();
  const costos = new Map<string, number>();
  const productos = new Map<string, RankingItem>();
  const cuentas = new Map<string, RankingItem>();

  for (const f of filas) {
    const claveMotivo = f.motivoId ?? "sin-motivo";
    const m = motivos.get(claveMotivo) ?? { motivoId: f.motivoId, texto: f.motivoTexto, cantidad: 0 };
    motivos.set(claveMotivo, { ...m, texto: m.texto ?? f.motivoTexto, cantidad: m.cantidad + 1 });

    if (f.costo && f.costo.moneda) costos.set(f.costo.moneda, (costos.get(f.costo.moneda) ?? 0) + f.costo.monto);

    if (f.itemId) {
      const p = productos.get(f.itemId) ?? { clave: f.itemId, titulo: f.productoTitulo, cantidad: 0 };
      productos.set(f.itemId, { ...p, titulo: p.titulo ?? f.productoTitulo, cantidad: p.cantidad + 1 });
    }

    const c = cuentas.get(f.cuentaMlId) ?? { clave: f.cuentaMlId, titulo: f.nickname, cantidad: 0 };
    cuentas.set(f.cuentaMlId, { ...c, cantidad: c.cantidad + 1 });
  }

  return {
    cantidad: filas.length,
    motivos: topN(motivos, tope),
    costos: [...costos.entries()].map(([moneda, total]) => ({ moneda, total })).sort((a, b) => a.moneda.localeCompare(b.moneda)),
    porProducto: topN(productos, tope),
    porCuenta: topN(cuentas, tope),
  };
}

// Devoluciones por semana, de la más antigua a la más reciente, para la
// gráfica. Semana i empieza en desdeMs + i·7 días.
export function serieSemanal(fechas: (string | null)[], desdeMs: number, ahoraMs: number): { inicioMs: number; cantidad: number }[] {
  const SEMANA = 7 * 24 * 60 * 60 * 1000;
  const n = Math.max(1, Math.ceil((ahoraMs - desdeMs) / SEMANA));
  const serie = Array.from({ length: n }, (_, i) => ({ inicioMs: desdeMs + i * SEMANA, cantidad: 0 }));
  for (const f of fechas) {
    const ms = f ? Date.parse(f) : NaN;
    if (!Number.isFinite(ms) || ms < desdeMs || ms > ahoraMs) continue;
    serie[Math.min(n - 1, Math.floor((ms - desdeMs) / SEMANA))].cantidad += 1;
  }
  return serie;
}

// Aviso cuando el periodo trae más reclamos que el tope de lecturas.
export function avisoTope(leidos: number, hayMas: boolean): string | null {
  return hayMas ? `Calculado sobre los ${leidos} más recientes.` : null;
}
