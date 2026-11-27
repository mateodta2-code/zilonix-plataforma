import { formatearMonedaIso } from "@/lib/ml/sitios";
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

// Issue #422 — monto en texto (numeric de Postgres, "117830.9400") con su
// divisa ISO, para la conciliación de Falabella. Number solo para
// pintarlo: la suma ya la hizo Postgres en numeric.
export function mostrarMontoIso(valor: string, moneda: string): string {
  return formatearMonedaIso(Number(valor), moneda);
}

// Detalle día a día (27-nov): «2026-11-27» → «Jue 27 nov 2026». El día ya
// es de Bogotá (AAAA-MM-DD), así que se lee en UTC sin mover la fecha.
const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fechaDiaLegible(dia: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return dia;
  const [anio, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const fecha = new Date(Date.UTC(anio, mes - 1, d));
  if (fecha.getUTCMonth() !== mes - 1) return dia;
  return `${DIAS_SEMANA[fecha.getUTCDay()]} ${d} ${MESES[mes - 1]} ${anio}`;
}

// Encabezados del detalle y del «Total por cuenta»: nombre claro y, al
// pasar el mouse, qué es y de dónde sale cada número.
export const AYUDA_COLUMNAS: Record<string, string> = {
  Ventas: "Cuántas ventas (órdenes) hubo.",
  Recaudo: "Lo que pagó el comprador por las ventas.",
  "Comisión ML": "Lo que cobra Mercado Libre por cada venta.",
  "Flete ML": "Lo que Mercado Libre te descuenta por el envío.",
  Costo: "Costo del producto según la Tabla maestra de SKU.",
  Packing: "Empaque, cobrado una vez por paquete (Tabla maestra o proveedor).",
  Envío: "Envío por agencia o valor Flex de la Tabla maestra. $0 en Full.",
  Utilidad: "Recaudo − Comisión ML − Flete ML − Costo − Packing − Envío. Antes de publicidad.",
  Margen: "Utilidad ÷ Recaudo de las ventas que tienen costo.",
  "% comisión": "Comisión ML ÷ Recaudo, sin flete.",
  Unidades: "Cuántas unidades se vendieron.",
  "% con costo": "Qué parte de las ventas tiene costo cargado.",
};

// Semáforo del margen («% util») del detalle (27-nov, cortes elegidos por
// el usuario, como el Zilonix OS): verde desde 30 %, naranja de 15 % a
// menos de 30 %, rojo por debajo de 15 % (pérdidas incluidas). Compara en
// centésimas con texto y BigInt, sin Number (el motor entrega "33.15").
export const MARGEN_VERDE_DESDE = "30";
export const MARGEN_NARANJA_DESDE = "15";
export type TonoMargen = "verde" | "naranja" | "rojo";

function centesimas(valor: string): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(valor);
  if (!m) return null;
  const [, signo, entero, dec = ""] = m;
  const absoluto = BigInt(entero) * BigInt(100) + BigInt(dec.padEnd(2, "0") || "0");
  return signo === "-" ? -absoluto : absoluto;
}

export function tonoMargen(valor: string | null): TonoMargen | null {
  if (valor === null) return null;
  const v = centesimas(valor);
  if (v === null) return null;
  if (v >= (centesimas(MARGEN_VERDE_DESDE) as bigint)) return "verde";
  if (v >= (centesimas(MARGEN_NARANJA_DESDE) as bigint)) return "naranja";
  return "rojo";
}
