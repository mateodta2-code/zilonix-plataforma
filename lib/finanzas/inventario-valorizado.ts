// Issue #422 — inventario valorizado: cuánta plata tiene la empresa en
// mercancía. Funciones puras: no leen la base ni el reloj (la lectura
// está en inventario-valorizado-db.ts).
//
// Reglas:
// - Unidades = disponible + reservado. Lo reservado sigue siendo
//   mercancía de la empresa hasta que sale (el kardex lo descuenta al
//   despachar). en_transito queda fuera: en Fase 1 el traslado es
//   instantáneo y la columna vale 0 (db/schema.ts, stock_bodega).
// - Costo = resolverCostoSku (combo-sku.ts), la misma regla X2/X3 que
//   usa la utilidad. Un SKU sin costo NO suma un valor inventado: queda
//   "Falta costo" y se cuenta aparte.
// - Ubicaciones: bodegas propias y de terceros (3PL) van juntas como
//   "bodegas"; fulfillment_ml es "full". Falabella todavía no tiene stock
//   en la plataforma (el conector no lo trae): sin datos, nunca un 0.
// - Mercancía en camino = pedido − recibido de las OC abiertas o
//   parciales, al costo de la línea de la OC si existe, si no al de la
//   maestra.
// - Todo el dinero en centavos (bigint), nunca coma flotante.

import { resolverCostoSku, type MaestraSku, type OrigenCosto } from "./combo-sku";
import { aCentavos, desdeCentavos } from "./utilidad-venta";
import { normalizarSkuCodigo } from "@/lib/sku-normalizar";
import { SITE_ID_DEFECTO, SITIOS_ML } from "@/lib/ml/sitios";

export type Ubicacion = "bodegas" | "full" | "falabella";
export const UBICACIONES: { valor: Ubicacion; etiqueta: string }[] = [
  { valor: "bodegas", etiqueta: "Bodegas propias y 3PL" },
  { valor: "full", etiqueta: "Full de Mercado Libre" },
  { valor: "falabella", etiqueta: "Fulfillment Falabella" },
];

export type TipoBodegaInventario = "propia" | "fulfillment_ml" | "tercero";

export function ubicacionDeBodega(tipo: TipoBodegaInventario): Ubicacion {
  return tipo === "fulfillment_ml" ? "full" : "bodegas";
}

export type SaldoStock = {
  skuId: string;
  codigo: string;
  nombre: string;
  bodegaId: string;
  bodegaNombre: string;
  tipoBodega: TipoBodegaInventario;
  disponible: number;
  reservado: number;
};

export type LineaValorizada = {
  skuId: string;
  codigo: string;
  nombre: string;
  bodegaId: string;
  bodegaNombre: string;
  ubicacion: Ubicacion;
  unidades: number;
  // null = falta costo.
  costoUnitario: string | null;
  origenCosto: OrigenCosto | null;
  valor: string | null;
};

export type TotalesInventario = {
  total: string;
  // falabella: null = sin datos todavía (no es un 0).
  porUbicacion: { bodegas: string; full: string; falabella: string | null };
  // SKU distintos con unidades y sin costo; y sus unidades.
  skusSinCosto: number;
  unidadesSinCosto: number;
  // Líneas con saldo negativo: se muestran con aviso, fuera del total.
  saldosNegativos: number;
};

// El código del SKU tal como lo guarda costos_sku (trim + mayúsculas).
function codigoMaestra(codigo: string): string | null {
  try {
    return normalizarSkuCodigo(codigo);
  } catch {
    return null;
  }
}

function costoDeMaestra(codigo: string, maestra: ReadonlyMap<string, MaestraSku>) {
  return resolverCostoSku(codigoMaestra(codigo), maestra);
}

export function valorizarStock(saldos: SaldoStock[], maestra: ReadonlyMap<string, MaestraSku>): LineaValorizada[] {
  const lineas: LineaValorizada[] = [];
  for (const s of saldos) {
    // Sin doble conteo: una reserva pasa unidades de disponible a
    // reservado (lib/inventario/calculos.ts, deltaDeMovimiento), así que
    // los dos números nunca comparten unidades.
    const unidades = s.disponible + s.reservado;
    // Un saldo negativo no se oculta: va a la tabla y a un aviso, fuera
    // del total (la base lo impide con un CHECK; esto es la defensa si
    // alguna vez se colara).
    if (unidades === 0) continue;
    const { costoUnitario, origen } = costoDeMaestra(s.codigo, maestra);
    lineas.push({
      skuId: s.skuId,
      codigo: s.codigo,
      nombre: s.nombre,
      bodegaId: s.bodegaId,
      bodegaNombre: s.bodegaNombre,
      ubicacion: ubicacionDeBodega(s.tipoBodega),
      unidades,
      costoUnitario,
      origenCosto: origen,
      valor: costoUnitario === null ? null : desdeCentavos(aCentavos(costoUnitario) * BigInt(unidades)),
    });
  }
  return lineas.sort((a, b) => a.codigo.localeCompare(b.codigo) || a.bodegaNombre.localeCompare(b.bodegaNombre));
}

export function totalizarInventario(lineas: LineaValorizada[]): TotalesInventario {
  const porUbicacion = { bodegas: BigInt(0), full: BigInt(0) };
  const sinCosto = new Set<string>();
  let unidadesSinCosto = 0;
  let saldosNegativos = 0;
  for (const l of lineas) {
    if (l.unidades < 0) {
      saldosNegativos += 1;
      continue;
    }
    if (l.valor === null) {
      sinCosto.add(l.skuId);
      unidadesSinCosto += l.unidades;
      continue;
    }
    if (l.ubicacion === "falabella") continue;
    porUbicacion[l.ubicacion] += aCentavos(l.valor);
  }
  return {
    total: desdeCentavos(porUbicacion.bodegas + porUbicacion.full),
    porUbicacion: { bodegas: desdeCentavos(porUbicacion.bodegas), full: desdeCentavos(porUbicacion.full), falabella: null },
    skusSinCosto: sinCosto.size,
    unidadesSinCosto,
    saldosNegativos,
  };
}

// Filtro de tienda: deja las líneas de los SKU publicados en esa cuenta
// de ML. Sin tienda, todo. Lo usan la tabla y las tarjetas por igual.
export function filtrarPorTienda<T extends { skuId: string }>(
  lineas: T[],
  tiendasPorSku: ReadonlyMap<string, ReadonlySet<string>>,
  tiendaId: string | undefined
): T[] {
  if (!tiendaId) return lineas;
  return lineas.filter((l) => tiendasPorSku.get(l.skuId)?.has(tiendaId));
}

export type LineaOrdenPendiente = {
  ordenNumero: number;
  skuId: string;
  codigo: string;
  nombre: string;
  cantidadPedida: number;
  cantidadRecibida: number;
  // Costo de la línea de la OC; null = la OC no lo trae.
  costoOrden: string | null;
};

export type OrigenCostoEnCamino = "orden" | "maestra";

export type LineaEnCamino = {
  ordenNumero: number;
  skuId: string;
  codigo: string;
  nombre: string;
  unidades: number;
  costoUnitario: string | null;
  origenCosto: OrigenCostoEnCamino | null;
  valor: string | null;
};

export function valorizarEnCamino(lineas: LineaOrdenPendiente[], maestra: ReadonlyMap<string, MaestraSku>): LineaEnCamino[] {
  const resultado: LineaEnCamino[] = [];
  for (const l of lineas) {
    const unidades = l.cantidadPedida - l.cantidadRecibida;
    // Recibido de más (llegó más de lo pedido): no queda nada en camino.
    if (unidades <= 0) continue;
    // Un costo de OC en 0 no es un costo real (línea cargada sin precio):
    // se usa el de la maestra.
    const costoOrdenReal = l.costoOrden !== null && aCentavos(l.costoOrden) > BigInt(0) ? l.costoOrden : null;
    let costoUnitario: string | null = costoOrdenReal;
    let origenCosto: OrigenCostoEnCamino | null = costoUnitario === null ? null : "orden";
    if (costoUnitario === null) {
      costoUnitario = costoDeMaestra(l.codigo, maestra).costoUnitario;
      origenCosto = costoUnitario === null ? null : "maestra";
    }
    resultado.push({
      ordenNumero: l.ordenNumero,
      skuId: l.skuId,
      codigo: l.codigo,
      nombre: l.nombre,
      unidades,
      costoUnitario,
      origenCosto,
      valor: costoUnitario === null ? null : desdeCentavos(aCentavos(costoUnitario) * BigInt(unidades)),
    });
  }
  return resultado.sort((a, b) => a.ordenNumero - b.ordenNumero || a.codigo.localeCompare(b.codigo));
}

export function totalEnCamino(lineas: LineaEnCamino[]): { total: string; lineasSinCosto: number } {
  let total = BigInt(0);
  let lineasSinCosto = 0;
  for (const l of lineas) {
    if (l.valor === null) lineasSinCosto += 1;
    else total += aCentavos(l.valor);
  }
  return { total: desdeCentavos(total), lineasSinCosto };
}

// La empresa no guarda moneda propia: sale de sus cuentas de Mercado
// Libre (cuentas_ml.moneda, derivada del site_id). Una sola moneda → esa;
// ninguna o varias → la del sitio por defecto, que es en la que se carga
// la maestra de costos hoy.
export function monedaDeEmpresa(monedasCuentas: string[]): string {
  const distintas = [...new Set(monedasCuentas)];
  return distintas.length === 1 ? distintas[0] : SITIOS_ML[SITE_ID_DEFECTO].moneda;
}

// Filtro de ubicación de la URL: lista blanca, nunca el texto crudo.
export function ubicacionValida(valor: string | undefined): Ubicacion | undefined {
  return UBICACIONES.find((u) => u.valor === valor)?.valor;
}
