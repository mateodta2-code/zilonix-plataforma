import type { FormaEntrega, OrigenValor } from "@/lib/finanzas/utilidad-venta";
import type { AvisoVenta } from "@/lib/finanzas/utilidad-venta";
import type { AvisoArmado } from "@/lib/finanzas/ventas-pantalla";

// Issue #131 (Parte A) — textos de pantalla de ventas y utilidad,
// compartidos por la lista y el detalle de una venta.

// "23.45" → "23,45 %". Solo texto, sin Number.
export function mostrarPorcentaje(valor: string | null): string {
  return valor === null ? "—" : `${valor.replace(".", ",")} %`;
}

// Issue #131 — % de la tabla del detalle sin decimales, como Zilonix OS:
// "33.15" → "33 %", "12.50" → "13 %". La mitad redondea lejos de cero
// (como dividirRedondeando del tablero): "-12.50" → "-13 %". Solo texto y
// BigInt, sin Number: el motor sigue entregando el porcentaje con 2
// decimales y esto es solo cómo se pinta.
export function mostrarPorcentajeEntero(valor: string | null): string {
  if (valor === null) return "—";
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valor);
  if (!m) return mostrarPorcentaje(valor);
  const [, signo, entero, decimales = ""] = m;
  const redondeado = BigInt(entero) + (decimales !== "" && decimales[0] >= "5" ? BigInt(1) : BigInt(0));
  return `${redondeado === BigInt(0) ? "" : signo}${redondeado} %`;
}

export const ETIQUETA_FORMA: Record<FormaEntrega, string> = {
  agencia: "Agencia",
  flex: "Flex",
  full_ml: "Full",
  desconocida: "Sin forma",
};

export const ETIQUETA_ORIGEN: Record<OrigenValor, string> = {
  congelado: "valor congelado",
  corregido: "corregido a mano",
  full_ml: "Full ML ($0)",
};

export const ETIQUETA_AVISO: Record<AvisoVenta | AvisoArmado, string> = {
  sin_costo: "Sin costo: la venta queda fuera de la utilidad.",
  empaque_sin_dato: "Packing sin dato: cuenta como $0.",
  envio_sin_dato: "Envío agencia sin dato: cuenta como $0.",
  forma_entrega_desconocida: "Forma de entrega desconocida.",
  correccion_linea_ignorada: "Hay una corrección de línea que no se usa porque gana la de toda la venta.",
  comision_sin_dato: "Comisión ML sin dato: cuenta como $0.",
  flete_sin_dato: "Flete ML sin dato: cuenta como $0.",
};

export const ETIQUETA_CAMPO: Record<string, string> = {
  costo_producto: "Costo producto",
  empaque: "Packing",
  envio_agencia: "Envío agencia",
  comision_ml: "Comisión ML",
  flete_ml: "Flete ML",
};

// Fecha y hora de Bogotá, sin depender de la zona del servidor (Railway
// corre en UTC).
export function fechaHoraBogota(fecha: Date): string {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
}
