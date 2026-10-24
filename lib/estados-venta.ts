// Qué estado de un pedido de Mercado Libre cuenta como venta. Archivo puro
// (sin base): lo usan las cuentas de finanzas (lib/finanzas/), que no
// pueden importar lib/panel-kpis.ts — ese archivo trae db/index.ts, que
// exige DATABASE_URL_APP y rompería las pruebas puras.
//
// Todo lo que no está acá — paid, confirmed, payment_required,
// payment_in_process — cuenta como venta. Es la misma lista que usan
// "Ventas de hoy" y "Ventas del mes" en Inicio (#153, #160) y la vista
// "Detalle día a día · cuenta · producto" (#131, #162). Lista fija del
// código, nunca un valor de la petición. Es un string[] (y no un
// `as const`) para poder pasarla tal cual a notInArray de drizzle; nadie
// la modifica.
export const ESTADOS_QUE_NO_SON_VENTA: string[] = ["cancelled", "invalid"];

export function esVenta(estado: string): boolean {
  return !ESTADOS_QUE_NO_SON_VENTA.includes(estado);
}
