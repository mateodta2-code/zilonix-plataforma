import { and, asc, eq, ne } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { esUuid } from "@/lib/inventario/calculos";

// Issue #280 — bodegas de una empresa. Se crean y se desactivan, nunca
// se borran (su kardex es historia real). La primera bodega de la
// empresa nace principal; después se puede cambiar cuál es.

export type TipoBodega = (typeof bodegas.$inferSelect)["tipo"];
export const TIPOS_BODEGA: { valor: TipoBodega; etiqueta: string }[] = [
  { valor: "propia", etiqueta: "Propia" },
  { valor: "fulfillment_ml", etiqueta: "Full de Mercado Libre" },
  { valor: "tercero", etiqueta: "De un tercero" },
];

export type Bodega = typeof bodegas.$inferSelect;

export class BodegaDuplicadaError extends Error {
  constructor(nombre: string) {
    super(`Ya hay una bodega llamada "${nombre}" en esta empresa.`);
    this.name = "BodegaDuplicadaError";
  }
}

export class DatosBodegaInvalidosError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DatosBodegaInvalidosError";
  }
}

function esNombreDuplicado(error: unknown): boolean {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  return (e?.code ?? e?.cause?.code) === "23505" && (e?.constraint_name ?? e?.cause?.constraint_name) === "bodegas_empresa_nombre_unico";
}

export async function listarBodegas(empresaId: string, opciones: { soloActivas?: boolean } = {}): Promise<Bodega[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select()
      .from(bodegas)
      .where(opciones.soloActivas ? and(eq(bodegas.empresaId, empresaId), eq(bodegas.activa, true)) : eq(bodegas.empresaId, empresaId))
      .orderBy(asc(bodegas.nombre))
  );
}

export async function crearBodega(
  empresaId: string,
  usuarioId: string,
  datos: { nombre: string; tipo: TipoBodega }
): Promise<{ id: string }> {
  const nombre = datos.nombre.trim();
  if (!nombre) throw new DatosBodegaInvalidosError("El nombre es obligatorio.");
  if (!TIPOS_BODEGA.some((t) => t.valor === datos.tipo)) throw new DatosBodegaInvalidosError("Ese tipo de bodega no existe.");
  try {
    return await dbComoEmpresa(empresaId, async (tx) => {
      const existentes = await tx.select({ id: bodegas.id }).from(bodegas).where(eq(bodegas.empresaId, empresaId)).limit(1);
      // Full nunca es la principal: no se reservan pedidos ahí.
      const esPrincipal = existentes.length === 0 && datos.tipo !== "fulfillment_ml";
      const [fila] = await tx
        .insert(bodegas)
        .values({ empresaId, nombre, tipo: datos.tipo, esPrincipal, sumaAlPublicado: datos.tipo !== "fulfillment_ml" })
        .returning({ id: bodegas.id });
      await registrarAuditoria(tx, {
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "inventario.bodega_creada",
        entidad: "bodegas",
        entidadId: fila.id,
        valorNuevo: JSON.stringify({ nombre, tipo: datos.tipo, esPrincipal }),
      });
      return fila;
    });
  } catch (error) {
    if (esNombreDuplicado(error)) throw new BodegaDuplicadaError(nombre);
    throw error;
  }
}

export async function actualizarBodega(
  empresaId: string,
  usuarioId: string,
  bodegaId: string,
  cambios: { nombre: string; activa: boolean; esPrincipal: boolean; sumaAlPublicado: boolean }
): Promise<void> {
  const nombre = cambios.nombre.trim();
  if (!nombre) throw new DatosBodegaInvalidosError("El nombre es obligatorio.");
  if (!esUuid(bodegaId)) throw new DatosBodegaInvalidosError("Esa bodega no existe en esta empresa.");
  try {
    await dbComoEmpresa(empresaId, async (tx) => {
      const [anterior] = await tx.select().from(bodegas).where(and(eq(bodegas.empresaId, empresaId), eq(bodegas.id, bodegaId)));
      if (!anterior) throw new DatosBodegaInvalidosError("Esa bodega no existe en esta empresa.");
      if (cambios.esPrincipal && (!cambios.activa || anterior.tipo === "fulfillment_ml")) {
        throw new DatosBodegaInvalidosError("La bodega principal tiene que estar activa y no puede ser Full.");
      }
      // Pasar la marca de principal: primero se le quita a la anterior
      // (el índice único parcial no deja dos a la vez).
      if (cambios.esPrincipal && !anterior.esPrincipal) {
        await tx
          .update(bodegas)
          .set({ esPrincipal: false, actualizadoTs: new Date() })
          .where(and(eq(bodegas.empresaId, empresaId), eq(bodegas.esPrincipal, true), ne(bodegas.id, bodegaId)));
      }
      await tx
        .update(bodegas)
        .set({ nombre, activa: cambios.activa, esPrincipal: cambios.esPrincipal, sumaAlPublicado: cambios.sumaAlPublicado, actualizadoTs: new Date() })
        .where(and(eq(bodegas.empresaId, empresaId), eq(bodegas.id, bodegaId)));
      await registrarAuditoria(tx, {
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "inventario.bodega_actualizada",
        entidad: "bodegas",
        entidadId: bodegaId,
        valorAnterior: JSON.stringify({
          nombre: anterior.nombre,
          activa: anterior.activa,
          esPrincipal: anterior.esPrincipal,
          sumaAlPublicado: anterior.sumaAlPublicado,
        }),
        valorNuevo: JSON.stringify({ ...cambios, nombre }),
      });
    });
  } catch (error) {
    if (esNombreDuplicado(error)) throw new BodegaDuplicadaError(nombre);
    throw error;
  }
}
