// Issue #130 (Z-FIN-08) — decide la foto congelada de las ventas de un
// paquete. Función pura: no lee la base ni el reloj. La escritura
// (lib/finanzas/guardar-venta.ts) le pasa la maestra ya leída y guarda
// lo que devuelve.
//
// Reglas (Sharel, 22 y 24-oct-2026):
// - El costo se busca en la maestra por el SKU normalizado de la línea;
//   no hace falta que exista en `skus`. Sin fila o con costo vacío =
//   "sin costo": la venta no se congela. Un costo 0.00 es válido.
// - Se congela solo si TODAS las líneas tienen costo. Nunca un costo
//   provisional.
// - Forma de entrega `desconocida`: no se congela y se alerta. Flex sin
//   valor en configuracion_finanzas: tampoco (se reevalúa en la próxima
//   sincronización en vez de congelar un vacío).
// - Empaque y envío se cobran UNA vez por paquete: el mayor de los SKU
//   del paquete. Full: envío $0 aunque el SKU tenga valor; el packing sí
//   se cobra. Flex: flex_valor. Agencia: envio_agencia del SKU.
// - El cargo del paquete se reparte por peso (valor de cada orden, y
//   dentro de la orden valor de cada línea) solo para que las filas
//   sumen; el reparto suma exacto (residuo mayor, en centavos).
//
// Paquete con varias órdenes (carrito): si ya hay órdenes congeladas
// del mismo envío, `yaCobrado` trae lo que ya pagaron. Las nuevas
// pagan solo la diferencia contra el mayor (nunca negativa), así el
// paquete suma el cargo una sola vez sin tocar lo ya congelado.

import { aCentavos, desdeCentavos, repartirProporcional, type FormaEntrega } from "./utilidad-venta";

const CERO = BigInt(0);

export type EstadoCosteo = "completo" | "parcial" | "sin_costo";

// Una fila de costos_sku con el packing de su proveedor al lado.
export type MaestraSku = {
  costo: string | null;
  empaque: string | null;
  empaqueProveedor: string | null;
  envioAgencia: string | null;
};

export type LineaACongelar = {
  linea: number;
  cantidad: number;
  valorLinea: string;
  // Ya normalizado (trim + mayúsculas). null = ML no trajo SKU.
  skuCodigo: string | null;
};

export type OrdenACongelar = { pedidoId: string; lineas: LineaACongelar[] };

export type EntradaCongelar = {
  formaEntrega: FormaEntrega;
  flexValor: string | null;
  maestra: ReadonlyMap<string, MaestraSku>;
  // Órdenes del paquete que todavía no están congeladas.
  ordenes: OrdenACongelar[];
  // Suma de lo ya congelado por otras órdenes del mismo envío (null =
  // ninguna congelada o sin dato).
  yaCobrado?: { empaque: string | null; envio: string | null };
};

export type AlertaCongelado =
  | { tipo: "sin_costo"; pedidoId: string; linea: number; skuCodigo: string | null }
  | { tipo: "forma_entrega_desconocida" }
  | { tipo: "flex_sin_valor" }
  | { tipo: "empaque_sin_dato" }
  | { tipo: "envio_sin_dato" };

export type LineaCongelada = {
  linea: number;
  // Costo de la línea completa (unitario × cantidad), como lo lee el
  // motor de utilidad. null = sin costo.
  costo: string | null;
  empaque: string | null;
  envio: string | null;
};

export type OrdenCongelada = {
  pedidoId: string;
  estadoCosteo: EstadoCosteo;
  // false: no se escribe nada congelado (ni costo, ni empaque, ni envío).
  congelar: boolean;
  empaque: string | null;
  envio: string | null;
  lineas: LineaCongelada[];
};

export type ResultadoCongelar = { ordenes: OrdenCongelada[]; alertas: AlertaCongelado[] };

function costoDeLinea(linea: LineaACongelar, maestra: ReadonlyMap<string, MaestraSku>): string | null {
  if (!linea.skuCodigo) return null;
  const fila = maestra.get(linea.skuCodigo);
  if (!fila || fila.costo === null) return null;
  return desdeCentavos(aCentavos(fila.costo) * BigInt(linea.cantidad));
}

// Misma regla que packingEfectivo (lib/costos-sku.ts): el del SKU; si
// está vacío, el del proveedor; si no, sin dato. Copiada acá para que
// este archivo no cargue la conexión a la base.
function packingDe(fila: MaestraSku | undefined): string | null {
  if (!fila) return null;
  return fila.empaque ?? fila.empaqueProveedor;
}

function mayor(valores: (string | null)[]): bigint | null {
  let resultado: bigint | null = null;
  for (const valor of valores) {
    if (valor === null) continue;
    const centavos = aCentavos(valor);
    if (resultado === null || centavos > resultado) resultado = centavos;
  }
  return resultado;
}

// Lo que pagan las órdenes nuevas: el mayor menos lo ya cobrado, nunca
// negativo. Sin dato en las nuevas: $0 si el paquete ya pagó, si no
// null (y el llamador alerta).
function cargoNuevo(mayorNuevo: bigint | null, yaCobrado: string | null): bigint | null {
  const cobrado = yaCobrado === null ? null : aCentavos(yaCobrado);
  if (mayorNuevo === null) return cobrado === null ? null : CERO;
  const diferencia = mayorNuevo - (cobrado ?? CERO);
  return diferencia > CERO ? diferencia : CERO;
}

function estadoDe(costos: (string | null)[]): EstadoCosteo {
  const conCosto = costos.filter((c) => c !== null).length;
  if (conCosto === costos.length && costos.length > 0) return "completo";
  return conCosto === 0 ? "sin_costo" : "parcial";
}

function pesoDe(orden: OrdenACongelar): bigint {
  return orden.lineas.reduce((suma, l) => suma + aCentavos(l.valorLinea), CERO);
}

function repartir(total: bigint | null, pesos: bigint[]): (string | null)[] {
  if (total === null) return pesos.map(() => null);
  return repartirProporcional(total, pesos).map(desdeCentavos);
}

export function congelarPaquete(entrada: EntradaCongelar): ResultadoCongelar {
  const { formaEntrega, flexValor, maestra, ordenes } = entrada;
  const alertas: AlertaCongelado[] = [];

  const costos = ordenes.map((orden) =>
    orden.lineas.map((linea) => {
      const costo = costoDeLinea(linea, maestra);
      if (costo === null) alertas.push({ tipo: "sin_costo", pedidoId: orden.pedidoId, linea: linea.linea, skuCodigo: linea.skuCodigo });
      return costo;
    })
  );
  const estados = costos.map(estadoDe);

  let bloqueado = false;
  if (formaEntrega === "desconocida") {
    alertas.push({ tipo: "forma_entrega_desconocida" });
    bloqueado = true;
  }
  if (formaEntrega === "flex" && flexValor === null) {
    alertas.push({ tipo: "flex_sin_valor" });
    bloqueado = true;
  }

  const congelables = ordenes.map((_, i) => !bloqueado && estados[i] === "completo");
  const lineasCongelables = ordenes.flatMap((orden, i) => (congelables[i] ? orden.lineas : []));

  let empaquePaquete: bigint | null = null;
  let envioPaquete: bigint | null = null;
  if (lineasCongelables.length > 0) {
    const skus = lineasCongelables.map((l) => (l.skuCodigo ? maestra.get(l.skuCodigo) : undefined));
    empaquePaquete = cargoNuevo(mayor(skus.map(packingDe)), entrada.yaCobrado?.empaque ?? null);
    if (empaquePaquete === null) alertas.push({ tipo: "empaque_sin_dato" });

    const mayorEnvio =
      formaEntrega === "full_ml" ? CERO : formaEntrega === "flex" ? aCentavos(flexValor as string) : mayor(skus.map((s) => s?.envioAgencia ?? null));
    envioPaquete = cargoNuevo(mayorEnvio, entrada.yaCobrado?.envio ?? null);
    if (envioPaquete === null) alertas.push({ tipo: "envio_sin_dato" });
  }

  const indicesCongelables = ordenes.map((_, i) => i).filter((i) => congelables[i]);
  const pesosOrdenes = indicesCongelables.map((i) => pesoDe(ordenes[i]));
  const empaquePorOrden = indicesCongelables.length ? repartir(empaquePaquete, pesosOrdenes) : [];
  const envioPorOrden = indicesCongelables.length ? repartir(envioPaquete, pesosOrdenes) : [];

  const resultado = ordenes.map((orden, i): OrdenCongelada => {
    const posicion = indicesCongelables.indexOf(i);
    if (posicion === -1) {
      return {
        pedidoId: orden.pedidoId,
        estadoCosteo: estados[i],
        congelar: false,
        empaque: null,
        envio: null,
        lineas: orden.lineas.map((l) => ({ linea: l.linea, costo: null, empaque: null, envio: null })),
      };
    }
    const empaque = empaquePorOrden[posicion];
    const envio = envioPorOrden[posicion];
    const pesosLineas = orden.lineas.map((l) => aCentavos(l.valorLinea));
    const empaqueLineas = repartir(empaque === null ? null : aCentavos(empaque), pesosLineas);
    const envioLineas = repartir(envio === null ? null : aCentavos(envio), pesosLineas);
    return {
      pedidoId: orden.pedidoId,
      estadoCosteo: "completo",
      congelar: true,
      empaque,
      envio,
      lineas: orden.lineas.map((l, j) => ({ linea: l.linea, costo: costos[i][j], empaque: empaqueLineas[j], envio: envioLineas[j] })),
    };
  });

  return { ordenes: resultado, alertas };
}
