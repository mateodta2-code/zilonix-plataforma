// Por pagar automático desde las ventas (28-nov, Sharel con OK de Mateo).
// Parte pura: a qué tercero se le debe el empaque y el envío de una venta
// y la clave de cada partida. Sin base ni reloj. La escritura vive en
// guardar-venta.ts; los periodos y lo pendiente se calculan en SQL
// (por-pagar-db.ts), igual que el resto de Por pagar.
//
// Decisiones de Sharel:
// - El packing se le debe siempre al tercero habitual de empaque.
// - El envío, al habitual de agencia o de Flex según la forma de entrega.
//   Full no tiene envío (congelado en $0).
// - Una venta que se cancela o se devuelve después de despachada se paga
//   igual: la deuda nace con el despacho y no se quita.
// - Arranca de inmediato al salir a producción: solo las ventas
//   despachadas desde empresas.por_pagar_ventas_desde.
// - Tercero de pago «inmediato»: un total por día, que vence ese día.
//   «Cuenta de cobro»: por semana (lunes a domingo), quincena (1-15 y
//   16-fin de mes) o mes, y vence el cierre + su plazo. «Anticipado Full»
//   ya se pagó por adelantado: no genera deuda.

import { aCentavos } from "./utilidad-venta";

export type FormaEntregaVenta = "full_ml" | "flex" | "agencia" | "desconocida";

export type TercerosHabituales = { empaque: string | null; agencia: string | null; flex: string | null };

const CERO = BigInt(0);

const conMonto = (monto: string | null) => monto !== null && aCentavos(monto) > CERO;

// A quién se le debe lo congelado. Sin monto (o $0) no hay deuda: null.
export function tercerosDeLaVenta(
  formaEntrega: FormaEntregaVenta,
  montos: { empaque: string | null; envio: string | null },
  habituales: TercerosHabituales
): { empaqueTerceroId: string | null; envioTerceroId: string | null } {
  const envioTercero = formaEntrega === "agencia" ? habituales.agencia : formaEntrega === "flex" ? habituales.flex : null;
  return {
    empaqueTerceroId: conMonto(montos.empaque) ? habituales.empaque : null,
    envioTerceroId: conMonto(montos.envio) ? envioTercero : null,
  };
}

// Clave de una partida de ventas en Por pagar (y en «Marcar pagado»):
// tercero + inicio del periodo + moneda. Se valida al volver del
// formulario; viaja a la consulta solo como parámetro.
export function claveVentas(terceroId: string, desde: string, moneda: string): string {
  return `${terceroId}|${desde}|${moneda}`;
}

const PATRON_CLAVE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|(\d{4}-\d{2}-\d{2})\|([A-Z]{3})$/i;

export function leerClaveVentas(clave: string): { terceroId: string; desde: string; moneda: string } | null {
  const m = PATRON_CLAVE.exec(clave);
  if (!m) return null;
  const fecha = new Date(`${m[2]}T00:00:00Z`);
  // Rechaza fechas que no existen (2026-02-30 → otro día).
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== m[2]) return null;
  return { terceroId: m[1].toLowerCase(), desde: m[2], moneda: m[3].toUpperCase() };
}
