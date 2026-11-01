import { ETIQUETA_ESTIMADO } from "@/lib/ml/estimacionVentas";

// Issue #196 (apoya #195/#175) — "Hoy" y "~30 días" en el panel de
// seguimiento necesitan unidades vendidas en un período, no el
// acumulado histórico crudo que guarda cada foto. Mismo criterio real
// ya confirmado en lib/seguimiento/alertas.ts (alertasDeVendidos):
// `vendidos` es sold_quantity, un contador ACUMULADO que Mercado Libre
// nunca hace bajar — la resta entre dos fotos reales SÍ es una venta
// real confirmada, nunca una estimación.
//
// Puro, sin Postgres ni fetch — separado de lib/seguimiento/seguimientos.ts
// (que sí hace las consultas) para poder probar la regla de negocio
// sola, igual que compararFotos/alertasDeVendidos en alertas.ts.

// Pedido explícito: nunca inventar un número cuando falta un dato (null
// si cualquiera de las dos fotos no trajo `vendidos`) y nunca devolver
// un negativo — `vendidos` nunca debería bajar entre dos fotos reales;
// si el resto da negativo es un dato dudoso (reinicio de contador del
// lado de Mercado Libre, fotos fuera de orden, etc.), nunca una "venta
// negativa" fabricada — se trata igual que "no hay dato confiable".
export function ventasDelPeriodo(actual: number | null, anterior: number | null): number | null {
  if (actual == null || anterior == null) return null;
  const diferencia = actual - anterior;
  return diferencia < 0 ? null : diferencia;
}

// Issue #222 — ventaja real sobre Selltrix: cuando el producto YA está
// en Seguimiento con suficiente historial real (ver buscarMedicionSiExiste
// en lib/seguimiento/seguimientos.ts), hay un número MEDIDO (resta de
// dos fotos reales, arriba) en vez de la fórmula estimada de Selltrix
// (lib/ml/estimacionVentas.ts). Medido gana siempre que exista — nunca
// se promedia ni se mezcla con el estimado, y nunca se etiqueta un
// número medido como si fuera estimado o viceversa.
export const ETIQUETA_MEDIDO = "Medido";

export type VentasMesConEtiqueta = { valor: number | null; etiqueta: typeof ETIQUETA_MEDIDO | typeof ETIQUETA_ESTIMADO };

// Puro — a esta función ya le llega el medido (o null) resuelto por
// buscarMedicionSiExiste y el estimado (o null) resuelto por
// ventasMesEst(); acá no se toca Postgres ni se decide la ventana de
// 7 días, solo la regla "cuál mostrar".
export function elegirVentasMes(estimado: number | null, medido: number | null): VentasMesConEtiqueta {
  if (medido != null) return { valor: medido, etiqueta: ETIQUETA_MEDIDO };
  return { valor: estimado, etiqueta: ETIQUETA_ESTIMADO };
}
