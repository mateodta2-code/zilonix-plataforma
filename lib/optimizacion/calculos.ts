// Optimización, Fase 2 — cálculos puros del detalle de una publicación.
// Plata en centavos (BigInt) y texto con 2 decimales, como Finanzas.
// Nunca un 0 inventado: si falta un dato, el resultado es null y la
// pantalla muestra "—".

import { aCentavos, desdeCentavos, porcentaje } from "@/lib/finanzas/utilidad-venta";

const CERO = BigInt(0);
const CIEN = BigInt(100);

// Una línea vendida de esta publicación (de pedido_items + pedidos).
export type LineaVendida = {
  pedidoId: string;
  // Día de Bogotá de la creación del pedido (YYYY-MM-DD).
  dia: string;
  cantidad: number;
  valor: string;
  // false = cancelada, inválida o con reembolso total: suma solo en brutas.
  valida: boolean;
  // Del motor de Finanzas; null si la venta no tiene foto de Finanzas o
  // quien mira no tiene permiso de Finanzas.
  costos: CostosLinea | null;
};

export type CostosLinea = {
  comision: string;
  // Flete de Mercado Libre + envío a agencia o Flex de la línea.
  envio: string;
  // null = la línea no tiene costo del producto (la ganancia no se calcula).
  costoProducto: string | null;
  empaque: string;
  // Utilidad de la línea antes de publicidad; null sin costo completo.
  utilidad: string | null;
};

export type DiaPublicidad = { dia: string; inversion: string; ingresos: string };

export type ResumenPeriodo = {
  ventasBrutas: string;
  ventasConcretadas: string;
  pedidos: number;
  unidades: number;
  precioPromedio: string | null;
  // null = Mercado Libre no entregó las visitas de todo el período.
  visitas: number | null;
  conversion: string | null;
  inversion: string;
  ingresosPublicidad: string;
  acos: string | null;
  tacos: string | null;
  // null si quien mira no tiene Finanzas o falta la foto de alguna venta.
  costos: { comision: string; envio: string; costoProducto: string | null; empaque: string } | null;
  // Ganancia después de publicidad. null si falta algún costo.
  ganancia: string | null;
  margen: string | null;
};

function sumar(valores: string[]): bigint {
  return valores.reduce((total, v) => total + aCentavos(v), CERO);
}

function enRango(dia: string, desde: string, hasta: string): boolean {
  return dia >= desde && dia <= hasta;
}

export function resumirPeriodo(entrada: {
  lineas: LineaVendida[];
  publicidad: DiaPublicidad[];
  // null = no se pudieron traer.
  visitasPorDia: Map<string, number> | null;
  // true si la ventana de visitas cubre todo el período.
  visitasCompletas: boolean;
  desde: string;
  hasta: string;
  conFinanzas: boolean;
}): ResumenPeriodo {
  const lineas = entrada.lineas.filter((l) => enRango(l.dia, entrada.desde, entrada.hasta));
  const validas = lineas.filter((l) => l.valida);
  const brutas = sumar(lineas.map((l) => l.valor));
  const concretadas = sumar(validas.map((l) => l.valor));
  const unidades = validas.reduce((n, l) => n + l.cantidad, 0);
  const pedidos = new Set(validas.map((l) => l.pedidoId)).size;

  const publicidad = entrada.publicidad.filter((p) => enRango(p.dia, entrada.desde, entrada.hasta));
  const inversion = sumar(publicidad.map((p) => p.inversion));
  const ingresosPublicidad = sumar(publicidad.map((p) => p.ingresos));

  let visitas: number | null = null;
  if (entrada.visitasPorDia && entrada.visitasCompletas) {
    visitas = 0;
    for (const [dia, total] of entrada.visitasPorDia) if (enRango(dia, entrada.desde, entrada.hasta)) visitas += total;
  }

  let costos: ResumenPeriodo["costos"] = null;
  let ganancia: bigint | null = null;
  if (entrada.conFinanzas && validas.every((l) => l.costos !== null)) {
    const c = validas.map((l) => l.costos as CostosLinea);
    const sinCosto = c.some((x) => x.costoProducto === null);
    costos = {
      comision: desdeCentavos(sumar(c.map((x) => x.comision))),
      envio: desdeCentavos(sumar(c.map((x) => x.envio))),
      costoProducto: sinCosto ? null : desdeCentavos(sumar(c.map((x) => x.costoProducto as string))),
      empaque: desdeCentavos(sumar(c.map((x) => x.empaque))),
    };
    if (c.every((x) => x.utilidad !== null)) ganancia = sumar(c.map((x) => x.utilidad as string)) - inversion;
  }

  return {
    ventasBrutas: desdeCentavos(brutas),
    ventasConcretadas: desdeCentavos(concretadas),
    pedidos,
    unidades,
    precioPromedio: unidades > 0 ? desdeCentavos(concretadas / BigInt(unidades)) : null,
    visitas,
    conversion: visitas !== null && visitas > 0 ? porcentaje(BigInt(pedidos), BigInt(visitas)) : null,
    inversion: desdeCentavos(inversion),
    ingresosPublicidad: desdeCentavos(ingresosPublicidad),
    acos: inversion > CERO ? porcentaje(inversion, ingresosPublicidad) : null,
    tacos: inversion > CERO ? porcentaje(inversion, concretadas) : null,
    costos,
    ganancia: ganancia === null ? null : desdeCentavos(ganancia),
    margen: ganancia === null ? null : porcentaje(ganancia, concretadas),
  };
}

// Cambio porcentual de `actual` contra `anterior` ("12.50" = +12,5 %).
// null si el anterior es 0 o falta alguno: no se inventa un "+100 %".
export function variacion(actual: string | number | null, anterior: string | number | null): string | null {
  if (actual === null || anterior === null) return null;
  const a = typeof actual === "number" ? BigInt(actual) * CIEN : aCentavos(actual);
  const b = typeof anterior === "number" ? BigInt(anterior) * CIEN : aCentavos(anterior);
  if (b === CERO) return null;
  return porcentaje(a - b, b < CERO ? -b : b);
}

// Por unidad: un monto del período dividido por las unidades vendidas.
export function porUnidad(monto: string | null, unidades: number): string | null {
  if (monto === null || unidades <= 0) return null;
  return desdeCentavos(aCentavos(monto) / BigInt(unidades));
}

// Precio mínimo para no perder, con los costos del período: lo fijo por
// unidad (costo, empaque, envío y publicidad) dividido por lo que queda
// después de la comisión (que es un % del precio). Aproximado.
export function precioMinimo(resumen: ResumenPeriodo): string | null {
  const c = resumen.costos;
  if (!c || c.costoProducto === null || resumen.unidades <= 0) return null;
  const concretadas = aCentavos(resumen.ventasConcretadas);
  if (concretadas <= CERO) return null;
  const fijos = aCentavos(c.costoProducto) + aCentavos(c.empaque) + aCentavos(c.envio) + aCentavos(resumen.inversion);
  const fijoPorUnidad = fijos / BigInt(resumen.unidades);
  const comision = aCentavos(c.comision);
  // precio = fijo / (1 − comisión/ventas) = fijo × ventas / (ventas − comisión)
  const resto = concretadas - comision;
  if (resto <= CERO) return null;
  return desdeCentavos((fijoPorUnidad * concretadas + resto - BigInt(1)) / resto);
}

// Días de inventario: stock / unidades vendidas por día. null sin ventas.
export function diasInventario(stock: number | null, unidades: number, dias: number): number | null {
  if (stock === null || unidades <= 0 || dias <= 0) return null;
  return Math.floor((stock * dias) / unidades);
}

export type PuntoDia = { dia: string; ventas: number; visitas: number | null };

// Una fila por día del período, con ceros donde no hubo ventas.
export function serieDiaria(lineas: LineaVendida[], visitasPorDia: Map<string, number> | null, dias: string[]): PuntoDia[] {
  const ventas = new Map<string, number>();
  for (const l of lineas) if (l.valida) ventas.set(l.dia, (ventas.get(l.dia) ?? 0) + l.cantidad);
  return dias.map((dia) => ({ dia, ventas: ventas.get(dia) ?? 0, visitas: visitasPorDia ? (visitasPorDia.get(dia) ?? 0) : null }));
}
