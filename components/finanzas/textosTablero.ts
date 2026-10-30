import { formatearMonto } from "@/lib/panel-kpis";
import { textoVariacion, type MontoMoneda, type TableroMes, type UtilidadMes } from "@/lib/finanzas/tablero";

// Issue #143 — textos de las tarjetas del tablero del mes, compartidos
// por /panel/finanzas y el bloque de Finanzas de Inicio
// (BloqueInicioFinanzas.tsx): las mismas cifras se dicen igual en las
// dos pantallas.

export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

// "COP 1.234.000 · USD 50"; sin ventas, "COP 0" (mismo criterio que
// Ventas del mes de /panel).
export function porMoneda(tablero: TableroMes, campo: "actual" | "promedioActual"): string {
  if (tablero.recaudo.length === 0) return "COP 0";
  return tablero.recaudo.map((r) => `${r.moneda} ${formatearMonto(r[campo])}`).join(" · ");
}

// "COP 1.234.000 · USD 50" de una lista de montos; vacía → "—".
export function montosPorMoneda(montos: MontoMoneda[]): string {
  if (montos.length === 0) return "—";
  return montos.map((m) => `${m.moneda} ${formatearMonto(m.monto)}`).join(" · ");
}

// Una línea de variación por moneda (con el código solo si hay varias).
export function variacionesPorMoneda(tablero: TableroMes, campo: "variacion" | "variacionPromedio"): string[] {
  const sinSincronizarAntes = tablero.sinSincronizar.anterior > 0;
  if (tablero.recaudo.length === 0) return [textoVariacion(null, sinSincronizarAntes)];
  const varias = tablero.recaudo.length > 1;
  return tablero.recaudo.map((r) => `${varias ? `${r.moneda}: ` : ""}${textoVariacion(r[campo], sinSincronizarAntes)}`);
}

// "COP 1.234.567" con la moneda del mes (sin ventas, COP); "—" si no se
// puede sumar (sin costos o varias monedas).
export function valorUtilidad(tablero: TableroMes, utilidad: UtilidadMes): string {
  if (utilidad.utilidad === null) return "—";
  return `${tablero.recaudo[0]?.moneda ?? "COP"} ${formatearMonto(utilidad.utilidad)}`;
}

// El aviso de ventas sin sincronizar del mes en curso ([] si no faltan).
export function avisoFaltanVentas(tablero: TableroMes): string[] {
  const faltan = tablero.sinSincronizar.actual;
  return faltan > 0 ? [`Faltan ${faltan} ${faltan === 1 ? "venta" : "ventas"} por sincronizar · usa “Traer ventas de este mes” en Finanzas → Ventas`] : [];
}

// Las líneas de la tarjeta «Utilidad del mes (antes de publicidad)».
export function detalleUtilidadMes(tablero: TableroMes, utilidad: UtilidadMes): string[] {
  const moneda = tablero.recaudo[0]?.moneda ?? "COP";
  return [
    "Suma de la utilidad de cada venta con costo: recaudo − comisión ML − flete ML − costo − packing − envío. Sin restar publicidad.",
    ...(utilidad.ventasSinCosto > 0
      ? [`${plural(utilidad.ventasSinCosto, "venta", "ventas")} sin costo (${moneda} ${formatearMonto(utilidad.recaudoSinCosto)}) no entran`]
      : []),
    ...(utilidad.rechazadas > 0 ? [`${plural(utilidad.rechazadas, "venta no se pudo", "ventas no se pudieron")} calcular · revisa Finanzas → Ventas`] : []),
    ...(utilidad.variasMonedas ? ["Hay ventas en varias monedas: la utilidad por moneda llega después"] : []),
    ...(!utilidad.variasMonedas && utilidad.utilidad === null ? ["Ninguna venta del mes tiene costo cargado"] : []),
    ...avisoFaltanVentas(tablero),
  ];
}
