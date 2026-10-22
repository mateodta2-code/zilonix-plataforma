import { and, eq, gte, lt, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidos } from "@/db/schema";
import { listarDespachosPendientes } from "@/lib/ml/despachos";
import { listarPublicacionesSinSku } from "@/lib/ml/sku";

// Tarea de KPIs reales — cada tarjeta de app/panel/page.tsx calcula su
// valor con las tablas que ya existen, siempre con dbComoEmpresa() (el
// mismo cliente con RLS que usa cualquier otra pantalla del panel,
// nunca el rol trabajador) y siempre con empresaId fijo en el WHERE
// además de la política de RLS (mismo criterio defensivo de
// lib/ml/sku.ts y lib/ml/despachos.ts). Ningún KPI inventa un número:
// sin filas, el resultado es 0 o null, nunca un valor de ejemplo.

function rangoMesActual(): { inicio: Date; finExclusivo: Date } {
  const ahora = new Date();
  // [inicio del mes, inicio del mes siguiente) — evita el error clásico
  // de "¿el mes tiene 28, 30 o 31 días?" al calcular el último instante
  // del mes a mano.
  return {
    inicio: new Date(ahora.getFullYear(), ahora.getMonth(), 1),
    finExclusivo: new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1),
  };
}

export type VentasDelMes = { moneda: string; total: number };

// "Ventas del mes" — suma de pedidos.total con fecha dentro del mes de
// calendario actual. numeric de Postgres llega como string (Drizzle no
// redondea solo); sumar con Number() es seguro para montos de venta
// reales, muy lejos del límite de precisión de un float de 64 bits.
//
// pedidos.moneda es una columna por pedido (no una moneda fija por
// empresa) — en la práctica de hoy una empresa colombiana en Mercado
// Libre siempre vende en COP, pero nunca se suman montos de monedas
// distintas como si fueran el mismo número: se agrupa por moneda y, si
// hubiera más de un grupo, se muestra el de mayor monto (una tarjeta
// solo puede mostrar una cifra, nunca una mezcla inventada).
export async function calcularVentasDelMes(empresaId: string): Promise<VentasDelMes | null> {
  const { inicio, finExclusivo } = rangoMesActual();
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ moneda: pedidos.moneda, total: pedidos.total })
      .from(pedidos)
      .where(and(eq(pedidos.empresaId, empresaId), gte(pedidos.fecha, inicio), lt(pedidos.fecha, finExclusivo)))
  );
  if (filas.length === 0) return null;

  const totalesPorMoneda = new Map<string, number>();
  for (const fila of filas) {
    totalesPorMoneda.set(fila.moneda, (totalesPorMoneda.get(fila.moneda) ?? 0) + Number(fila.total));
  }
  const [moneda, total] = [...totalesPorMoneda.entries()].sort((a, b) => b[1] - a[1])[0];
  return { moneda, total };
}

// "Pedidos" — conteo total de pedidos importados (todo el histórico, a
// diferencia de "Ventas del mes" que sí se acota al mes de calendario).
export async function contarPedidos(empresaId: string): Promise<number> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(pedidos)
      .where(eq(pedidos.empresaId, empresaId))
  );
  return fila.total;
}

// "Despachos pendientes" y "SKU sin vincular" reutilizan la MISMA
// consulta que ya usan sus propias pantallas (lib/ml/despachos.ts,
// lib/ml/sku.ts) — nunca una segunda definición de qué es "pendiente" o
// "sin vincular" que se pueda desalinear de la pantalla real con el
// tiempo.
export async function contarDespachosPendientes(empresaId: string): Promise<number> {
  const pendientes = await listarDespachosPendientes(empresaId);
  return pendientes.length;
}

export async function contarSkuSinVincular(empresaId: string): Promise<number> {
  const sinVincular = await listarPublicacionesSinSku(empresaId);
  return sinVincular.length;
}
