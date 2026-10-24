// Vista "Detalle día a día · cuenta · producto" (#162, decisiones de Sharel
// en #131, 24-oct-2026) — solo las cuentas. La pantalla
// (/panel/finanzas/ventas) y las consultas llegan cuando existan los datos
// (#129, #130).
//
// Es una función pura, como el motor (utilidad-venta.ts): no lee la base,
// no mira el reloj, no llama a Mercado Libre. Recibe lo que ya devolvió
// calcularUtilidadVenta para cada venta más los datos de la pantalla
// (estado, fechas, nickname, título y SKU) y arma días → cuentas →
// productos, más un total general.
//
// Fórmulas (Sharel, 24-oct-2026):
// - Recaudo = valor de la venta, lo que pagó el cliente. No se le resta nada.
// - % ML = comisión ML ÷ recaudo. El flete NO entra.
// - % util = utilidad ÷ recaudo de las ventas con costo (mismo criterio que
//   el margen del motor).
// - Cuenta y día son SUMAS de sus filas: se arman sumando los productos, en
//   centavos con BigInt, así que cuadran al centavo por construcción.
//
// [SUPUESTO, mismo criterio de #152] Una venta sin costo entra en ventas,
// recaudo, comisión, flete, empaque, envío, cantidad y % ML, pero no en
// costo ni en utilidad; cada nivel dice cuántas hay y cuánto recaudaron
// (ventas_sin_costo, recaudo_sin_costo) para que la pantalla avise.

import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import {
  EntradaUtilidadInvalidaError,
  aCentavos,
  desdeCentavos,
  diaBogota,
  porcentaje,
  type FormaEntrega,
  type ResultadoVenta,
} from "./utilidad-venta";

const CERO = BigInt(0);

export interface LineaDetalleEntrada {
  linea: number;
  titulo: string;
  sku_codigo: string | null;
}

export interface VentaDetalleEntrada {
  // Lo que devuelve calcularUtilidadVenta.
  resultado: ResultadoVenta;
  // pedidos.estado de Mercado Libre.
  estado: string;
  // pedidos_finanzas.cancelada (reembolso total).
  cancelada: boolean;
  // date_created de Mercado Libre (hoy pedidos.fecha).
  fecha_creacion: Date;
  fecha_despacho: Date | null;
  fecha_entrega: Date | null;
  // Nickname de la cuenta de Mercado Libre (ej. "Mateo"), no el titular.
  cuenta_nickname: string;
  // Una por cada línea de resultado.lineas, ni más ni menos.
  lineas: LineaDetalleEntrada[];
}

export const AGRUPACIONES = ["creacion", "despacho"] as const;
export type AgruparPor = (typeof AGRUPACIONES)[number];

export interface TotalesDetalle {
  // Número de ventas distintas.
  ventas: number;
  ventas_sin_costo: number;
  recaudo: string;
  recaudo_sin_costo: string;
  comision_ml: string;
  flete_ml: string;
  // Solo ventas con costo.
  costo_producto: string;
  empaque: string;
  envio: string;
  // Solo ventas con costo.
  utilidad: string;
  // "23.45" = 23,45 %. null si no hay recaudo con costo.
  porcentaje_utilidad: string | null;
  // null si el recaudo es 0.
  porcentaje_ml: string | null;
  // Unidades.
  cantidad: number;
}

// Una fila por línea de venta. `ventas` y `ventas_sin_costo` valen 1 solo
// en la primera línea de cada venta (y 0 en las demás), para que la suma de
// los productos dé el número de ventas distintas igual que en la cuenta y el
// día. Costo y utilidad son null si la venta no tiene costo completo.
export interface ProductoDetalle extends Omit<TotalesDetalle, "costo_producto" | "utilidad"> {
  pedido_id: string;
  linea: number;
  titulo: string;
  sku_codigo: string | null;
  forma_entrega: FormaEntrega;
  fecha_creacion: Date;
  costo_producto: string | null;
  utilidad: string | null;
}

export interface CuentaDetalle {
  cuenta_ml_id: string;
  nickname: string;
  // Para "N Vta".
  numero_ventas: number;
  totales: TotalesDetalle;
  productos: ProductoDetalle[];
}

export interface DiaDetalle {
  // AAAA-MM-DD de Bogotá.
  dia: string;
  // Para "N cuentas · N ventas".
  numero_cuentas: number;
  numero_ventas: number;
  totales: TotalesDetalle;
  cuentas: CuentaDetalle[];
}

export interface DetalleVentas {
  agrupar_por: AgruparPor;
  // Del más nuevo al más viejo.
  dias: DiaDetalle[];
  // Suma de los días.
  total: TotalesDetalle;
  // Ventas que se sacaron por estado cancelled/invalid o cancelada = true.
  excluidas: number;
  // Solo con agruparPor "despacho": ventas sin fecha de despacho, que no
  // entran a ningún día ni al total.
  sin_fecha_despacho: { ventas: number; pedido_ids: string[] };
}

// ---------------------------------------------------------------------------
// Acumulador en centavos
// ---------------------------------------------------------------------------

interface Montos {
  ventas: number;
  ventasSinCosto: number;
  recaudo: bigint;
  recaudoSinCosto: bigint;
  comision: bigint;
  flete: bigint;
  costo: bigint;
  empaque: bigint;
  envio: bigint;
  utilidad: bigint;
  cantidad: number;
}

function montosVacios(): Montos {
  return {
    ventas: 0,
    ventasSinCosto: 0,
    recaudo: CERO,
    recaudoSinCosto: CERO,
    comision: CERO,
    flete: CERO,
    costo: CERO,
    empaque: CERO,
    envio: CERO,
    utilidad: CERO,
    cantidad: 0,
  };
}

function sumarMontos(destino: Montos, origen: Montos): void {
  destino.ventas += origen.ventas;
  destino.ventasSinCosto += origen.ventasSinCosto;
  destino.recaudo += origen.recaudo;
  destino.recaudoSinCosto += origen.recaudoSinCosto;
  destino.comision += origen.comision;
  destino.flete += origen.flete;
  destino.costo += origen.costo;
  destino.empaque += origen.empaque;
  destino.envio += origen.envio;
  destino.utilidad += origen.utilidad;
  destino.cantidad += origen.cantidad;
}

function cerrarMontos(montos: Montos): TotalesDetalle {
  return {
    ventas: montos.ventas,
    ventas_sin_costo: montos.ventasSinCosto,
    recaudo: desdeCentavos(montos.recaudo),
    recaudo_sin_costo: desdeCentavos(montos.recaudoSinCosto),
    comision_ml: desdeCentavos(montos.comision),
    flete_ml: desdeCentavos(montos.flete),
    costo_producto: desdeCentavos(montos.costo),
    empaque: desdeCentavos(montos.empaque),
    envio: desdeCentavos(montos.envio),
    utilidad: desdeCentavos(montos.utilidad),
    porcentaje_utilidad: porcentaje(montos.utilidad, montos.recaudo - montos.recaudoSinCosto),
    porcentaje_ml: porcentaje(montos.comision, montos.recaudo),
    cantidad: montos.cantidad,
  };
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

function fechaValida(fecha: unknown, nombre: string, pedidoId: string): Date {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
    throw new EntradaUtilidadInvalidaError(`${nombre} inválida en la venta ${pedidoId}`);
  }
  return fecha;
}

interface FilaInterna {
  producto: Omit<ProductoDetalle, keyof TotalesDetalle>;
  montos: Montos;
  conCosto: boolean;
}

// Una fila por línea de resultado.lineas, en el orden de `linea`. Cada
// línea de resultado tiene que traer su título y SKU, y no puede sobrar
// ninguna: si no, la fila de producto quedaría sin nombre o el total
// contaría una línea que no existe.
function filasDeVenta(venta: VentaDetalleEntrada): FilaInterna[] {
  const { resultado } = venta;
  const datos = new Map<number, LineaDetalleEntrada>();
  for (const linea of venta.lineas) {
    if (datos.has(linea.linea)) {
      throw new EntradaUtilidadInvalidaError(`Línea repetida en el detalle de ${resultado.pedido_id}: ${linea.linea}`);
    }
    if (!resultado.lineas.some((r) => r.linea === linea.linea)) {
      throw new EntradaUtilidadInvalidaError(`La línea ${linea.linea} no está en el resultado de ${resultado.pedido_id}`);
    }
    datos.set(linea.linea, linea);
  }
  const conCosto = resultado.con_costo && resultado.utilidad !== null;
  const lineasOrdenadas = [...resultado.lineas].sort((a, b) => a.linea - b.linea);
  return lineasOrdenadas.map((linea, indice) => {
    const dato = datos.get(linea.linea);
    if (!dato) {
      throw new EntradaUtilidadInvalidaError(`Falta el título de la línea ${linea.linea} de ${resultado.pedido_id}`);
    }
    const recaudo = aCentavos(linea.valor_venta);
    const primera = indice === 0;
    const costo = conCosto && linea.costo_producto !== null ? aCentavos(linea.costo_producto.valor) : null;
    const utilidad = conCosto && linea.utilidad !== null ? aCentavos(linea.utilidad) : null;
    const montos: Montos = {
      ventas: primera ? 1 : 0,
      ventasSinCosto: primera && !conCosto ? 1 : 0,
      recaudo,
      recaudoSinCosto: conCosto ? CERO : recaudo,
      comision: aCentavos(linea.comision_ml.valor),
      flete: aCentavos(linea.flete_ml.valor),
      costo: costo ?? CERO,
      empaque: aCentavos(linea.empaque.valor),
      envio: aCentavos(linea.envio.valor),
      utilidad: utilidad ?? CERO,
      cantidad: linea.cantidad,
    };
    return {
      producto: {
        pedido_id: resultado.pedido_id,
        linea: linea.linea,
        titulo: dato.titulo,
        sku_codigo: dato.sku_codigo,
        forma_entrega: resultado.forma_entrega,
        fecha_creacion: venta.fecha_creacion,
      },
      montos,
      conCosto: costo !== null && utilidad !== null,
    };
  });
}

function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

export function armarDetalleVentas(ventas: VentaDetalleEntrada[], opciones: { agruparPor?: AgruparPor } = {}): DetalleVentas {
  const agruparPor = opciones.agruparPor ?? "creacion";
  if (!(AGRUPACIONES as readonly string[]).includes(agruparPor)) {
    throw new EntradaUtilidadInvalidaError(`agruparPor desconocido: ${JSON.stringify(agruparPor)}`);
  }

  type GrupoCuenta = { cuenta_ml_id: string; nickname: string; filas: FilaInterna[] };
  const dias = new Map<string, Map<string, GrupoCuenta>>();
  const nicknames = new Map<string, string>();
  const pedidosVistos = new Set<string>();
  const sinFechaDespacho: string[] = [];
  let excluidas = 0;

  for (const venta of ventas) {
    const pedidoId = venta.resultado.pedido_id;
    if (pedidosVistos.has(pedidoId)) {
      throw new EntradaUtilidadInvalidaError(`Venta repetida: ${pedidoId}`);
    }
    pedidosVistos.add(pedidoId);
    if (typeof venta.estado !== "string" || typeof venta.cancelada !== "boolean") {
      throw new EntradaUtilidadInvalidaError(`estado o cancelada inválidos en la venta ${pedidoId}`);
    }
    fechaValida(venta.fecha_creacion, "fecha_creacion", pedidoId);
    if (venta.fecha_despacho !== null) fechaValida(venta.fecha_despacho, "fecha_despacho", pedidoId);
    if (venta.fecha_entrega !== null) fechaValida(venta.fecha_entrega, "fecha_entrega", pedidoId);
    // Se validan aunque la venta salga: una entrada rota se avisa siempre.
    const filas = filasDeVenta(venta);

    const cuentaId = venta.resultado.cuenta_ml_id;
    const nicknameAnterior = nicknames.get(cuentaId);
    if (nicknameAnterior !== undefined && nicknameAnterior !== venta.cuenta_nickname) {
      throw new EntradaUtilidadInvalidaError(`La cuenta ${cuentaId} llega con dos nicknames distintos`);
    }
    nicknames.set(cuentaId, venta.cuenta_nickname);

    // Sin ícono de quitar (#131): salen solas las cancelled/invalid y las
    // canceladas por reembolso total.
    if (ESTADOS_QUE_NO_SON_VENTA.includes(venta.estado) || venta.cancelada) {
      excluidas += 1;
      continue;
    }

    // Día de creación por defecto (decisión de Sharel en #131), nunca el de
    // pago aprobado: una venta creada a las 23:59 del 23 y pagada el 24 va
    // en el 23.
    let dia: string;
    if (agruparPor === "despacho") {
      if (venta.fecha_despacho === null) {
        sinFechaDespacho.push(pedidoId);
        continue;
      }
      dia = diaBogota(venta.fecha_despacho);
    } else {
      dia = diaBogota(venta.fecha_creacion);
    }

    let cuentas = dias.get(dia);
    if (!cuentas) {
      cuentas = new Map();
      dias.set(dia, cuentas);
    }
    let grupo = cuentas.get(cuentaId);
    if (!grupo) {
      grupo = { cuenta_ml_id: cuentaId, nickname: venta.cuenta_nickname, filas: [] };
      cuentas.set(cuentaId, grupo);
    }
    grupo.filas.push(...filas);
  }

  const total = montosVacios();
  const diasSalida: DiaDetalle[] = Array.from(dias.entries())
    .sort(([a], [b]) => compararTexto(b, a))
    .map(([dia, cuentas]) => {
      const montosDia = montosVacios();
      const cuentasSalida: CuentaDetalle[] = Array.from(cuentas.values())
        .sort((a, b) => compararTexto(a.nickname, b.nickname) || compararTexto(a.cuenta_ml_id, b.cuenta_ml_id))
        .map((grupo) => {
          const montosCuenta = montosVacios();
          const productos = [...grupo.filas]
            .sort(
              (a, b) =>
                a.producto.fecha_creacion.getTime() - b.producto.fecha_creacion.getTime() ||
                compararTexto(a.producto.pedido_id, b.producto.pedido_id) ||
                a.producto.linea - b.producto.linea,
            )
            .map((fila): ProductoDetalle => {
              sumarMontos(montosCuenta, fila.montos);
              const totales = cerrarMontos(fila.montos);
              return {
                ...fila.producto,
                ...totales,
                costo_producto: fila.conCosto ? totales.costo_producto : null,
                utilidad: fila.conCosto ? totales.utilidad : null,
              };
            });
          sumarMontos(montosDia, montosCuenta);
          return {
            cuenta_ml_id: grupo.cuenta_ml_id,
            nickname: grupo.nickname,
            numero_ventas: montosCuenta.ventas,
            totales: cerrarMontos(montosCuenta),
            productos,
          };
        });
      sumarMontos(total, montosDia);
      return {
        dia,
        numero_cuentas: cuentasSalida.length,
        numero_ventas: montosDia.ventas,
        totales: cerrarMontos(montosDia),
        cuentas: cuentasSalida,
      };
    });

  return {
    agrupar_por: agruparPor,
    dias: diasSalida,
    total: cerrarMontos(total),
    excluidas,
    sin_fecha_despacho: { ventas: sinFechaDespacho.length, pedido_ids: sinFechaDespacho.sort(compararTexto) },
  };
}
