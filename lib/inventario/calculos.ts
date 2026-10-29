// Issue #280 — reglas puras del inventario, sin tocar la base: qué le
// hace cada tipo de movimiento al saldo, el stock derivado de un kit,
// cuánto se publica en ML y desde qué bodega se reserva un pedido. Las
// usa lib/inventario/movimientos.ts y se prueban sin Postgres
// (calculos.test.ts).

export const TIPOS_MOVIMIENTO = ["entrada", "salida", "ajuste", "traslado", "reserva", "liberacion", "confirmacion"] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export type Saldo = { disponible: number; reservado: number; enTransito: number };
export type Delta = { disponible: number; reservado: number; enTransito: number };

export const SALDO_CERO: Saldo = { disponible: 0, reservado: 0, enTransito: 0 };

// Los ids llegan de formularios: uno mal formado nunca se le pasa a
// Postgres (una columna uuid lo rechaza con un error 500, no con un
// mensaje para la persona).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID_RE.test(valor);
}

export class CantidadInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CantidadInvalidaError";
  }
}

export class StockInsuficienteError extends Error {
  constructor(
    public readonly skuId: string,
    public readonly bodegaId: string,
    public readonly saldo: Saldo,
    public readonly delta: Delta
  ) {
    super(
      `No alcanza el stock: hay ${saldo.disponible} disponible(s) y ${saldo.reservado} reservado(s), el movimiento pide ${delta.disponible} y ${delta.reservado}.`
    );
    this.name = "StockInsuficienteError";
  }
}

// Unidades enteras siempre (no hay medio producto). El ajuste es el
// único que admite negativo: el signo dice si sobra o falta.
export function validarCantidad(tipo: TipoMovimiento, cantidad: number): void {
  if (!Number.isSafeInteger(cantidad)) throw new CantidadInvalidaError("La cantidad tiene que ser un número entero.");
  if (tipo === "ajuste") {
    if (cantidad === 0) throw new CantidadInvalidaError("Un ajuste de 0 unidades no cambia nada.");
    return;
  }
  if (cantidad <= 0) throw new CantidadInvalidaError("La cantidad tiene que ser mayor que 0.");
}

// "puntaTraslado" dice qué lado del traslado es esta fila: el traslado
// es instantáneo en Fase 1 (sale de una bodega y entra a la otra en la
// misma transacción). en_transito no se usa todavía.
export function deltaDeMovimiento(tipo: TipoMovimiento, cantidad: number, puntaTraslado?: "origen" | "destino"): Delta {
  validarCantidad(tipo, cantidad);
  switch (tipo) {
    case "entrada":
      return { disponible: cantidad, reservado: 0, enTransito: 0 };
    case "salida":
      return { disponible: -cantidad, reservado: 0, enTransito: 0 };
    case "ajuste":
      return { disponible: cantidad, reservado: 0, enTransito: 0 };
    case "traslado":
      if (!puntaTraslado) throw new Error("Un traslado necesita saber si la fila es el origen o el destino.");
      return { disponible: puntaTraslado === "origen" ? -cantidad : cantidad, reservado: 0, enTransito: 0 };
    case "reserva":
      return { disponible: -cantidad, reservado: cantidad, enTransito: 0 };
    case "liberacion":
      return { disponible: cantidad, reservado: -cantidad, enTransito: 0 };
    case "confirmacion":
      return { disponible: 0, reservado: -cantidad, enTransito: 0 };
  }
}

export function aplicarDelta(saldo: Saldo, delta: Delta): Saldo {
  return {
    disponible: saldo.disponible + delta.disponible,
    reservado: saldo.reservado + delta.reservado,
    enTransito: saldo.enTransito + delta.enTransito,
  };
}

export function saldoValido(saldo: Saldo): boolean {
  return saldo.disponible >= 0 && saldo.reservado >= 0 && saldo.enTransito >= 0;
}

// Cuántos kits completos se pueden armar con lo que hay. Un kit sin
// componentes no se puede armar: 0, nunca "infinito".
export function stockDerivadoKit(componentes: { skuId: string; cantidad: number }[], disponiblePorSku: Map<string, number>): number {
  if (componentes.length === 0) return 0;
  let minimo = Number.POSITIVE_INFINITY;
  for (const c of componentes) {
    if (c.cantidad <= 0) return 0;
    const hay = disponiblePorSku.get(c.skuId) ?? 0;
    minimo = Math.min(minimo, Math.floor(Math.max(0, hay) / c.cantidad));
  }
  return minimo;
}

// Lo que se manda a ML: el disponible sumado de las bodegas que cuentan
// para lo publicado, menos el colchón. Nunca negativo.
export function cantidadAPublicar(disponibleAgregado: number, bufferMl: number): number {
  return Math.max(0, disponibleAgregado - Math.max(0, bufferMl));
}

// La alerta de la última unidad salta cuando el publicado BAJA hasta el
// umbral (no cada vez que se lee un SKU que ya estaba ahí, ni cuando
// sube). Umbral 0 = regla apagada.
export function cruzaUmbralUltimaUnidad(antes: number, despues: number, umbral: number): boolean {
  if (umbral <= 0) return false;
  return despues < antes && despues <= umbral && antes > 0;
}

export type LineaAReservar = { skuId: string; cantidad: number };

// Junta líneas repetidas del mismo SKU (un pedido con un kit y el mismo
// componente suelto pide las dos cosas de la misma bodega).
export function agruparPorSku(lineas: LineaAReservar[]): LineaAReservar[] {
  const porSku = new Map<string, number>();
  for (const l of lineas) porSku.set(l.skuId, (porSku.get(l.skuId) ?? 0) + l.cantidad);
  return [...porSku].map(([skuId, cantidad]) => ({ skuId, cantidad }));
}

// Fase 1: rechazo total. El pedido entero sale de UNA bodega o no se
// reserva nada — nunca medio pedido de una y medio de otra (eso pide
// partir el despacho, fuera de Fase 1). Se prueba en el orden dado
// (la principal primero) y gana la primera que alcanza para todo.
export function elegirBodegaParaReserva(
  lineas: LineaAReservar[],
  bodegasEnOrden: string[],
  disponible: (bodegaId: string, skuId: string) => number
): string | null {
  const agrupadas = agruparPorSku(lineas);
  if (agrupadas.length === 0) return null;
  for (const bodegaId of bodegasEnOrden) {
    if (agrupadas.every((l) => disponible(bodegaId, l.skuId) >= l.cantidad)) return bodegaId;
  }
  return null;
}

// Issue #280 — qué paso le toca a un pedido de ML según su estado y
// lo que ya quedó en el kardex (supuestos en lib/inventario/pedidos-ml.ts).
export type EstadoPedidoInventario = {
  pagado: boolean;
  despachado: boolean;
  cancelado: boolean;
  tieneReserva: boolean;
  cerrado: boolean; // ya se liberó o se confirmó
};

export type AccionPedido = "nada" | "reservar" | "confirmar" | "reservar_y_confirmar" | "liberar";

export function decidirAccionPedido(e: EstadoPedidoInventario): AccionPedido {
  if (e.cerrado) return "nada";
  if (e.cancelado) return e.tieneReserva ? "liberar" : "nada";
  if (e.despachado) return e.tieneReserva ? "confirmar" : "reservar_y_confirmar";
  if (e.pagado) return e.tieneReserva ? "nada" : "reservar";
  return "nada";
}

// Issue #280 — si una publicación de ML se puede actualizar con
// available_quantity (ver lib/trabajos/sincronizarStockMl.ts).
export type ItemMlStock = { id?: string; variations?: unknown[]; shipping?: { logistic_type?: string } };

// Por qué no se envía (o qué pasó), en una línea para la pantalla.
export type ResultadoPublicacion = "enviada" | "full" | "con_variaciones" | "no_encontrada" | "rechazada";

export function motivoDeItem(item: ItemMlStock): ResultadoPublicacion | null {
  if (item.shipping?.logistic_type === "fulfillment") return "full";
  if (Array.isArray(item.variations) && item.variations.length > 0) return "con_variaciones";
  return null;
}
