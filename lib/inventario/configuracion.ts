import { eq } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { configuracionInventario } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";

// Issue #280 — configuración de inventario por empresa. Una empresa sin
// fila usa los valores por defecto (preguntar, umbral 1, sin colchón,
// sin enviar a ML y sin reservar pedidos): nada automático se prende
// solo.

type Tx = typeof db;
export type ReglaUltimaUnidad = (typeof configuracionInventario.$inferSelect)["reglaUltimaUnidad"];
export const REGLAS_ULTIMA_UNIDAD: { valor: ReglaUltimaUnidad; etiqueta: string }[] = [
  { valor: "preguntar", etiqueta: "Preguntarme cada vez" },
  { valor: "quitar_promos", etiqueta: "Quitar las promociones" },
  { valor: "vender_sin_promo", etiqueta: "Vender la última unidad sin promoción" },
];

export type ConfiguracionInventario = {
  reglaUltimaUnidad: ReglaUltimaUnidad;
  umbralUltimaUnidad: number;
  bufferMl: number;
  syncMlActivo: boolean;
  reservaPedidosDesdeTs: Date | null;
};

export const CONFIGURACION_INVENTARIO_POR_DEFECTO: ConfiguracionInventario = {
  reglaUltimaUnidad: "preguntar",
  umbralUltimaUnidad: 1,
  bufferMl: 0,
  syncMlActivo: false,
  reservaPedidosDesdeTs: null,
};

export async function leerConfiguracionInventarioTx(tx: Tx, empresaId: string): Promise<ConfiguracionInventario> {
  const [fila] = await tx.select().from(configuracionInventario).where(eq(configuracionInventario.empresaId, empresaId));
  if (!fila) return { ...CONFIGURACION_INVENTARIO_POR_DEFECTO };
  return {
    reglaUltimaUnidad: fila.reglaUltimaUnidad,
    umbralUltimaUnidad: fila.umbralUltimaUnidad,
    bufferMl: fila.bufferMl,
    syncMlActivo: fila.syncMlActivo,
    reservaPedidosDesdeTs: fila.reservaPedidosDesdeTs,
  };
}

export async function leerConfiguracionInventario(empresaId: string): Promise<ConfiguracionInventario> {
  return dbComoEmpresa(empresaId, (tx) => leerConfiguracionInventarioTx(tx, empresaId));
}

export class ConfiguracionInventarioInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ConfiguracionInventarioInvalidaError";
  }
}

export type CambiosConfiguracionInventario = {
  reglaUltimaUnidad: ReglaUltimaUnidad;
  umbralUltimaUnidad: number;
  bufferMl: number;
  syncMlActivo: boolean;
  // true = empezar a reservar los pedidos que entren desde ahora; false
  // = dejar de reservar. Prenderlo de nuevo NO reprocesa los pedidos de
  // la pausa: la fecha se mueve a "ahora".
  reservarPedidos: boolean;
};

export async function guardarConfiguracionInventario(
  empresaId: string,
  usuarioId: string,
  cambios: CambiosConfiguracionInventario
): Promise<void> {
  if (!REGLAS_ULTIMA_UNIDAD.some((r) => r.valor === cambios.reglaUltimaUnidad)) {
    throw new ConfiguracionInventarioInvalidaError("Esa regla de última unidad no existe.");
  }
  for (const [nombre, valor] of [
    ["El umbral", cambios.umbralUltimaUnidad],
    ["El colchón", cambios.bufferMl],
  ] as const) {
    if (!Number.isSafeInteger(valor) || valor < 0) throw new ConfiguracionInventarioInvalidaError(`${nombre} tiene que ser un entero desde 0.`);
  }

  await dbComoEmpresa(empresaId, async (tx) => {
    const anterior = await leerConfiguracionInventarioTx(tx, empresaId);
    const reservaPedidosDesdeTs = cambios.reservarPedidos ? (anterior.reservaPedidosDesdeTs ?? new Date()) : null;
    const valores = {
      reglaUltimaUnidad: cambios.reglaUltimaUnidad,
      umbralUltimaUnidad: cambios.umbralUltimaUnidad,
      bufferMl: cambios.bufferMl,
      syncMlActivo: cambios.syncMlActivo,
      reservaPedidosDesdeTs,
      actualizadaTs: new Date(),
      actualizadaPor: usuarioId,
    };
    await tx
      .insert(configuracionInventario)
      .values({ empresaId, ...valores })
      .onConflictDoUpdate({ target: configuracionInventario.empresaId, set: valores });
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "inventario.configuracion_actualizada",
      entidad: "configuracion_inventario",
      entidadId: empresaId,
      valorAnterior: JSON.stringify({ ...anterior, reservaPedidosDesdeTs: anterior.reservaPedidosDesdeTs?.toISOString() ?? null }),
      valorNuevo: JSON.stringify({ ...cambios, reservaPedidosDesdeTs: reservaPedidosDesdeTs?.toISOString() ?? null }),
    });
  });
}
