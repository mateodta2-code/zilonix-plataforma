// Issue #131 (Z-FIN-09, Parte A) — piezas puras de la pantalla de ventas
// y utilidad (/panel/finanzas/ventas): de las filas de la base a la
// entrada del motor, el resumen por cuenta y el rango de fechas. Sin
// base, sin reloj (el "ahora" llega por parámetro), sin Mercado Libre:
// las consultas viven en lib/finanzas/ventas-consulta.ts.
//
// Dinero como texto decimal, sumado en centavos con BigInt (igual que
// utilidad-venta.ts y detalle-ventas.ts). Nunca Number para sumar plata.

import { limitesDiaBogota } from "@/lib/filtros-listado";
import type { DetalleVentas, TotalesDetalle } from "./detalle-ventas";
import {
  aCentavos,
  desdeCentavos,
  porcentaje,
  type CampoCorregible,
  type FormaEntrega,
  type LineaVentaEntrada,
  type VentaEntrada,
} from "./utilidad-venta";

const CERO = BigInt(0);

// ---------------------------------------------------------------------------
// De las filas de la base a VentaEntrada
// ---------------------------------------------------------------------------

export interface CabeceraVentaFila {
  pedidoId: string;
  cuentaMlId: string;
  formaEntrega: FormaEntrega;
  // pedidos.fecha (date_created de ML).
  fechaCreacion: Date;
  fechaPagoAprobado: Date | null;
  valorVenta: string;
  comisionMl: string | null;
  fleteMl: string | null;
  empaqueCongelado: string | null;
  envioAgenciaCongelado: string | null;
}

export interface LineaVentaFila {
  linea: number;
  cantidad: number;
  valorLinea: string;
  costoCongelado: string | null;
  empaqueCongelado: string | null;
  envioCongelado: string | null;
}

export interface CorreccionVentaFila {
  linea: number | null;
  campo: CampoCorregible;
  valorNuevo: string;
  anuladaTs: Date | null;
}

// Lo que el armado tuvo que suponer; la pantalla lo muestra junto a los
// avisos del motor.
export type AvisoArmado = "comision_sin_dato" | "flete_sin_dato";

export function armarVentaEntrada(
  cabecera: CabeceraVentaFila,
  lineas: LineaVentaFila[],
  correcciones: CorreccionVentaFila[]
): { entrada: VentaEntrada; avisos: AvisoArmado[] } {
  const avisos: AvisoArmado[] = [];
  if (cabecera.comisionMl === null) avisos.push("comision_sin_dato");
  if (cabecera.fleteMl === null) avisos.push("flete_sin_dato");

  // Empaque y envío por línea: van todas las líneas o ninguna. Una foto a
  // medias (alguna línea vacía) no se completa a mano: se pasa sin valores
  // por línea y el motor reparte el valor del paquete por peso.
  const empaqueCompleto = lineas.every((l) => l.empaqueCongelado !== null);
  const envioCompleto = lineas.every((l) => l.envioCongelado !== null);

  const lineasEntrada = [...lineas]
    .sort((a, b) => a.linea - b.linea)
    .map((l): LineaVentaEntrada => {
      const linea: LineaVentaEntrada = {
        linea: l.linea,
        cantidad: l.cantidad,
        valor_linea: l.valorLinea,
        costo_congelado: l.costoCongelado,
      };
      if (empaqueCompleto) linea.empaque_congelado = l.empaqueCongelado;
      if (envioCompleto) linea.envio_congelado = l.envioCongelado;
      return linea;
    });

  return {
    entrada: {
      pedido_id: cabecera.pedidoId,
      cuenta_ml_id: cabecera.cuentaMlId,
      forma_entrega: cabecera.formaEntrega,
      // [SUPUESTO] sin fecha de pago aprobado se usa la de creación: para
      // esta pantalla es solo un dato (agrupa por día de creación, #131) y
      // el motor la exige para su dia_bogota/mes_bogota.
      fecha_pago_aprobado: cabecera.fechaPagoAprobado ?? cabecera.fechaCreacion,
      // Lo que pagó el cliente, TAL CUAL, sin restar reembolsos (regla del
      // equipo). La devolución como concepto aparte es #164.
      valor_venta: cabecera.valorVenta,
      comision_ml: cabecera.comisionMl ?? "0.00",
      flete_ml: cabecera.fleteMl ?? "0.00",
      empaque_congelado: cabecera.empaqueCongelado,
      envio_agencia_congelado: cabecera.envioAgenciaCongelado,
      lineas: lineasEntrada,
      // Todas, también las anuladas: el motor solo usa las activas.
      correcciones: correcciones.map((c) => ({
        linea: c.linea,
        campo: c.campo,
        valor_nuevo: c.valorNuevo,
        anulada_ts: c.anuladaTs,
      })),
    },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Resumen por cuenta (total por cuenta y mes antes de publicidad)
// ---------------------------------------------------------------------------

export interface ResumenCuenta {
  cuenta_ml_id: string;
  nickname: string;
  totales: TotalesDetalle;
  // (ventas − ventas sin costo) ÷ ventas. null sin ventas.
  porcentaje_ventas_con_costo: string | null;
}

export function porcentajeVentasConCosto(totales: Pick<TotalesDetalle, "ventas" | "ventas_sin_costo">): string | null {
  return porcentaje(BigInt(totales.ventas - totales.ventas_sin_costo), BigInt(totales.ventas));
}

interface Acumulado {
  ventas: number;
  ventasSinCosto: number;
  cantidad: number;
  recaudo: bigint;
  recaudoSinCosto: bigint;
  comision: bigint;
  flete: bigint;
  costo: bigint;
  empaque: bigint;
  envio: bigint;
  utilidad: bigint;
}

// Suma cada cuenta a través de los días, con las mismas columnas del
// detalle. Los porcentajes se recalculan sobre las sumas (nunca se suman
// porcentajes), con las mismas fórmulas de detalle-ventas.ts.
export function resumirPorCuenta(detalle: DetalleVentas): ResumenCuenta[] {
  const cuentas = new Map<string, { nickname: string; suma: Acumulado }>();
  for (const dia of detalle.dias) {
    for (const cuenta of dia.cuentas) {
      let grupo = cuentas.get(cuenta.cuenta_ml_id);
      if (!grupo) {
        grupo = {
          nickname: cuenta.nickname,
          suma: {
            ventas: 0,
            ventasSinCosto: 0,
            cantidad: 0,
            recaudo: CERO,
            recaudoSinCosto: CERO,
            comision: CERO,
            flete: CERO,
            costo: CERO,
            empaque: CERO,
            envio: CERO,
            utilidad: CERO,
          },
        };
        cuentas.set(cuenta.cuenta_ml_id, grupo);
      }
      const s = grupo.suma;
      const t = cuenta.totales;
      s.ventas += t.ventas;
      s.ventasSinCosto += t.ventas_sin_costo;
      s.cantidad += t.cantidad;
      s.recaudo += aCentavos(t.recaudo);
      s.recaudoSinCosto += aCentavos(t.recaudo_sin_costo);
      s.comision += aCentavos(t.comision_ml);
      s.flete += aCentavos(t.flete_ml);
      s.costo += aCentavos(t.costo_producto);
      s.empaque += aCentavos(t.empaque);
      s.envio += aCentavos(t.envio);
      s.utilidad += aCentavos(t.utilidad);
    }
  }
  return Array.from(cuentas.entries())
    .map(([cuentaId, { nickname, suma: s }]): ResumenCuenta => {
      const totales: TotalesDetalle = {
        ventas: s.ventas,
        ventas_sin_costo: s.ventasSinCosto,
        recaudo: desdeCentavos(s.recaudo),
        recaudo_sin_costo: desdeCentavos(s.recaudoSinCosto),
        comision_ml: desdeCentavos(s.comision),
        flete_ml: desdeCentavos(s.flete),
        costo_producto: desdeCentavos(s.costo),
        empaque: desdeCentavos(s.empaque),
        envio: desdeCentavos(s.envio),
        utilidad: desdeCentavos(s.utilidad),
        porcentaje_utilidad: porcentaje(s.utilidad, s.recaudo - s.recaudoSinCosto),
        porcentaje_ml: porcentaje(s.comision, s.recaudo),
        cantidad: s.cantidad,
      };
      return { cuenta_ml_id: cuentaId, nickname, totales, porcentaje_ventas_con_costo: porcentajeVentasConCosto(totales) };
    })
    .sort((a, b) => (a.nickname < b.nickname ? -1 : a.nickname > b.nickname ? 1 : a.cuenta_ml_id < b.cuenta_ml_id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Rango de fechas (días de Bogotá)
// ---------------------------------------------------------------------------

export const RANGO_MAXIMO_DIAS = 31;
const DIA_MS = 24 * 60 * 60 * 1000;

export type RangoVentas = {
  // AAAA-MM-DD, tal como vuelven al formulario.
  desde: string;
  hasta: string;
  inicio: Date;
  finExclusivo: Date;
};

// Sin desde/hasta: el mes en curso de Bogotá, completo (un mes nunca
// pasa de 31 días). Railway corre en UTC: el mes se lee del reloj de
// Bogotá, no del servidor.
export function mesActualBogota(ahora: Date): { desde: string; hasta: string } {
  const reloj = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  const anio = reloj.getUTCFullYear();
  const mes = reloj.getUTCMonth();
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const mm = String(mes + 1).padStart(2, "0");
  return { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${String(ultimo).padStart(2, "0")}` };
}

// Valida el rango del formulario. Devuelve el rango o un mensaje claro;
// nunca adivina un rango distinto al pedido (salvo el mes por defecto
// cuando no llega ninguna de las dos fechas).
export function resolverRangoVentas(
  desde: string | undefined,
  hasta: string | undefined,
  ahora: Date
): { rango: RangoVentas; error?: undefined } | { rango?: undefined; error: string } {
  if (!desde && !hasta) ({ desde, hasta } = mesActualBogota(ahora));
  else if (!desde) desde = hasta;
  else if (!hasta) hasta = desde;
  const limitesDesde = limitesDiaBogota(desde);
  const limitesHasta = limitesDiaBogota(hasta);
  if (!limitesDesde || !limitesHasta) return { error: "Las fechas tienen que ir como AAAA-MM-DD y ser días reales." };
  if (limitesHasta.finExclusivo <= limitesDesde.inicio) return { error: "La fecha «hasta» no puede ser anterior a «desde»." };
  const dias = Math.round((limitesHasta.finExclusivo.getTime() - limitesDesde.inicio.getTime()) / DIA_MS);
  if (dias > RANGO_MAXIMO_DIAS) return { error: `El rango puede tener como máximo ${RANGO_MAXIMO_DIAS} días (pediste ${dias}).` };
  return { rango: { desde: desde as string, hasta: hasta as string, inicio: limitesDesde.inicio, finExclusivo: limitesHasta.finExclusivo } };
}

// ---------------------------------------------------------------------------
// URL del detalle (Finanzas → Ventas y Pedidos → Detalle día a día)
// ---------------------------------------------------------------------------

export type FiltrosUrlVentas = { cuenta?: string; desde: string; hasta: string; costo?: "con" | "sin" };

// Arma el href de una página del detalle conservando los filtros. extra
// va primero (p. ej. { vista: "detalle" } en /panel/pedidos) para que la
// misma tabla sirva en las dos rutas sin que una pise los filtros de la
// otra.
export function hrefVentasUtilidad(ruta: string, extra: Record<string, string>, filtros: FiltrosUrlVentas, pagina: number): string {
  const params = new URLSearchParams(extra);
  if (filtros.cuenta) params.set("cuenta", filtros.cuenta);
  params.set("desde", filtros.desde);
  params.set("hasta", filtros.hasta);
  if (filtros.costo) params.set("costo", filtros.costo);
  if (pagina > 1) params.set("pagina", String(pagina));
  return `${ruta}?${params.toString()}`;
}

// /panel/pedidos?vista= — solo "detalle" cambia la vista; cualquier otra
// cosa (o nada) es la lista de siempre.
export type VistaPedidos = "lista" | "detalle";
export function resolverVistaPedidos(valor: string | undefined): VistaPedidos {
  return valor === "detalle" ? "detalle" : "lista";
}
