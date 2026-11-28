import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { kitComponentes, pedidoItems, pedidos, pedidosFinanzas, proyeccionConfiguracion, proyeccionSku, skus } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import { rangoUltimosNDiasBogota } from "@/lib/filtros-listado";
import { ConfiguracionInventarioInvalidaError } from "@/lib/inventario/configuracion";
import { disponiblePublicadoTx } from "@/lib/inventario/stock";
import {
  REGLAS_POR_DEFECTO,
  RUTAS_COMPRA,
  VENTANAS_DIAS,
  proyectar,
  type EntradaProyeccion,
  type ReglasProyeccion,
  type ResultadoProyeccion,
  type RutaCompra,
  type VentanaDias,
} from "@/lib/inventario/proyeccion";

// Proyección de inventarios — lecturas y escrituras. Todo sale de la
// base propia de Seller (stock de las bodegas y ventas ya importadas de
// ML): nunca se llama a Mercado Libre ni a un tercero desde acá.

type Tx = typeof db;

// Un listado enorme no se pinta entero: la proyección sirve para decidir
// qué comprar, y un SKU sin stock ni ventas no tiene nada que proyectar.
export const TOPE_SKUS_PROYECCION = 1000;

export async function leerReglasProyeccionTx(tx: Tx, empresaId: string): Promise<ReglasProyeccion> {
  const [f] = await tx.select().from(proyeccionConfiguracion).where(eq(proyeccionConfiguracion.empresaId, empresaId));
  if (!f) return structuredClone(REGLAS_POR_DEFECTO);
  return {
    coberturaDias: f.coberturaDias,
    colchonPorcentaje: f.colchonPorcentaje,
    ventanaDias: f.ventanaDias as VentanaDias,
    leadPorRuta: { nacional: f.leadNacionalDias, plataforma: f.leadPlataformaDias, avion: f.leadAvionDias },
  };
}

export async function leerReglasProyeccion(empresaId: string): Promise<ReglasProyeccion> {
  return dbComoEmpresa(empresaId, (tx) => leerReglasProyeccionTx(tx, empresaId));
}

function enteroEnRango(valor: number, minimo: number, maximo: number, nombre: string): void {
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new ConfiguracionInventarioInvalidaError(`${nombre} tiene que ser un número entero entre ${minimo} y ${maximo}.`);
  }
}

export function validarReglas(r: ReglasProyeccion): void {
  enteroEnRango(r.coberturaDias, 1, 365, "Los días de cobertura");
  enteroEnRango(r.colchonPorcentaje, 0, 200, "El colchón");
  if (!VENTANAS_DIAS.includes(r.ventanaDias)) throw new ConfiguracionInventarioInvalidaError("Elige una ventana de 3, 7, 14, 20 o 30 días.");
  for (const ruta of RUTAS_COMPRA) enteroEnRango(r.leadPorRuta[ruta], 0, 365, "Los días de entrega");
}

export async function guardarReglasProyeccion(empresaId: string, usuarioId: string, reglas: ReglasProyeccion): Promise<void> {
  validarReglas(reglas);
  await dbComoEmpresa(empresaId, async (tx) => {
    const anterior = await leerReglasProyeccionTx(tx, empresaId);
    const valores = {
      coberturaDias: reglas.coberturaDias,
      colchonPorcentaje: reglas.colchonPorcentaje,
      ventanaDias: reglas.ventanaDias,
      leadNacionalDias: reglas.leadPorRuta.nacional,
      leadPlataformaDias: reglas.leadPorRuta.plataforma,
      leadAvionDias: reglas.leadPorRuta.avion,
      actualizadaTs: new Date(),
      actualizadaPor: usuarioId,
    };
    await tx
      .insert(proyeccionConfiguracion)
      .values({ empresaId, ...valores })
      .onConflictDoUpdate({ target: proyeccionConfiguracion.empresaId, set: valores });
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "inventario.proyeccion_reglas_actualizadas",
      entidad: "proyeccion_configuracion",
      entidadId: empresaId,
      valorAnterior: JSON.stringify(anterior),
      valorNuevo: JSON.stringify(reglas),
    });
  });
}

// Cómo se compra un SKU y cuántos días tarda. leadTimeDias null = el de
// la ruta. El SKU tiene que ser de la empresa (la FK compuesta lo
// obliga también en la base).
export async function guardarEntregaSku(
  empresaId: string,
  usuarioId: string,
  datos: { skuId: string; ruta: RutaCompra; leadTimeDias: number | null }
): Promise<void> {
  if (!RUTAS_COMPRA.includes(datos.ruta)) throw new ConfiguracionInventarioInvalidaError("Esa forma de compra no existe.");
  if (datos.leadTimeDias !== null) enteroEnRango(datos.leadTimeDias, 0, 365, "Los días de entrega");
  await dbComoEmpresa(empresaId, async (tx) => {
    const [sku] = await tx.select({ id: skus.id, codigo: skus.codigo }).from(skus).where(and(eq(skus.empresaId, empresaId), eq(skus.id, datos.skuId)));
    if (!sku) throw new ConfiguracionInventarioInvalidaError("Ese SKU no existe en esta empresa.");
    const valores = { ruta: datos.ruta, leadTimeDias: datos.leadTimeDias, actualizadaTs: new Date() };
    await tx
      .insert(proyeccionSku)
      .values({ empresaId, skuId: datos.skuId, ...valores })
      .onConflictDoUpdate({ target: [proyeccionSku.empresaId, proyeccionSku.skuId], set: valores });
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "inventario.proyeccion_entrega_sku",
      entidad: "proyeccion_sku",
      entidadId: datos.skuId,
      valorNuevo: JSON.stringify({ codigo: sku.codigo, ...datos }),
    });
  });
}

// Unidades vendidas en ML por SKU en cada ventana (3, 7, 14, 20, 30
// días de Bogotá). Mismo criterio de "qué es una venta" que los Días de
// stock de Inventario (ventasUltimos30DiasTx): sin estados que no son
// venta, sin canceladas por finanzas y sin Full (Full sale del inventario
// de ML, no del nuestro). Una venta de un kit suma a sus componentes.
export async function ventasPorVentanasTx(
  tx: Tx,
  empresaId: string,
  skuIds: string[],
  ahora: Date = new Date()
): Promise<Map<string, Record<VentanaDias, number>>> {
  const vacio = (): Record<VentanaDias, number> => ({ 3: 0, 7: 0, 14: 0, 20: 0, 30: 0 });
  const resultado = new Map<string, Record<VentanaDias, number>>(skuIds.map((id) => [id, vacio()]));
  if (skuIds.length === 0) return resultado;

  const componentes = await tx
    .select({ kitId: kitComponentes.skuKitId, skuId: kitComponentes.skuComponenteId, cantidad: kitComponentes.cantidad })
    .from(kitComponentes)
    .where(and(eq(kitComponentes.empresaId, empresaId), inArray(kitComponentes.skuComponenteId, skuIds)));
  const idsVenta = [...new Set([...skuIds, ...componentes.map((c) => c.kitId)])];
  const { finExclusivo } = rangoUltimosNDiasBogota(ahora, 30);
  const inicioDe = (dias: number) => rangoUltimosNDiasBogota(ahora, dias).inicio;
  const suma = (dias: number) => sql<number>`coalesce(sum(${pedidoItems.cantidad}) filter (where ${pedidos.fecha} >= ${inicioDe(dias)}), 0)::int`;

  const filas = await tx
    .select({ skuId: pedidoItems.skuId, d3: suma(3), d7: suma(7), d14: suma(14), d20: suma(20), d30: suma(30) })
    .from(pedidoItems)
    .innerJoin(pedidos, and(eq(pedidos.empresaId, pedidoItems.empresaId), eq(pedidos.id, pedidoItems.pedidoId)))
    .leftJoin(pedidosFinanzas, and(eq(pedidosFinanzas.empresaId, pedidoItems.empresaId), eq(pedidosFinanzas.pedidoId, pedidoItems.pedidoId)))
    .where(
      and(
        eq(pedidoItems.empresaId, empresaId),
        isNotNull(pedidoItems.skuId),
        inArray(pedidoItems.skuId, idsVenta),
        gte(pedidos.fecha, inicioDe(30)),
        lt(pedidos.fecha, finExclusivo),
        notInArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA),
        or(isNull(pedidosFinanzas.id), and(eq(pedidosFinanzas.cancelada, false), ne(pedidosFinanzas.formaEntrega, "full_ml")))
      )
    )
    .groupBy(pedidoItems.skuId);

  const propias = new Map(filas.map((f) => [f.skuId as string, { 3: Number(f.d3), 7: Number(f.d7), 14: Number(f.d14), 20: Number(f.d20), 30: Number(f.d30) } as Record<VentanaDias, number>]));
  for (const id of skuIds) {
    const v = propias.get(id);
    if (v) resultado.set(id, { ...v });
  }
  for (const c of componentes) {
    const deKit = propias.get(c.kitId);
    if (!deKit) continue;
    const destino = resultado.get(c.skuId) ?? vacio();
    for (const d of VENTANAS_DIAS) destino[d] += deKit[d] * c.cantidad;
    resultado.set(c.skuId, destino);
  }
  return resultado;
}

export type ProyeccionEmpresa = { reglas: ReglasProyeccion; filas: ResultadoProyeccion[]; recortado: boolean };

// Los SKU simples (los kits se arman con sus componentes) que tienen
// stock o vendieron algo en 30 días, proyectados con las reglas de la
// empresa.
export async function calcularProyeccion(
  empresaId: string,
  opciones: { ahora?: Date; ventanaDias?: VentanaDias } = {}
): Promise<ProyeccionEmpresa> {
  const ahora = opciones.ahora ?? new Date();
  return dbComoEmpresa(empresaId, async (tx) => {
    // La ventana de la URL solo cambia esta vista; la que se guarda es la de las reglas.
    const guardadas = await leerReglasProyeccionTx(tx, empresaId);
    const reglas = { ...guardadas, ventanaDias: opciones.ventanaDias ?? guardadas.ventanaDias };
    const todos = await tx
      .select({ id: skus.id, codigo: skus.codigo, nombre: skus.nombre })
      .from(skus)
      .where(and(eq(skus.empresaId, empresaId), eq(skus.esKit, false)))
      .orderBy(asc(skus.codigo));
    const ids = todos.map((s) => s.id);
    const [stock, ventas, entregas] = await Promise.all([
      disponiblePublicadoTx(tx, empresaId, ids),
      ventasPorVentanasTx(tx, empresaId, ids, ahora),
      ids.length ? tx.select().from(proyeccionSku).where(eq(proyeccionSku.empresaId, empresaId)) : Promise.resolve([]),
    ]);
    const entregaPorSku = new Map(entregas.map((e) => [e.skuId, e]));
    const entradas: EntradaProyeccion[] = [];
    for (const s of todos) {
      const v = ventas.get(s.id) ?? { 3: 0, 7: 0, 14: 0, 20: 0, 30: 0 };
      const disponible = stock.get(s.id) ?? 0;
      if (disponible <= 0 && v[30] <= 0) continue;
      const e = entregaPorSku.get(s.id);
      entradas.push({
        skuId: s.id,
        codigo: s.codigo,
        nombre: s.nombre,
        stock: disponible,
        vendidas: v,
        ruta: (e?.ruta as RutaCompra | undefined) ?? "plataforma",
        leadTimeDias: e?.leadTimeDias ?? null,
      });
    }
    const recortado = entradas.length > TOPE_SKUS_PROYECCION;
    return { reglas, filas: proyectar(entradas.slice(0, TOPE_SKUS_PROYECCION), reglas, ahora), recortado };
  });
}
