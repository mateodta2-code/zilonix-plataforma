import { randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { dbComoBodega } from "@/db/bodega-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas3plEmpresas, empresas, recepcionesBodega3pl, recepcionItemsBodega3pl, stockBodega3pl } from "@/db/schema";
import { registrarAuditoriaBodega } from "./auditoria";

export class RecepcionInvalidaError extends Error {}

export type LineaRecepcion = { sku: string; cantidad: number };

const MAX_LINEAS = 200;
const MAX_SKU = 80;
const MAX_NOTA = 500;

// Una línea por renglón: "SKU cantidad" separado por espacio, coma, punto y
// coma o tabulador (así se pega desde una hoja de cálculo). Las cantidades
// 0, negativas o con decimales no se guardan: se rechaza toda la recepción
// con el número de renglón, nunca se ignoran en silencio. Un SKU repetido
// se suma en una sola línea.
export function interpretarLineas(texto: string): LineaRecepcion[] {
  const acumulado = new Map<string, number>();
  const renglones = texto.split(/\r?\n/).map((r) => r.trim());
  renglones.forEach((renglon, i) => {
    if (!renglon) return;
    const partes = renglon.split(/[\t;,\s]+/).filter(Boolean);
    if (partes.length !== 2) throw new RecepcionInvalidaError(`Renglón ${i + 1}: escribe el SKU y la cantidad (ejemplo: SKU-123 10).`);
    const [sku, crudo] = partes;
    if (sku.length > MAX_SKU) throw new RecepcionInvalidaError(`Renglón ${i + 1}: el SKU es demasiado largo.`);
    if (!/^\d+$/.test(crudo)) throw new RecepcionInvalidaError(`Renglón ${i + 1}: la cantidad debe ser un número entero mayor que 0.`);
    const cantidad = Number(crudo);
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0 || cantidad > 1_000_000) throw new RecepcionInvalidaError(`Renglón ${i + 1}: la cantidad debe ser mayor que 0 y razonable.`);
    acumulado.set(sku, (acumulado.get(sku) ?? 0) + cantidad);
  });
  if (acumulado.size === 0) throw new RecepcionInvalidaError("Agrega al menos una línea con SKU y cantidad.");
  if (acumulado.size > MAX_LINEAS) throw new RecepcionInvalidaError(`Máximo ${MAX_LINEAS} SKU por recepción.`);
  return [...acumulado].map(([sku, cantidad]) => ({ sku, cantidad }));
}

// Registra la recepción, sus ítems, la suma al stock y la auditoría en UNA
// transacción: si falla una parte no queda ninguna. La empresa debe estar
// ligada y activa (lo comprueba aquí para dar un mensaje claro y, de
// todos modos, lo fuerza RLS).
export async function registrarRecepcion(
  bodegaId: string,
  usuarioId: string,
  entrada: { empresaId: string; fecha?: Date; nota?: string; lineas: LineaRecepcion[] },
  rol: string
): Promise<{ recepcionId: string }> {
  if (entrada.lineas.length === 0) throw new RecepcionInvalidaError("Agrega al menos una línea con SKU y cantidad.");
  for (const l of entrada.lineas) {
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) throw new RecepcionInvalidaError("Las cantidades deben ser enteros mayores que 0.");
  }
  const nota = entrada.nota?.trim().slice(0, MAX_NOTA) || null;
  return dbComoBodega(
    bodegaId,
    async (tx) => {
      const [vinculo] = await tx
        .select({ estado: bodegas3plEmpresas.estado })
        .from(bodegas3plEmpresas)
        .where(and(eq(bodegas3plEmpresas.bodegaId, bodegaId), eq(bodegas3plEmpresas.empresaId, entrada.empresaId)));
      if (!vinculo || vinculo.estado !== "activa") throw new RecepcionInvalidaError("Esa empresa no está ligada y activa en esta bodega.");

      const recepcionId = randomUUID();
      await tx.insert(recepcionesBodega3pl).values({ id: recepcionId, bodegaId, empresaId: entrada.empresaId, fecha: entrada.fecha ?? new Date(), nota, creadoPor: usuarioId });
      await tx.insert(recepcionItemsBodega3pl).values(entrada.lineas.map((l) => ({ recepcionId, sku: l.sku, cantidad: l.cantidad })));
      for (const l of entrada.lineas) {
        await tx
          .insert(stockBodega3pl)
          .values({ bodegaId, empresaId: entrada.empresaId, sku: l.sku, cantidad: l.cantidad })
          .onConflictDoUpdate({
            target: [stockBodega3pl.bodegaId, stockBodega3pl.empresaId, stockBodega3pl.sku],
            set: { cantidad: sql`${stockBodega3pl.cantidad} + ${l.cantidad}` },
          });
      }
      const unidades = entrada.lineas.reduce((s, l) => s + l.cantidad, 0);
      await registrarAuditoriaBodega(tx, {
        bodegaId,
        usuarioId,
        accion: "bodega.recepcion.registrar",
        entidad: "recepcion_bodega_3pl",
        entidadId: recepcionId,
        detalle: `Recepción de ${entrada.lineas.length} SKU (${unidades} unidades).`,
      });
      return { recepcionId };
    },
    rol
  );
}

export type RecepcionListada = { id: string; empresaId: string; empresaNombre: string; fecha: Date; nota: string | null; lineas: number; unidades: number };

// Solo lectura, de la bodega activa; filtro opcional por empresa.
export async function listarRecepciones(bodegaId: string, filtro: { empresaId?: string } = {}, limite = 100): Promise<RecepcionListada[]> {
  return dbComoBodega(bodegaId, async (tx) => {
    const condiciones = [eq(recepcionesBodega3pl.bodegaId, bodegaId)];
    if (filtro.empresaId) condiciones.push(eq(recepcionesBodega3pl.empresaId, filtro.empresaId));
    const filas = await tx
      .select({
        id: recepcionesBodega3pl.id,
        empresaId: recepcionesBodega3pl.empresaId,
        empresaNombre: empresas.nombre,
        fecha: recepcionesBodega3pl.fecha,
        nota: recepcionesBodega3pl.nota,
        lineas: sql<number>`count(${recepcionItemsBodega3pl.id})::int`,
        unidades: sql<number>`coalesce(sum(${recepcionItemsBodega3pl.cantidad}), 0)::int`,
      })
      .from(recepcionesBodega3pl)
      .innerJoin(empresas, eq(empresas.id, recepcionesBodega3pl.empresaId))
      .leftJoin(recepcionItemsBodega3pl, eq(recepcionItemsBodega3pl.recepcionId, recepcionesBodega3pl.id))
      .where(and(...condiciones))
      .groupBy(recepcionesBodega3pl.id, empresas.nombre)
      .orderBy(desc(recepcionesBodega3pl.fecha))
      .limit(limite);
    return filas;
  });
}

// Lo que ve el vendedor: sus propias recepciones (RLS por empresa).
export async function listarRecepcionesDeEmpresa(empresaId: string, limite = 50) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx.select().from(recepcionesBodega3pl).where(eq(recepcionesBodega3pl.empresaId, empresaId)).orderBy(desc(recepcionesBodega3pl.fecha)).limit(limite)
  );
}
