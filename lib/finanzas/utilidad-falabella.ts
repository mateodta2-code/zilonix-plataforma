// Issue #422 — utilidad por orden de Falabella. Función pura, igual que
// el motor de Mercado Libre (utilidad-venta.ts): no lee la base, no mira
// el reloj. Reusa de ese motor el dinero en centavos con BigInt, el
// porcentaje y la regla de costo de la maestra (combo X2/X3,
// combo-sku.ts): una sola regla de costo para los dos marketplaces.
//
// Fórmula por orden (Sharel, issue #422):
//   utilidad = ventas (precio del producto)
//            − costo de la maestra × cantidad
//            + comisiones + envíos netos + promociones + otros cobros de la orden
// Los cobros ya vienen con signo del reporte (negativos los cargos,
// positivo el «Envío a cargo del seller» que devuelve Falabella), así que
// se SUMAN tal cual.
//
// - Retenciones (fuente, IVA, ICA): aparte, NUNCA bajan la utilidad. Son
//   un saldo a favor en impuestos (mismo criterio de la conciliación).
// - Publicidad y servicios sin Nº de orden: se restan una vez en el total
//   del periodo, no se reparten entre órdenes.
// - Sin línea de «Precio producto» en el reporte → «Sin reporte de
//   Falabella»: no se calcula una utilidad a medias.
// - Un SKU sin costo en la maestra → «Falta costo», nunca un costo
//   inventado. Esa orden queda fuera de la utilidad, como en ML.
// - Cantidad: Falabella manda una línea de precio por unidad vendida
//   (GetOrderItems no tiene campo de cantidad: un OrderItem = una unidad),
//   así que cada línea de precio positiva es una unidad de su SKU.

import { normalizarSkuCodigo } from "@/lib/sku-normalizar";
import type { CategoriaMovimiento } from "@/db/schema";
import { resolverCostoSku, type MaestraSku } from "./combo-sku";
import { aCentavos, desdeCentavos, porcentaje } from "./utilidad-venta";

const CERO = BigInt(0);
const CIEN = BigInt(100);
const DIEZ_MIL = BigInt(10000);

// Los movimientos llegan como numeric(16,4) ("-3530.0200"): Falabella
// reparte IVA y retenciones con más de 2 decimales. Se suma en
// diezmilésimas y se redondea a centavos al final de cada total, nunca
// línea por línea.
const PATRON_MONTO_4 = /^-?\d+(\.\d{1,4})?$/;

export function aDiezmilesimas(monto: string): bigint {
  if (!PATRON_MONTO_4.test(monto)) throw new Error(`Monto inválido en el reporte de Falabella: ${JSON.stringify(monto)}`);
  const negativo = monto.startsWith("-");
  const [entero, fraccion = ""] = (negativo ? monto.slice(1) : monto).split(".");
  const valor = BigInt(entero) * DIEZ_MIL + BigInt((fraccion + "0000").slice(0, 4));
  return negativo ? -valor : valor;
}

// Diezmilésimas → centavos, redondeando la mitad lejos de cero.
function aCentavosRedondeado(diezmilesimas: bigint): bigint {
  const negativo = diezmilesimas < CERO;
  const absoluto = negativo ? -diezmilesimas : diezmilesimas;
  const centavos = (absoluto + CIEN / BigInt(2)) / CIEN;
  return negativo ? -centavos : centavos;
}

export interface PedidoFalabellaEntrada {
  pedidoId: string;
  // El número con el que se busca la orden en el reporte: el OrderId que
  // guardamos y el OrderNumber de sus ítems, si vino (ver consulta).
  numeros: string[];
  // Lo que se muestra como «Orden».
  numeroVisible: string;
  cuentaId: string;
  cuenta: string;
  fecha: Date;
  moneda: string;
}

export interface MovimientoEntrada {
  cuentaId: string;
  numeroOrden: string | null;
  sku: string | null;
  categoria: CategoriaMovimiento;
  monto: string;
}

export type EstadoUtilidadFalabella = "calculada" | "falta_costo" | "sin_reporte";

export interface OrdenUtilidadFalabella {
  pedidoId: string;
  numero: string;
  cuentaId: string;
  cuenta: string;
  fecha: Date;
  moneda: string;
  estado: EstadoUtilidadFalabella;
  cantidad: number;
  // Montos en texto con 2 decimales. Con «sin_reporte» todos van en 0.00.
  ventas: string;
  comisiones: string;
  envios: string;
  promociones: string;
  // Devoluciones, fulfillment, ajustes y otros cobros con Nº de orden.
  otros: string;
  retenciones: string;
  // null con «falta_costo» o «sin_reporte».
  costo: string | null;
  utilidad: string | null;
  // "23.45" = 23,45 %. null sin utilidad o sin ventas.
  porcentajeUtilidad: string | null;
  // SKU (como vienen del reporte) sin costo en la maestra.
  skusSinCosto: string[];
}

export interface TotalesUtilidadFalabella {
  ordenes: number;
  ordenesCalculadas: number;
  ordenesFaltaCosto: number;
  ordenesSinReporte: number;
  cantidad: number;
  // Ventas de las órdenes con reporte (con y sin costo).
  ventas: string;
  ventasFaltaCosto: string;
  // Solo órdenes calculadas.
  costo: string;
  comisiones: string;
  envios: string;
  promociones: string;
  otros: string;
  utilidadOrdenes: string;
  // Publicidad y servicios sin Nº de orden del periodo (con signo).
  cargosSinOrden: string;
  // utilidadOrdenes + cargosSinOrden.
  utilidadPeriodo: string;
  // Utilidad del periodo ÷ ventas de las órdenes calculadas.
  porcentajeUtilidad: string | null;
  // De las órdenes con reporte y de las líneas sin orden. No restan.
  retenciones: string;
}

export interface ResultadoUtilidadFalabella {
  ordenes: OrdenUtilidadFalabella[];
  totales: TotalesUtilidadFalabella;
}

type Suma = Record<CategoriaMovimiento, bigint>;

function sumaVacia(): Suma {
  return {
    precio: CERO,
    comision: CERO,
    envio: CERO,
    promocion: CERO,
    retencion: CERO,
    publicidad: CERO,
    fulfillment: CERO,
    devolucion: CERO,
    ajuste: CERO,
    otro: CERO,
  };
}

const clave = (cuentaId: string, numero: string) => `${cuentaId}|${numero.trim()}`;

function normalizarOVacio(sku: string | null): string | null {
  if (!sku) return null;
  try {
    return normalizarSkuCodigo(sku);
  } catch {
    return null;
  }
}

export function calcularUtilidadFalabella(entrada: {
  pedidos: PedidoFalabellaEntrada[];
  // Las líneas de las órdenes (con Nº de orden) y las del periodo sin
  // orden. Una línea con orden que no es de ningún pedido de la lista se
  // ignora: es de una orden fuera del filtro.
  movimientos: MovimientoEntrada[];
  maestra: ReadonlyMap<string, MaestraSku>;
}): ResultadoUtilidadFalabella {
  const porOrden = new Map<string, { suma: Suma; skusVendidos: (string | null)[] }>();
  const sinOrden = sumaVacia();
  for (const m of entrada.movimientos) {
    const monto = aDiezmilesimas(m.monto);
    if (!m.numeroOrden || !m.numeroOrden.trim()) {
      sinOrden[m.categoria] += monto;
      continue;
    }
    const k = clave(m.cuentaId, m.numeroOrden);
    let grupo = porOrden.get(k);
    if (!grupo) {
      grupo = { suma: sumaVacia(), skusVendidos: [] };
      porOrden.set(k, grupo);
    }
    grupo.suma[m.categoria] += monto;
    if (m.categoria === "precio" && monto > CERO) grupo.skusVendidos.push(m.sku);
  }

  const t = {
    calculadas: 0,
    faltaCosto: 0,
    sinReporte: 0,
    cantidad: 0,
    ventas: CERO,
    ventasFaltaCosto: CERO,
    costo: CERO,
    comisiones: CERO,
    envios: CERO,
    promociones: CERO,
    otros: CERO,
    utilidad: CERO,
    ventasCalculadas: CERO,
    retenciones: aCentavosRedondeado(sinOrden.retencion),
  };

  const ordenes = entrada.pedidos.map((p): OrdenUtilidadFalabella => {
    // Una orden puede encontrarse por su OrderId o su OrderNumber: se
    // juntan las dos (sin contar dos veces la misma clave).
    const claves = [...new Set(p.numeros.filter((n) => n.trim()).map((n) => clave(p.cuentaId, n)))];
    const suma = sumaVacia();
    const skusVendidos: (string | null)[] = [];
    for (const k of claves) {
      const grupo = porOrden.get(k);
      if (!grupo) continue;
      for (const c of Object.keys(suma) as CategoriaMovimiento[]) suma[c] += grupo.suma[c];
      skusVendidos.push(...grupo.skusVendidos);
    }
    const base = { pedidoId: p.pedidoId, numero: p.numeroVisible, cuentaId: p.cuentaId, cuenta: p.cuenta, fecha: p.fecha, moneda: p.moneda };

    if (skusVendidos.length === 0) {
      t.sinReporte += 1;
      return {
        ...base,
        estado: "sin_reporte",
        cantidad: 0,
        ventas: "0.00",
        comisiones: "0.00",
        envios: "0.00",
        promociones: "0.00",
        otros: "0.00",
        retenciones: "0.00",
        costo: null,
        utilidad: null,
        porcentajeUtilidad: null,
        skusSinCosto: [],
      };
    }

    const ventas = aCentavosRedondeado(suma.precio);
    const comisiones = aCentavosRedondeado(suma.comision);
    const envios = aCentavosRedondeado(suma.envio);
    const promociones = aCentavosRedondeado(suma.promocion);
    const otros = aCentavosRedondeado(suma.devolucion + suma.fulfillment + suma.ajuste + suma.otro + suma.publicidad);
    const retenciones = aCentavosRedondeado(suma.retencion);

    let costo = CERO;
    const skusSinCosto: string[] = [];
    for (const sku of skusVendidos) {
      const { costoUnitario } = resolverCostoSku(normalizarOVacio(sku), entrada.maestra);
      if (costoUnitario === null) skusSinCosto.push(sku ?? "(sin SKU)");
      else costo += aCentavos(costoUnitario);
    }
    const sinCosto = skusSinCosto.length > 0;
    const utilidad = ventas + comisiones + envios + promociones + otros - costo;

    t.cantidad += skusVendidos.length;
    t.ventas += ventas;
    t.retenciones += retenciones;
    if (sinCosto) {
      t.faltaCosto += 1;
      t.ventasFaltaCosto += ventas;
    } else {
      t.calculadas += 1;
      t.ventasCalculadas += ventas;
      t.costo += costo;
      t.comisiones += comisiones;
      t.envios += envios;
      t.promociones += promociones;
      t.otros += otros;
      t.utilidad += utilidad;
    }

    return {
      ...base,
      estado: sinCosto ? "falta_costo" : "calculada",
      cantidad: skusVendidos.length,
      ventas: desdeCentavos(ventas),
      comisiones: desdeCentavos(comisiones),
      envios: desdeCentavos(envios),
      promociones: desdeCentavos(promociones),
      otros: desdeCentavos(otros),
      retenciones: desdeCentavos(retenciones),
      costo: sinCosto ? null : desdeCentavos(costo),
      utilidad: sinCosto ? null : desdeCentavos(utilidad),
      porcentajeUtilidad: sinCosto ? null : porcentaje(utilidad, ventas),
      skusSinCosto: [...new Set(skusSinCosto)],
    };
  });

  // Todo lo sin orden menos retenciones (que no restan) y precio (que
  // sin orden no debería existir; si llega, se suma igual para que la
  // plata no desaparezca callada).
  const cargosSinOrden = aCentavosRedondeado(
    sinOrden.precio +
      sinOrden.comision +
      sinOrden.envio +
      sinOrden.promocion +
      sinOrden.publicidad +
      sinOrden.fulfillment +
      sinOrden.devolucion +
      sinOrden.ajuste +
      sinOrden.otro
  );
  const utilidadPeriodo = t.utilidad + cargosSinOrden;

  return {
    ordenes,
    totales: {
      ordenes: ordenes.length,
      ordenesCalculadas: t.calculadas,
      ordenesFaltaCosto: t.faltaCosto,
      ordenesSinReporte: t.sinReporte,
      cantidad: t.cantidad,
      ventas: desdeCentavos(t.ventas),
      ventasFaltaCosto: desdeCentavos(t.ventasFaltaCosto),
      costo: desdeCentavos(t.costo),
      comisiones: desdeCentavos(t.comisiones),
      envios: desdeCentavos(t.envios),
      promociones: desdeCentavos(t.promociones),
      otros: desdeCentavos(t.otros),
      utilidadOrdenes: desdeCentavos(t.utilidad),
      cargosSinOrden: desdeCentavos(cargosSinOrden),
      utilidadPeriodo: desdeCentavos(utilidadPeriodo),
      porcentajeUtilidad: porcentaje(utilidadPeriodo, t.ventasCalculadas),
      retenciones: desdeCentavos(t.retenciones),
    },
  };
}
