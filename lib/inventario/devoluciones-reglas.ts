// Productos → Devoluciones (28-nov) — piezas puras, sin base ni Next.

// Una devolución de ML que vale la pena avisar: su envío de vuelta va en
// camino o ya fue entregado (todavía no se ha registrado en la bodega).
export function devolucionPorLlegar(estado: string): boolean {
  return estado === "en_camino" || estado === "llego";
}

// Día de Bogotá (AAAA-MM-DD) de una fecha ISO de ML; hoy si no viene.
export function diaBogotaDe(iso: string | null, ahora: Date): string {
  const ms = iso ? Date.parse(iso) : NaN;
  const base = Number.isNaN(ms) ? ahora.getTime() : ms;
  return new Date(base - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type LineaVentaGuardada = { linea: number; skuId: string | null; titulo: string; cantidad: number };

// Las filas a crear por una devolución de ML: una por línea de la venta
// guardada. Si la venta no está en Zilonix, una sola fila «por revisar»
// (sin SKU: se elige al recibir).
export function filasDeDevolucionMl(
  devolucion: { reclamoId: string; ordenId: string | null; fecha: string; estadoEnvio: string | null; cuentaMlId: string },
  lineasVenta: LineaVentaGuardada[]
): {
  reclamoIdMl: string;
  lineaPedido: number;
  pedidoIdExterno: string | null;
  fecha: string;
  estadoEnvioMl: string | null;
  cuentaMlId: string;
  skuId: string | null;
  producto: string;
  cantidad: number;
}[] {
  const base = {
    reclamoIdMl: devolucion.reclamoId,
    pedidoIdExterno: devolucion.ordenId,
    fecha: devolucion.fecha,
    estadoEnvioMl: devolucion.estadoEnvio,
    cuentaMlId: devolucion.cuentaMlId,
  };
  if (lineasVenta.length === 0) {
    return [
      {
        ...base,
        lineaPedido: 0,
        skuId: null,
        producto: devolucion.ordenId ? `Orden ${devolucion.ordenId} (la venta no está en Zilonix)` : `Reclamo ${devolucion.reclamoId}`,
        cantidad: 1,
      },
    ];
  }
  return lineasVenta.map((l) => ({
    ...base,
    lineaPedido: l.linea,
    skuId: l.skuId,
    producto: l.titulo.slice(0, 300),
    cantidad: Math.max(1, l.cantidad),
  }));
}
