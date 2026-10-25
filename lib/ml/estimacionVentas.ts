// Issue #197 — pedido urgente de Sharel: "no dejar ventas en cero" en
// /panel/investigacion, estimando "al estilo Selltrix" (el competidor
// que ella usa de referencia) mientras no haya algo mejor confirmado.
// Si el PR del issue #201 ya dejó un helper equivalente mergeado a
// main en este mismo path, este archivo se reemplaza por ese — hasta
// entonces, esta es la versión temporal que pide la tarea.
//
// `vendidos` (sold_quantity de Mercado Libre) es un ACUMULADO
// histórico desde que se creó la publicación, nunca una tasa mensual
// — convertirlo a "ventas/mes" SIEMPRE es una proyección, incluso
// cuando el vendidos de partida es 100% real (ver lib/ml/cliente.ts,
// OfertaMl.vendidos). El ajuste de abajo corrige dos sesgos conocidos
// hacia abajo del vendidos crudo — nunca los dos juntos, el primero
// que aplique:
//   - ×2.2 si la publicación es Full: más visibilidad/velocidad de
//     venta de la que refleja el promedio histórico completo (el
//     ritmo ACTUAL suele ser más alto que acumulado ÷ días enteros).
//   - ×1.55 si el vendidos viene de la etiqueta redondeada "+N
//     vendidos" de Mercado Libre, nunca del sold_quantity exacto —
//     esa etiqueta es un piso, no el número real.
//   - ×1 (sin ajuste) si el vendidos es exacto y la publicación no es
//     Full — se confía en el número tal cual.
// El resultado SIEMPRE se etiqueta "estimado (estilo Selltrix)" —
// nunca se muestra como si Mercado Libre lo hubiera confirmado.
const AJUSTE_FULL = 2.2;
const AJUSTE_ETIQUETA_REDONDEADA = 1.55;
const DIAS_MINIMO = 1;
const DIAS_POR_MES = 30;
const MS_POR_DIA = 86_400_000;

export const ETIQUETA_ESTIMACION_SELLTRIX = "estimado (estilo Selltrix)";

export function factorAjusteVentas(esFull: boolean, vendidosEsExacto: boolean): number {
  if (esFull) return AJUSTE_FULL;
  if (!vendidosEsExacto) return AJUSTE_ETIQUETA_REDONDEADA;
  return 1;
}

export type EstimacionVentasMes = {
  ventasMes: number;
  facturacionMes: number | null;
  etiqueta: typeof ETIQUETA_ESTIMACION_SELLTRIX;
};

export function estimarVentasMes(args: {
  vendidos: number;
  esFull: boolean;
  vendidosEsExacto: boolean;
  fechaCreacion: string | Date;
  precio?: number | null;
  ahoraMs?: number;
}): EstimacionVentasMes | null {
  const { vendidos, esFull, vendidosEsExacto, fechaCreacion, precio, ahoraMs } = args;
  if (!Number.isFinite(vendidos) || vendidos < 0) return null;
  const creadoMs = new Date(fechaCreacion).getTime();
  if (!Number.isFinite(creadoMs)) return null;

  const ahora = ahoraMs ?? Date.now();
  // Mínimo 1 día — una publicación de hoy mismo no puede dividir por 0
  // ni dar un promedio mensual absurdo por una fecha futura mal leída.
  const diasTranscurridos = Math.max(DIAS_MINIMO, Math.round((ahora - creadoMs) / MS_POR_DIA));
  const factor = factorAjusteVentas(esFull, vendidosEsExacto);
  const ventasMes = Math.round(((vendidos * factor * DIAS_POR_MES) / diasTranscurridos) * 10) / 10;
  const facturacionMes = precio != null && Number.isFinite(precio) ? Math.round(ventasMes * precio) : null;

  return { ventasMes, facturacionMes, etiqueta: ETIQUETA_ESTIMACION_SELLTRIX };
}
