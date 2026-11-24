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
// - Dos pedidos de la misma cuenta que reclaman el mismo número (OrderId
//   u OrderNumber, revisión de Pablo en #475) → «conflicto» en los dos:
//   no se sabe de cuál son las líneas del reporte y sumarlas en ambos
//   contaría la misma plata dos veces. Quedan fuera de los totales.
// - Sin reporte TODAVÍA pero con ítems de la API (GetOrderItems) → utilidad
//   «Estimada»: ventas = precio de los ítems, comisión con el último % real
//   del mismo SKU (o la mediana de la cuenta si el SKU es nuevo) y envío
//   neto con el último envío unitario real del SKU. En cuanto llega el
//   reporte, la orden pasa sola a «Calculada» con los cobros reales. La
//   utilidad estimada NUNCA se suma a la del periodo: va en su propio total.
// - Cuenta nueva sin ningún reporte: si tiene configurado el % de comisión
//   por defecto (y opcionalmente el flete por defecto por unidad), se
//   estima con eso en vez de dejarla «Sin reporte».
// - Ajustes a mano por orden (pedidos_falabella): costo_manual REEMPLAZA el
//   costo de la maestra de esa orden (aunque a un SKU le falte costo) y
//   flete_manual es un flete adicional que resta en envíos y en utilidad.
//   Valen con y sin reporte; ni el reporte ni la sincronización los pisan.

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
  // Los números con los que se busca la orden en el reporte, EN ORDEN DE
  // PRIORIDAD: el OrderNumber de GetOrders (numero_orden) y después el
  // OrderId de respaldo (ver consulta). Se usa uno solo: el primero que
  // tenga líneas.
  numeros: string[];
  // Lo que se muestra como «Orden»: el OrderNumber, que ve el cliente.
  numeroVisible: string;
  // El OrderId interno, para mostrarlo en gris; null si no hay OrderNumber.
  numeroInterno?: string | null;
  cuentaId: string;
  cuenta: string;
  fecha: Date;
  moneda: string;
  // Ítems activos de GetOrderItems (sin cancelados ni fallidos). `precio`
  // en texto con 2 decimales; `envioPropio` = envío directo/domiciliario.
  itemsApi?: ItemApiFalabella[];
  // Ajustes a mano ("12345.00", >= 0); null = sin ajuste.
  costoManual?: string | null;
  fleteManual?: string | null;
}

// Respaldo de la cuenta para estimar sin historial (cuentas_falabella).
// comisionPct "15.50" = 15,50 %; flete por unidad. null = no configurado.
export interface DefectosCuentaFalabella {
  comisionPct: string | null;
  flete: string | null;
}

export interface ItemApiFalabella {
  sku: string | null;
  nombre: string | null;
  precio: string;
  envioPropio?: boolean;
}

export interface MovimientoEntrada {
  cuentaId: string;
  numeroOrden: string | null;
  sku: string | null;
  categoria: CategoriaMovimiento;
  monto: string;
  // El «Tipo de transacción» del reporte, tal cual (para detectar el
  // «Pago por envío directo»).
  tipoTransaccion?: string | null;
}

// Referencia para estimar una orden sin reporte. Clave `cuentaId|SKU`
// (SKU normalizado) y respaldo de la cuenta `cuentaId|*`.
export interface ReferenciaEstimacionFalabella {
  // Comisión CON SIGNO ÷ precio, en diezmilésimas: -1554 = -15,54 %.
  tasaComisionDiezmilesimas: bigint;
  // Envío neto CON SIGNO por unidad, en centavos.
  envioNetoUnitarioCentavos: bigint;
}

export type EstadoUtilidadFalabella = "calculada" | "estimada" | "falta_costo" | "sin_reporte" | "conflicto";

export interface ProductoOrdenFalabella {
  nombre: string;
  sku: string | null;
  cantidad: number;
}

export interface OrdenUtilidadFalabella {
  pedidoId: string;
  numero: string;
  numeroInterno: string | null;
  cuentaId: string;
  cuenta: string;
  fecha: Date;
  moneda: string;
  estado: EstadoUtilidadFalabella;
  cantidad: number;
  // Montos en texto con 2 decimales. Con «sin_reporte» o «conflicto»
  // todos van en 0.00.
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
  // Con «conflicto»: los números que comparte con otro pedido.
  numerosRepetidos: string[];
  // Agrupados por SKU y nombre (de la API; si no hay ítems, del reporte).
  productos: ProductoOrdenFalabella[];
  // Envío directo / domiciliario: el flete lo pone el vendedor.
  envioPropio: boolean;
  // Los ajustes a mano guardados en la orden (aunque no se hayan podido
  // aplicar, p. ej. en «conflicto»), para precargar los lápices.
  costoManual: string | null;
  fleteManual: string | null;
}

export interface TotalesUtilidadFalabella {
  ordenes: number;
  ordenesCalculadas: number;
  // Calculadas + falta costo CON reporte (las de «Ventas»).
  ordenesConReporte: number;
  ordenesFaltaCosto: number;
  ordenesSinReporte: number;
  ordenesConflicto: number;
  cantidad: number;
  // Ventas de las órdenes con reporte (con y sin costo).
  ventas: string;
  // Incluye las órdenes sin reporte a las que les falta costo (ventas de
  // la API).
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
  // utilidadOrdenes + cargosSinOrden. Solo plata confirmada por el
  // reporte: las estimadas van aparte.
  utilidadPeriodo: string;
  ordenesEstimadas: number;
  ventasEstimadas: string;
  utilidadEstimadas: string;
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

const DOS = BigInt(2);

// a ÷ b redondeando la mitad lejos de cero. b > 0.
function dividirRedondeado(a: bigint, b: bigint): bigint {
  const negativo = a < CERO;
  const absoluto = negativo ? -a : a;
  const q = (absoluto * DOS + b) / (DOS * b);
  return negativo ? -q : q;
}

function mediana(valores: bigint[]): bigint | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 1 ? orden[medio] : dividirRedondeado(orden[medio - 1] + orden[medio], DOS);
}

// «Pago por envío directo» (con o sin tilde, en cualquier caja): la orden
// la despachó el vendedor con su propio flete.
export function esEnvioDirecto(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const plano = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return plano.includes("envio directo");
}

const PATRON_PRECIO_ITEM = /^\d+(\.\d{1,2})?$/;

// Precio de un ítem de la API en centavos; null si no es un monto válido
// (nunca rompe la pantalla por un ítem raro).
function precioItemCentavos(precio: string): bigint | null {
  return PATRON_PRECIO_ITEM.test(precio) ? aCentavos(precio) : null;
}

export const claveReferenciaCuenta = (cuentaId: string) => `${cuentaId}|*`;

// Referencias para estimar órdenes sin reporte, desde el historial de
// movimientos_marketplace. Los movimientos llegan DEL MÁS RECIENTE AL MÁS
// VIEJO (la consulta los ordena por fecha de transacción): el primero que
// aparece de cada SKU es su último reporte.
// - Tasa de comisión: la de la última orden con ese SKU.
// - Envío neto unitario: el de la última orden con ese SKU que NO fue de
//   envío directo (esas tienen flete propio y no sirven de referencia).
// - Respaldo de la cuenta (`cuentaId|*`): la mediana de todas sus órdenes,
//   para el SKU que todavía no tiene reportes.
export function construirReferenciasEstimacionFalabella(
  movimientos: readonly MovimientoEntrada[]
): Map<string, ReferenciaEstimacionFalabella> {
  type Grupo = { cuentaId: string; precio: bigint; comision: bigint; envio: bigint; unidades: number; skus: Set<string>; envioPropio: boolean };
  const grupos = new Map<string, Grupo>();
  for (const m of movimientos) {
    if (!m.numeroOrden || !m.numeroOrden.trim()) continue;
    let monto: bigint;
    try {
      monto = aDiezmilesimas(m.monto);
    } catch {
      continue;
    }
    const k = clave(m.cuentaId, m.numeroOrden);
    let g = grupos.get(k);
    if (!g) {
      g = { cuentaId: m.cuentaId, precio: CERO, comision: CERO, envio: CERO, unidades: 0, skus: new Set(), envioPropio: false };
      grupos.set(k, g);
    }
    if (esEnvioDirecto(m.tipoTransaccion)) g.envioPropio = true;
    if (m.categoria === "precio") {
      g.precio += monto;
      if (monto > CERO) {
        g.unidades += 1;
        const sku = normalizarOVacio(m.sku);
        if (sku) g.skus.add(sku);
      }
    } else if (m.categoria === "comision") g.comision += monto;
    else if (m.categoria === "envio") g.envio += monto;
  }

  const porSku = new Map<string, { tasa: bigint; envio: bigint | null }>();
  const tasasCuenta = new Map<string, bigint[]>();
  const enviosCuenta = new Map<string, bigint[]>();
  for (const g of grupos.values()) {
    if (g.precio <= CERO || g.unidades === 0) continue;
    const tasa = dividirRedondeado(g.comision * DIEZ_MIL, g.precio);
    const envio = g.envioPropio ? null : aCentavosRedondeado(dividirRedondeado(g.envio, BigInt(g.unidades)));
    tasasCuenta.set(g.cuentaId, [...(tasasCuenta.get(g.cuentaId) ?? []), tasa]);
    if (envio !== null) enviosCuenta.set(g.cuentaId, [...(enviosCuenta.get(g.cuentaId) ?? []), envio]);
    for (const sku of g.skus) {
      const k = `${g.cuentaId}|${sku}`;
      const ref = porSku.get(k);
      if (!ref) porSku.set(k, { tasa, envio });
      else if (ref.envio === null && envio !== null) ref.envio = envio;
    }
  }

  const referencias = new Map<string, ReferenciaEstimacionFalabella>();
  for (const [cuentaId, tasas] of tasasCuenta) {
    referencias.set(claveReferenciaCuenta(cuentaId), {
      tasaComisionDiezmilesimas: mediana(tasas) ?? CERO,
      envioNetoUnitarioCentavos: mediana(enviosCuenta.get(cuentaId) ?? []) ?? CERO,
    });
  }
  for (const [k, ref] of porSku) {
    const cuentaId = k.slice(0, k.lastIndexOf("|"));
    referencias.set(k, {
      tasaComisionDiezmilesimas: ref.tasa,
      envioNetoUnitarioCentavos: ref.envio ?? referencias.get(claveReferenciaCuenta(cuentaId))?.envioNetoUnitarioCentavos ?? CERO,
    });
  }
  return referencias;
}

// Issue #422 — la maestra para costear Falabella: cada fila por su
// sku_codigo y, de respaldo, por su alias sku_falabella. La coincidencia
// exacta en sku_codigo SIEMPRE gana: un alias nunca tapa el código real de
// otro SKU. Las claves van normalizadas (mayúsculas, sin espacios).
export function construirMaestraFalabella(
  filas: readonly (MaestraSku & { sku: string; skuFalabella: string | null })[]
): Map<string, MaestraSku> {
  const maestra = new Map<string, MaestraSku>();
  const datos = (f: (typeof filas)[number]): MaestraSku => ({
    costo: f.costo,
    empaque: f.empaque,
    envioAgencia: f.envioAgencia,
    empaqueProveedor: f.empaqueProveedor,
  });
  for (const f of filas) maestra.set(f.sku, datos(f));
  for (const f of filas) {
    const alias = normalizarOVacio(f.skuFalabella);
    if (alias && !maestra.has(alias)) maestra.set(alias, datos(f));
  }
  return maestra;
}

function agruparProductos(items: readonly ItemApiFalabella[], skusReporte: readonly (string | null)[]): ProductoOrdenFalabella[] {
  const fuente =
    items.length > 0
      ? items.map((i) => ({ sku: i.sku?.trim() || null, nombre: i.nombre?.trim() || i.sku?.trim() || "(sin nombre)" }))
      : skusReporte.map((s) => ({ sku: s?.trim() || null, nombre: s?.trim() || "(sin SKU)" }));
  const grupos = new Map<string, ProductoOrdenFalabella>();
  for (const f of fuente) {
    const k = `${f.sku ?? ""}|${f.nombre}`;
    const g = grupos.get(k);
    if (g) g.cantidad += 1;
    else grupos.set(k, { ...f, cantidad: 1 });
  }
  return [...grupos.values()];
}

export function calcularUtilidadFalabella(entrada: {
  pedidos: PedidoFalabellaEntrada[];
  // Las líneas de las órdenes (con Nº de orden) y las del periodo sin
  // orden. Una línea con orden que no es de ningún pedido de la lista se
  // ignora: es de una orden fuera del filtro.
  movimientos: MovimientoEntrada[];
  maestra: ReadonlyMap<string, MaestraSku>;
  // De construirReferenciasEstimacionFalabella. Sin esto, las órdenes sin
  // reporte quedan «sin_reporte» como antes.
  referenciasEstimacion?: ReadonlyMap<string, ReferenciaEstimacionFalabella>;
  // Clave: cuentaId. Respaldo para cuentas sin ningún reporte.
  defectosCuenta?: ReadonlyMap<string, DefectosCuentaFalabella>;
}): ResultadoUtilidadFalabella {
  const porOrden = new Map<string, { suma: Suma; skusVendidos: (string | null)[]; envioPropio: boolean }>();
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
      grupo = { suma: sumaVacia(), skusVendidos: [], envioPropio: false };
      porOrden.set(k, grupo);
    }
    if (esEnvioDirecto(m.tipoTransaccion)) grupo.envioPropio = true;
    grupo.suma[m.categoria] += monto;
    if (m.categoria === "precio" && monto > CERO) grupo.skusVendidos.push(m.sku);
  }

  const t = {
    calculadas: 0,
    conReporte: 0,
    estimadas: 0,
    ventasEstimadas: CERO,
    utilidadEstimadas: CERO,
    faltaCosto: 0,
    sinReporte: 0,
    conflicto: 0,
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

  // Revisión de Pablo en #482: cada pedido usa UNA sola clave, la primera
  // de `numeros` que tenga líneas — el OrderId de respaldo solo cuenta si
  // el OrderNumber no encontró nada, así las mismas líneas no se suman
  // dos veces. Y un respaldo nunca toma la clave que es el número
  // principal de OTRO pedido de la cuenta (un OrderId que coincide con el
  // OrderNumber ajeno): esas líneas son del otro.
  const clavesDe = (p: PedidoFalabellaEntrada) => [...new Set(p.numeros.filter((n) => n.trim()).map((n) => clave(p.cuentaId, n)))];
  const principales = new Map<string, Set<string>>();
  for (const p of entrada.pedidos) {
    const k = clavesDe(p)[0];
    if (!k) continue;
    const dueños = principales.get(k) ?? new Set<string>();
    dueños.add(p.pedidoId);
    principales.set(k, dueños);
  }
  const claveUsada = (p: PedidoFalabellaEntrada): string | null => {
    for (const [i, k] of clavesDe(p).entries()) {
      if (!porOrden.has(k)) continue;
      const esPrincipalAjena = i > 0 && [...(principales.get(k) ?? [])].some((id) => id !== p.pedidoId);
      if (!esPrincipalAjena) return k;
    }
    return null;
  };
  const usadas = new Map(entrada.pedidos.map((p) => [p.pedidoId, claveUsada(p)]));
  // Dos pedidos que terminan usando la misma clave → conflicto en los dos.
  const pedidosPorClave = new Map<string, Set<string>>();
  for (const [pedidoId, k] of usadas) {
    if (!k) continue;
    const dueños = pedidosPorClave.get(k) ?? new Set<string>();
    dueños.add(pedidoId);
    pedidosPorClave.set(k, dueños);
  }

  // Montos manuales en centavos; un valor raro se ignora (nunca rompe la
  // pantalla) y la base ya exige >= 0.
  const manual = (valor: string | null | undefined): bigint | null => {
    if (valor === null || valor === undefined) return null;
    return precioItemCentavos(valor);
  };

  // Referencia armada con los valores por defecto de la cuenta; null si
  // no tiene comisión configurada (el flete vacío cuenta como 0).
  const referenciaDefecto = (cuentaId: string): ReferenciaEstimacionFalabella | null => {
    const d = entrada.defectosCuenta?.get(cuentaId);
    const pct = manual(d?.comisionPct);
    if (!d || pct === null) return null;
    // 15.50 % = 1550 centavos = 0,1550 = 1550 diezmilésimas: mismo número.
    return { tasaComisionDiezmilesimas: -pct, envioNetoUnitarioCentavos: -(manual(d.flete) ?? CERO) };
  };

  const vacia = {
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

  // Orden sin líneas de precio en el reporte. Con ítems de la API se
  // muestran producto, cantidad y ventas; con costo y una referencia de la
  // cuenta, además una utilidad «Estimada».
  const estimarSinReporte = (
    p: PedidoFalabellaEntrada,
    base: Omit<OrdenUtilidadFalabella, keyof typeof vacia | "estado" | "numerosRepetidos">,
    itemsApi: readonly ItemApiFalabella[],
    envioPropio: boolean,
    costoManual: bigint | null,
    fleteManual: bigint | null
  ): OrdenUtilidadFalabella => {
    const activos = itemsApi.flatMap((i) => {
      const precio = precioItemCentavos(i.precio);
      return precio !== null && precio > CERO ? [{ ...i, precioCentavos: precio }] : [];
    });
    if (activos.length === 0) {
      t.sinReporte += 1;
      return { ...base, ...vacia, estado: "sin_reporte", numerosRepetidos: [] };
    }
    const ventas = activos.reduce((suma, i) => suma + i.precioCentavos, CERO);
    const visibles = { ...vacia, cantidad: activos.length, ventas: desdeCentavos(ventas), numerosRepetidos: [] };

    let costo = CERO;
    const skusSinCosto: string[] = [];
    if (costoManual !== null) costo = costoManual;
    else {
      for (const i of activos) {
        const { costoUnitario } = resolverCostoSku(normalizarOVacio(i.sku), entrada.maestra);
        if (costoUnitario === null) skusSinCosto.push(i.sku ?? "(sin SKU)");
        else costo += aCentavos(costoUnitario);
      }
    }
    if (skusSinCosto.length > 0) {
      t.faltaCosto += 1;
      t.ventasFaltaCosto += ventas;
      return { ...base, ...visibles, estado: "falta_costo", skusSinCosto: [...new Set(skusSinCosto)] };
    }

    let comisiones = CERO;
    let envios = CERO;
    const defecto = referenciaDefecto(p.cuentaId);
    for (const i of activos) {
      const sku = normalizarOVacio(i.sku);
      const ref =
        (sku ? entrada.referenciasEstimacion?.get(`${p.cuentaId}|${sku}`) : undefined) ??
        entrada.referenciasEstimacion?.get(claveReferenciaCuenta(p.cuentaId)) ??
        // Cuenta nueva sin historial: lo configurado a mano para la cuenta.
        defecto;
      // Ni historial ni comisión por defecto: no hay con qué estimar.
      if (!ref) {
        t.sinReporte += 1;
        return { ...base, ...visibles, estado: "sin_reporte" };
      }
      comisiones += dividirRedondeado(i.precioCentavos * ref.tasaComisionDiezmilesimas, DIEZ_MIL);
      if (!envioPropio) envios += ref.envioNetoUnitarioCentavos;
    }
    if (fleteManual !== null) envios -= fleteManual;
    const utilidad = ventas + comisiones + envios - costo;
    t.estimadas += 1;
    t.ventasEstimadas += ventas;
    t.utilidadEstimadas += utilidad;
    return {
      ...base,
      ...visibles,
      estado: "estimada",
      comisiones: desdeCentavos(comisiones),
      envios: desdeCentavos(envios),
      costo: desdeCentavos(costo),
      utilidad: desdeCentavos(utilidad),
      porcentajeUtilidad: porcentaje(utilidad, ventas),
    };
  };

  const ordenes = entrada.pedidos.map((p): OrdenUtilidadFalabella => {
    const usada = usadas.get(p.pedidoId) ?? null;
    const suma = sumaVacia();
    const skusVendidos: (string | null)[] = [];
    const grupo = usada ? porOrden.get(usada) : undefined;
    if (grupo) {
      for (const c of Object.keys(suma) as CategoriaMovimiento[]) suma[c] += grupo.suma[c];
      skusVendidos.push(...grupo.skusVendidos);
    }
    const itemsApi = p.itemsApi ?? [];
    const envioPropio = (grupo?.envioPropio ?? false) || itemsApi.some((i) => i.envioPropio === true);
    const costoManual = manual(p.costoManual);
    const fleteManual = manual(p.fleteManual);
    const base = {
      pedidoId: p.pedidoId,
      numero: p.numeroVisible,
      numeroInterno: p.numeroInterno ?? null,
      cuentaId: p.cuentaId,
      cuenta: p.cuenta,
      fecha: p.fecha,
      moneda: p.moneda,
      productos: agruparProductos(itemsApi, skusVendidos),
      envioPropio,
      costoManual: costoManual === null ? null : desdeCentavos(costoManual),
      fleteManual: fleteManual === null ? null : desdeCentavos(fleteManual),
    };

    const repetidas = usada && (pedidosPorClave.get(usada)?.size ?? 0) > 1 ? [usada] : [];
    if (repetidas.length > 0) {
      t.conflicto += 1;
      return { ...base, ...vacia, estado: "conflicto", numerosRepetidos: repetidas.map((k) => k.slice(k.indexOf("|") + 1)) };
    }

    if (skusVendidos.length === 0) return estimarSinReporte(p, base, itemsApi, envioPropio, costoManual, fleteManual);

    const ventas = aCentavosRedondeado(suma.precio);
    const comisiones = aCentavosRedondeado(suma.comision);
    // El flete manual es un costo adicional del vendedor: resta encima del
    // envío neto del reporte, que se conserva tal cual.
    const envios = aCentavosRedondeado(suma.envio) - (fleteManual ?? CERO);
    const promociones = aCentavosRedondeado(suma.promocion);
    const otros = aCentavosRedondeado(suma.devolucion + suma.fulfillment + suma.ajuste + suma.otro + suma.publicidad);
    const retenciones = aCentavosRedondeado(suma.retencion);

    let costo = CERO;
    const skusSinCosto: string[] = [];
    if (costoManual !== null) costo = costoManual;
    else {
      for (const sku of skusVendidos) {
        const { costoUnitario } = resolverCostoSku(normalizarOVacio(sku), entrada.maestra);
        if (costoUnitario === null) skusSinCosto.push(sku ?? "(sin SKU)");
        else costo += aCentavos(costoUnitario);
      }
    }
    const sinCosto = skusSinCosto.length > 0;
    const utilidad = ventas + comisiones + envios + promociones + otros - costo;

    t.conReporte += 1;
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
      numerosRepetidos: [],
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
      ordenesConReporte: t.conReporte,
      ordenesEstimadas: t.estimadas,
      ventasEstimadas: desdeCentavos(t.ventasEstimadas),
      utilidadEstimadas: desdeCentavos(t.utilidadEstimadas),
      ordenesFaltaCosto: t.faltaCosto,
      ordenesSinReporte: t.sinReporte,
      ordenesConflicto: t.conflicto,
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
