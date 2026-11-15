import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { alertasUltimaUnidad, bodegas, kardexMovimientos, kitComponentes, skus, stockBodega, syncStockMl } from "@/db/schema";
import {
  aplicarDelta,
  cruzaUmbralUltimaUnidad,
  deltaDeMovimiento,
  esUuid,
  saldoValido,
  StockInsuficienteError,
  type Delta,
  type Saldo,
  type TipoMovimiento,
} from "@/lib/inventario/calculos";
import { leerConfiguracionInventarioTx } from "@/lib/inventario/configuracion";
import { disponiblePublicadoTx } from "@/lib/inventario/stock";

// Issue #280 — ÚNICA puerta de escritura del stock. Nada más en el
// código hace UPDATE de stock_bodega: cada cambio pasa por acá, deja su
// fila en el kardex en la misma transacción y marca el SKU para el
// envío a ML. Si alguna línea deja un saldo negativo, no se aplica
// ninguna (todo o nada).

type Tx = typeof db;
export type OrigenMovimiento = (typeof kardexMovimientos.$inferInsert)["origen"];
export type ActorMovimiento = { tipo: "persona"; usuarioId: string } | { tipo: "sistema" };

export type LineaMovimiento =
  | { tipo: Exclude<TipoMovimiento, "traslado">; bodegaId: string; skuId: string; cantidad: number }
  | { tipo: "traslado"; bodegaId: string; bodegaDestinoId: string; skuId: string; cantidad: number };

export type OperacionInventario = {
  // La misma clave nunca se aplica dos veces: un aviso repetido de ML o
  // un doble clic en "Guardar" devuelven "ya aplicado", sin mover nada.
  claveIdempotencia: string;
  origen: OrigenMovimiento;
  referenciaId?: string | null;
  actor: ActorMovimiento;
  nota?: string | null;
  lineas: LineaMovimiento[];
};

export type ResultadoMovimiento = { aplicado: true; grupoId: string } | { aplicado: false; motivo: "ya_aplicado" };

export class SkuNoValidoParaStockError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SkuNoValidoParaStockError";
  }
}

export class BodegaNoValidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "BodegaNoValidaError";
  }
}

export async function operacionYaAplicada(tx: Tx, empresaId: string, claveIdempotencia: string): Promise<boolean> {
  const filas = await tx
    .select({ id: kardexMovimientos.id })
    .from(kardexMovimientos)
    .where(and(eq(kardexMovimientos.empresaId, empresaId), eq(kardexMovimientos.claveIdempotencia, claveIdempotencia)))
    .limit(1);
  return filas.length > 0;
}

type FilaKardex = { bodegaId: string; skuId: string; tipo: TipoMovimiento; delta: Delta };

function filasDeLineas(lineas: LineaMovimiento[]): FilaKardex[] {
  const filas: FilaKardex[] = [];
  for (const l of lineas) {
    if (l.tipo === "traslado") {
      if (l.bodegaId === l.bodegaDestinoId) throw new BodegaNoValidaError("Un traslado necesita dos bodegas distintas.");
      filas.push({ bodegaId: l.bodegaId, skuId: l.skuId, tipo: "traslado", delta: deltaDeMovimiento("traslado", l.cantidad, "origen") });
      filas.push({ bodegaId: l.bodegaDestinoId, skuId: l.skuId, tipo: "traslado", delta: deltaDeMovimiento("traslado", l.cantidad, "destino") });
    } else {
      filas.push({ bodegaId: l.bodegaId, skuId: l.skuId, tipo: l.tipo, delta: deltaDeMovimiento(l.tipo, l.cantidad) });
    }
  }
  return filas;
}

// Versión para usar dentro de una transacción que ya abrió el llamador
// (ej. una recepción, que crea su fila y sus movimientos juntos). tx
// tiene que venir de dbComoEmpresa(empresaId, ...).
export async function aplicarMovimientosTx(tx: Tx, empresaId: string, op: OperacionInventario): Promise<ResultadoMovimiento> {
  if (op.lineas.length === 0) throw new Error("Una operación de inventario necesita al menos una línea.");
  if (await operacionYaAplicada(tx, empresaId, op.claveIdempotencia)) return { aplicado: false, motivo: "ya_aplicado" };

  const filas = filasDeLineas(op.lineas);
  const skuIds = [...new Set(filas.map((f) => f.skuId))];
  const bodegaIds = [...new Set(filas.map((f) => f.bodegaId))];
  if (!skuIds.every(esUuid)) throw new SkuNoValidoParaStockError("Elige un SKU de la lista.");
  if (!bodegaIds.every(esUuid)) throw new BodegaNoValidaError("Elige una bodega de la lista.");

  // Los kits no tienen stock propio: el que llama tiene que haberlos
  // expandido a sus componentes (expandirKitsTx). La RLS ya esconde los
  // SKU y bodegas de otra empresa, así que "no existe" cubre ese caso.
  const filasSku = await tx.select({ id: skus.id, esKit: skus.esKit }).from(skus).where(inArray(skus.id, skuIds));
  if (filasSku.length !== skuIds.length) throw new SkuNoValidoParaStockError("Uno de los SKU no existe en esta empresa.");
  if (filasSku.some((s) => s.esKit)) throw new SkuNoValidoParaStockError("Un kit no tiene stock propio: se mueven sus componentes.");

  const filasBodega = await tx.select({ id: bodegas.id, activa: bodegas.activa }).from(bodegas).where(inArray(bodegas.id, bodegaIds));
  if (filasBodega.length !== bodegaIds.length) throw new BodegaNoValidaError("Una de las bodegas no existe en esta empresa.");
  // Una bodega desactivada todavía puede vaciarse (salida, traslado
  // hacia afuera, liberar o confirmar lo que tenía reservado), nunca
  // recibir: así se cierra una bodega sin dejar stock huérfano.
  const inactivas = new Set(filasBodega.filter((b) => !b.activa).map((b) => b.id));
  if (filas.some((f) => inactivas.has(f.bodegaId) && f.delta.disponible > 0 && f.tipo !== "liberacion")) {
    throw new BodegaNoValidaError("Esa bodega está desactivada: no puede recibir unidades.");
  }

  const publicadoAntes = await disponiblePublicadoTx(tx, empresaId, skuIds);

  // Crear las filas de saldo que falten y bloquearlas en un orden fijo:
  // dos operaciones sobre los mismos SKU nunca se bloquean en cruz.
  const pares = [...new Map(filas.map((f) => [`${f.bodegaId}|${f.skuId}`, f])).values()].sort((a, b) =>
    `${a.bodegaId}|${a.skuId}`.localeCompare(`${b.bodegaId}|${b.skuId}`)
  );
  await tx
    .insert(stockBodega)
    .values(pares.map((p) => ({ empresaId, bodegaId: p.bodegaId, skuId: p.skuId })))
    .onConflictDoNothing();
  const saldos = new Map<string, Saldo>();
  for (const p of pares) {
    const [fila] = await tx
      .select({ disponible: stockBodega.disponible, reservado: stockBodega.reservado, enTransito: stockBodega.enTransito })
      .from(stockBodega)
      .where(and(eq(stockBodega.empresaId, empresaId), eq(stockBodega.bodegaId, p.bodegaId), eq(stockBodega.skuId, p.skuId)))
      .for("update");
    saldos.set(`${p.bodegaId}|${p.skuId}`, fila);
  }

  const grupoId = randomUUID();
  const ahora = new Date();
  const movimientos: (typeof kardexMovimientos.$inferInsert)[] = [];
  filas.forEach((f, i) => {
    const clave = `${f.bodegaId}|${f.skuId}`;
    const antes = saldos.get(clave)!;
    const despues = aplicarDelta(antes, f.delta);
    if (!saldoValido(despues)) throw new StockInsuficienteError(f.skuId, f.bodegaId, antes, f.delta);
    saldos.set(clave, despues);
    movimientos.push({
      empresaId,
      ts: ahora,
      grupoId,
      linea: i + 1,
      claveIdempotencia: op.claveIdempotencia,
      tipo: f.tipo,
      origen: op.origen,
      bodegaId: f.bodegaId,
      skuId: f.skuId,
      deltaDisponible: f.delta.disponible,
      deltaReservado: f.delta.reservado,
      deltaEnTransito: f.delta.enTransito,
      saldoDisponible: despues.disponible,
      saldoReservado: despues.reservado,
      saldoEnTransito: despues.enTransito,
      referenciaId: op.referenciaId ?? null,
      actorTipo: op.actor.tipo,
      usuarioId: op.actor.tipo === "persona" ? op.actor.usuarioId : null,
      nota: op.nota ?? null,
    });
  });

  for (const p of pares) {
    const s = saldos.get(`${p.bodegaId}|${p.skuId}`)!;
    await tx
      .update(stockBodega)
      .set({ disponible: s.disponible, reservado: s.reservado, enTransito: s.enTransito, actualizadoTs: ahora })
      .where(and(eq(stockBodega.empresaId, empresaId), eq(stockBodega.bodegaId, p.bodegaId), eq(stockBodega.skuId, p.skuId)));
  }
  await tx.insert(kardexMovimientos).values(movimientos);

  await despuesDeMoverTx(tx, empresaId, skuIds, publicadoAntes);
  return { aplicado: true, grupoId };
}

// Dos procesos con la misma clave a la vez: el segundo choca con la
// restricción única del kardex y su transacción entera se deshace. Eso
// es justo "ya aplicado", no un error.
function esChoqueDeClave(error: unknown): boolean {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const codigo = e?.code ?? e?.cause?.code;
  const restriccion = e?.constraint_name ?? e?.cause?.constraint_name;
  return codigo === "23505" && restriccion === "kardex_movimientos_clave_linea_unica";
}

export async function aplicarMovimientos(empresaId: string, op: OperacionInventario): Promise<ResultadoMovimiento> {
  try {
    return await dbComoEmpresa(empresaId, (tx) => aplicarMovimientosTx(tx, empresaId, op));
  } catch (error) {
    if (esChoqueDeClave(error)) return { aplicado: false, motivo: "ya_aplicado" };
    throw error;
  }
}

// Kits que usan alguno de estos SKU como componente: su stock derivado
// también cambió, y son los que suelen estar enlazados a la publicación.
async function kitsQueUsanTx(tx: Tx, skuIds: string[]): Promise<string[]> {
  if (skuIds.length === 0) return [];
  const filas = await tx
    .selectDistinct({ id: kitComponentes.skuKitId })
    .from(kitComponentes)
    .where(inArray(kitComponentes.skuComponenteId, skuIds));
  return filas.map((f) => f.id);
}

// Marca para el envío a ML (con espera: si ya estaba pendiente, se deja
// la marca vieja para que un SKU que se mueve todo el tiempo igual
// salga) y revisa la regla de la última unidad.
async function despuesDeMoverTx(tx: Tx, empresaId: string, skuIds: string[], publicadoAntes: Map<string, number>): Promise<void> {
  const kits = await kitsQueUsanTx(tx, skuIds);
  const afectados = [...new Set([...skuIds, ...kits])];
  const antesConKits = new Map(publicadoAntes);
  if (kits.length) for (const [id, n] of await disponiblePublicadoTx(tx, empresaId, kits)) antesConKits.set(id, n);

  await tx
    .insert(syncStockMl)
    .values(afectados.map((skuId) => ({ empresaId, skuId, pendienteDesdeTs: new Date() })))
    .onConflictDoUpdate({
      target: [syncStockMl.empresaId, syncStockMl.skuId],
      set: { pendienteDesdeTs: sql`coalesce(${syncStockMl.pendienteDesdeTs}, now())` },
    });

  const config = await leerConfiguracionInventarioTx(tx, empresaId);
  if (config.umbralUltimaUnidad <= 0) return;
  const despues = await disponiblePublicadoTx(tx, empresaId, afectados);
  const nuevas = afectados.filter((id) =>
    cruzaUmbralUltimaUnidad(antesConKits.get(id) ?? 0, despues.get(id) ?? 0, config.umbralUltimaUnidad)
  );
  if (nuevas.length === 0) return;
  // A lo sumo una pendiente por SKU (índice único parcial): si ya había
  // una, no se apila otra.
  await tx
    .insert(alertasUltimaUnidad)
    .values(nuevas.map((skuId) => ({ empresaId, skuId, disponibleAlCrear: despues.get(skuId) ?? 0, regla: config.reglaUltimaUnidad })))
    .onConflictDoNothing();
}

// Un pedido trae SKU de venta; si alguno es kit, se reemplaza por sus
// componentes multiplicados (kit x2 de 3 unidades = 6 del componente).
export async function expandirKitsTx(
  tx: Tx,
  lineas: { skuId: string; cantidad: number }[]
): Promise<{ skuId: string; cantidad: number }[]> {
  const ids = [...new Set(lineas.map((l) => l.skuId))];
  if (ids.length === 0) return [];
  if (!ids.every(esUuid)) throw new SkuNoValidoParaStockError("Elige un SKU de la lista.");
  const info = await tx.select({ id: skus.id, esKit: skus.esKit }).from(skus).where(inArray(skus.id, ids));
  const esKit = new Map(info.map((s) => [s.id, s.esKit]));
  const kitIds = info.filter((s) => s.esKit).map((s) => s.id);
  const componentes = kitIds.length
    ? await tx
        .select({ kitId: kitComponentes.skuKitId, skuId: kitComponentes.skuComponenteId, cantidad: kitComponentes.cantidad })
        .from(kitComponentes)
        .where(inArray(kitComponentes.skuKitId, kitIds))
    : [];
  const resultado: { skuId: string; cantidad: number }[] = [];
  for (const l of lineas) {
    if (!esKit.has(l.skuId)) throw new SkuNoValidoParaStockError("Uno de los SKU no existe en esta empresa.");
    if (!esKit.get(l.skuId)) {
      resultado.push(l);
      continue;
    }
    const delKit = componentes.filter((c) => c.kitId === l.skuId);
    if (delKit.length === 0) throw new SkuNoValidoParaStockError("Ese kit no tiene componentes cargados.");
    for (const c of delKit) resultado.push({ skuId: c.skuId, cantidad: c.cantidad * l.cantidad });
  }
  return resultado;
}
