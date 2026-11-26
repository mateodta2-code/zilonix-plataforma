// Optimización · Análisis — datos: ventas e ingresos de la base de Seller
// (sin llamar a Mercado Libre), visitas de la cuenta de Mercado Libre y el
// agrupado por publicación. La parte pura (recortarPeriodo, agrupar,
// sumarVisitas) se prueba sin base; leerDatosAnalisis solo lee y las junta.
//
// Mismo criterio de venta que Finanzas: estado fuera de
// ESTADOS_QUE_NO_SON_VENTA y sin «cancelada»; las demás se EXCLUYEN y solo
// se cuentan para avisarlo. Ingresos de una línea = cantidad × precioUnitario;
// ventas = órdenes distintas.

import { and, eq, gte, lt } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidoItems, pedidos, pedidosFinanzas, publicaciones } from "@/db/schema";
import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import { aCentavos, desdeCentavos } from "@/lib/finanzas/utilidad-venta";
import { limitesDiaBogota } from "@/lib/filtros-listado";
import { visitasCuentaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { diasEntreInclusive, hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";
import { atribuir, muestraSuficiente, type Atribucion, type PeriodoAtribucion } from "./atribucion";
import { rotuloRango, type PeriodoLista } from "./periodoLista";

// Visitas por publicación aguanta 150 días y hay que cubrir los dos períodos.
export const MAXIMO_DIAS_ANALISIS = 75;
export const TOPE_PUBLICACIONES_VISITAS = 100;
export const FILAS_POR_LISTA = 10;

const CERO = BigInt(0);

export type PeriodoAnalisis = {
  desde: string;
  hasta: string;
  dias: number;
  anteriorDesde: string;
  anteriorHasta: string;
  rotulo: string;
  recortado: boolean; // el período pedido pasaba de 75 días
};

export function recortarPeriodo(p: PeriodoLista): PeriodoAnalisis {
  if (p.dias <= MAXIMO_DIAS_ANALISIS) {
    return { desde: p.desde, hasta: p.hasta, dias: p.dias, anteriorDesde: p.anteriorDesde, anteriorHasta: p.anteriorHasta, rotulo: p.rotulo, recortado: false };
  }
  const desde = restarDiasIso(p.hasta, MAXIMO_DIAS_ANALISIS - 1);
  const anteriorHasta = restarDiasIso(desde, 1);
  return {
    desde,
    hasta: p.hasta,
    dias: MAXIMO_DIAS_ANALISIS,
    anteriorDesde: restarDiasIso(anteriorHasta, MAXIMO_DIAS_ANALISIS - 1),
    anteriorHasta,
    rotulo: rotuloRango(desde, p.hasta),
    recortado: true,
  };
}

// Una línea de venta ya leída de la base.
export type LineaAnalisis = {
  pedidoId: string;
  dia: string; // YYYY-MM-DD de Bogotá
  estado: string;
  cancelada: boolean | null;
  itemId: string;
  cantidad: number;
  precioUnitario: string;
  titulo: string;
  foto: string | null;
};

export type TotalesPeriodo = { ventas: number; ingresos: string };

export type CambioPublicacion = {
  itemId: string;
  titulo: string;
  foto: string | null;
  anterior: TotalesPeriodo;
  actual: TotalesPeriodo;
  cambio: string; // ΔIngresos
};

export type AgrupadoAnalisis = {
  cuenta: { anterior: TotalesPeriodo; actual: TotalesPeriodo };
  canceladas: number; // órdenes excluidas, de los dos períodos
  publicaciones: CambioPublicacion[]; // todas las que vendieron en alguno
};

function esVenta(l: LineaAnalisis): boolean {
  return !ESTADOS_QUE_NO_SON_VENTA.includes(l.estado) && l.cancelada !== true;
}

type Acum = { ordenes: Set<string>; centavos: bigint };
const nuevo = (): Acum => ({ ordenes: new Set(), centavos: CERO });
const cerrar = (a: Acum): TotalesPeriodo => ({ ventas: a.ordenes.size, ingresos: desdeCentavos(a.centavos) });

export function agrupar(lineas: LineaAnalisis[], p: PeriodoAnalisis): AgrupadoAnalisis {
  const cuenta = { anterior: nuevo(), actual: nuevo() };
  const porItem = new Map<string, { titulo: string; foto: string | null; ant: Acum; act: Acum }>();
  const canceladas = new Set<string>();
  for (const l of lineas) {
    const enActual = l.dia >= p.desde && l.dia <= p.hasta;
    const enAnterior = l.dia >= p.anteriorDesde && l.dia <= p.anteriorHasta;
    if (!enActual && !enAnterior) continue;
    if (!esVenta(l)) {
      canceladas.add(l.pedidoId);
      continue;
    }
    const monto = aCentavos(l.precioUnitario) * BigInt(l.cantidad);
    const lado = enActual ? "act" : "ant";
    const total = enActual ? cuenta.actual : cuenta.anterior;
    total.ordenes.add(l.pedidoId);
    total.centavos += monto;
    let item = porItem.get(l.itemId);
    if (!item) {
      item = { titulo: l.titulo, foto: l.foto, ant: nuevo(), act: nuevo() };
      porItem.set(l.itemId, item);
    }
    item[lado].ordenes.add(l.pedidoId);
    item[lado].centavos += monto;
  }
  const publicacionesAgrupadas: CambioPublicacion[] = [...porItem.entries()].map(([itemId, i]) => ({
    itemId,
    titulo: i.titulo,
    foto: i.foto,
    anterior: cerrar(i.ant),
    actual: cerrar(i.act),
    cambio: desdeCentavos(i.act.centavos - i.ant.centavos),
  }));
  return { cuenta: { anterior: cerrar(cuenta.anterior), actual: cerrar(cuenta.actual) }, canceladas: canceladas.size, publicaciones: publicacionesAgrupadas };
}

// Top de mayor caída (ΔIngresos < 0, la más negativa primero) y de mayor
// crecimiento (ΔIngresos > 0). Empate: el id, para que el orden sea estable.
export function topCambios(publicacionesAgrupadas: CambioPublicacion[], n = FILAS_POR_LISTA): { caidas: CambioPublicacion[]; crecimientos: CambioPublicacion[] } {
  const con = publicacionesAgrupadas.map((p) => ({ p, d: aCentavos(p.cambio) }));
  const orden = (a: { p: CambioPublicacion; d: bigint }, b: { p: CambioPublicacion; d: bigint }, signo: bigint) =>
    a.d === b.d ? a.p.itemId.localeCompare(b.p.itemId) : a.d * signo > b.d * signo ? -1 : 1;
  return {
    caidas: con.filter((x) => x.d < CERO).sort((a, b) => orden(a, b, BigInt(-1))).slice(0, n).map((x) => x.p),
    crecimientos: con.filter((x) => x.d > CERO).sort((a, b) => orden(a, b, BigInt(1))).slice(0, n).map((x) => x.p),
  };
}

// Visitas de un mapa día→visitas entre dos días inclusive.
export function sumarVisitas(porDia: Map<string, number>, desde: string, hasta: string): number {
  let total = 0;
  for (const [dia, v] of porDia) if (dia >= desde && dia <= hasta) total += v;
  return total;
}

// Días hacia atrás desde hoy que hay que pedir para cubrir los dos períodos;
// null si pasan de lo que Mercado Libre entrega por publicación (150).
export function ultimosDiasParaVisitas(p: PeriodoAnalisis, hoy: string, maximo: number): number | null {
  const dias = diasEntreInclusive(p.anteriorDesde, hoy);
  return dias >= 1 && dias <= maximo ? dias : null;
}

export type DatosAnalisis = {
  periodo: PeriodoAnalisis;
  agrupado: AgrupadoAnalisis;
  visitas: { anterior: number | null; actual: number | null };
  atribucion: Atribucion | null;
  muestraSuficiente: boolean;
  caidas: CambioPublicacion[];
  crecimientos: CambioPublicacion[];
};

export function armarDatos(periodo: PeriodoAnalisis, agrupado: AgrupadoAnalisis, visitas: { anterior: number | null; actual: number | null }): DatosAnalisis {
  const { anterior, actual } = agrupado.cuenta;
  let atribucion: Atribucion | null = null;
  let suficiente = false;
  if (visitas.anterior !== null && visitas.actual !== null) {
    const ant: PeriodoAtribucion = { visitas: visitas.anterior, ventas: anterior.ventas, ingresos: anterior.ingresos };
    const act: PeriodoAtribucion = { visitas: visitas.actual, ventas: actual.ventas, ingresos: actual.ingresos };
    suficiente = muestraSuficiente(ant, act);
    // Sin muestra suficiente no se reparte nada.
    atribucion = suficiente ? atribuir(ant, act) : null;
  }
  const { caidas, crecimientos } = topCambios(agrupado.publicaciones);
  return { periodo, agrupado, visitas, atribucion, muestraSuficiente: suficiente, caidas, crecimientos };
}

export async function leerDatosAnalisis(
  empresaId: string,
  cuenta: { id: string; cuentaIdExterna: string },
  periodoLista: PeriodoLista
): Promise<DatosAnalisis | null> {
  const periodo = recortarPeriodo(periodoLista);
  const inicio = limitesDiaBogota(periodo.anteriorDesde)?.inicio;
  const fin = limitesDiaBogota(periodo.hasta)?.finExclusivo;
  if (!inicio || !fin) return null;

  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
  const [filas, visitasActual, visitasAnterior] = await Promise.all([
    dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({
          pedidoId: pedidos.id,
          fecha: pedidos.fecha,
          estado: pedidos.estado,
          cancelada: pedidosFinanzas.cancelada,
          itemId: pedidoItems.itemIdExterno,
          cantidad: pedidoItems.cantidad,
          precioUnitario: pedidoItems.precioUnitario,
          tituloLinea: pedidoItems.titulo,
          foto: pedidoItems.imagenUrl,
          tituloPublicacion: publicaciones.titulo,
        })
        .from(pedidoItems)
        .innerJoin(pedidos, and(eq(pedidos.empresaId, pedidoItems.empresaId), eq(pedidos.id, pedidoItems.pedidoId)))
        .leftJoin(pedidosFinanzas, and(eq(pedidosFinanzas.empresaId, pedidos.empresaId), eq(pedidosFinanzas.pedidoId, pedidos.id)))
        .leftJoin(publicaciones, and(eq(publicaciones.empresaId, pedidoItems.empresaId), eq(publicaciones.publicacionIdExterno, pedidoItems.itemIdExterno)))
        .where(and(eq(pedidoItems.empresaId, empresaId), eq(pedidos.cuentaMlId, cuenta.id), gte(pedidos.fecha, inicio), lt(pedidos.fecha, fin)))
    ),
    visitasCuentaMl(cuenta.cuentaIdExterna, token, periodo.desde, restarDiasIso(periodo.hasta, -1)),
    visitasCuentaMl(cuenta.cuentaIdExterna, token, periodo.anteriorDesde, restarDiasIso(periodo.anteriorHasta, -1)),
  ]);

  const lineas: LineaAnalisis[] = filas.map((f) => ({
    pedidoId: f.pedidoId,
    dia: hoyBogota(f.fecha),
    estado: f.estado,
    cancelada: f.cancelada,
    itemId: f.itemId,
    cantidad: f.cantidad,
    precioUnitario: String(f.precioUnitario),
    titulo: f.tituloPublicacion ?? f.tituloLinea,
    foto: f.foto,
  }));
  return armarDatos(periodo, agrupar(lineas, periodo), { anterior: visitasAnterior, actual: visitasActual });
}
