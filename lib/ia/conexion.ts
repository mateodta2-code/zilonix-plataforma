import { and, asc, count, eq, notInArray } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { iaConexionModulos, iaConexiones } from "@/db/schema";
import { cifrarToken, descifrarToken } from "@/lib/cifrado";
import { MAX_CONEXIONES_IA, type ModuloIA } from "./modulos";
import type { ConexionIA, ConexionIAConClave, ConexionIAConModulos, ProveedorIA } from "./tipos";

// Pieza COMÚN de IA por empresa (lib/ia/). La API key se cifra con el
// MISMO mecanismo que los tokens de Mercado Libre (lib/cifrado.ts).
//
// Desde feat/conectar-ia-administracion una empresa puede tener hasta 5
// conexiones, una principal, y asignar cada módulo a una conexión
// (tabla ia_conexion_modulos). TODO módulo que necesite IA debe pedirla
// con obtenerConexionIAParaModulo(empresaId, "<módulo>") — las ramas de
// «Reglas adicionales» (promociones) y «Buscar por foto»
// (investigacion) también. obtenerConexionIAConClave NO se exporta a
// propósito: la key descifrada solo sale por obtenerConexionIAParaModulo
// (hay una prueba que falla si otro archivo la importa). NUNCA se cae a
// la llave de plataforma (ANTHROPIC_API_KEY): sin IA, el módulo sigue
// solo con los números.

export const MENSAJE_LIMITE_IA = `Puedes conectar hasta ${MAX_CONEXIONES_IA} IA`;
export const MENSAJE_PRINCIPAL_NO_ELIMINABLE = "Elige otra IA como principal antes de eliminar esta";

export class LimiteConexionesIAError extends Error {
  constructor() {
    super(MENSAJE_LIMITE_IA);
    this.name = "LimiteConexionesIAError";
  }
}
export class PrincipalNoEliminableError extends Error {
  constructor() {
    super(MENSAJE_PRINCIPAL_NO_ELIMINABLE);
    this.name = "PrincipalNoEliminableError";
  }
}
export class ConexionIANoEncontradaError extends Error {
  constructor() {
    super("No se encontró esa conexión de IA.");
    this.name = "ConexionIANoEncontradaError";
  }
}

type Fila = typeof iaConexiones.$inferSelect;

function filaAConexion(fila: Fila): ConexionIA {
  return {
    id: fila.id,
    nombre: fila.nombre,
    proveedor: fila.proveedor,
    baseUrl: fila.baseUrl,
    modelo: fila.modelo,
    esPrincipal: fila.esPrincipal,
    actualizadoTs: fila.actualizadoTs,
  };
}

// Error del trigger de la base (5.ª inserción, incluso simultánea).
function esErrorLimiteTrigger(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = (e as { cause?: unknown }).cause) {
    if (e.message.includes(MENSAJE_LIMITE_IA)) return true;
  }
  return false;
}

async function resolverFila(empresaId: string, modulo: ModuloIA | undefined): Promise<Fila | null> {
  return dbComoEmpresa(empresaId, async (tx) => {
    if (modulo) {
      const asignadas = await tx
        .select({ conexionId: iaConexionModulos.conexionId })
        .from(iaConexionModulos)
        .where(and(eq(iaConexionModulos.empresaId, empresaId), eq(iaConexionModulos.modulo, modulo)));
      if (asignadas[0]) {
        const filas = await tx
          .select()
          .from(iaConexiones)
          .where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.id, asignadas[0].conexionId)));
        if (filas[0]) return filas[0];
      }
    }
    const principales = await tx
      .select()
      .from(iaConexiones)
      .where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.esPrincipal, true)));
    if (principales[0]) return principales[0];
    // Defensa: sin principal marcada (no debería pasar) se usa la más antigua.
    const todas = await tx.select().from(iaConexiones).where(eq(iaConexiones.empresaId, empresaId)).orderBy(asc(iaConexiones.creadoTs));
    return todas[0] ?? null;
  });
}

// SOLO servidor. La IA que debe usar `modulo`: la asignada, o la
// principal, o null si la empresa no conectó ninguna.
export async function obtenerConexionIAParaModulo(empresaId: string, modulo: ModuloIA): Promise<ConexionIAConClave | null> {
  const fila = await resolverFila(empresaId, modulo);
  if (!fila) return null;
  return { ...filaAConexion(fila), apiKey: descifrarToken(fila.apiKeyCifrada) };
}

// Posventa-Mensajes (Refs #645): la IA PRINCIPAL de la empresa, sin módulo
// propio (no hace falta migrar el CHECK de módulos). null = sin IA conectada.
export async function obtenerConexionIAPrincipal(empresaId: string): Promise<ConexionIAConClave | null> {
  const fila = await resolverFila(empresaId, undefined);
  if (!fila) return null;
  return { ...filaAConexion(fila), apiKey: descifrarToken(fila.apiKeyCifrada) };
}

// Igual pero SIN key (para saber qué IA usaría un módulo y avisar en pantalla).
export async function obtenerConexionIA(empresaId: string, modulo?: ModuloIA): Promise<ConexionIA | null> {
  const fila = await resolverFila(empresaId, modulo);
  return fila ? filaAConexion(fila) : null;
}

// SOLO servidor, para «Probar conexión»: una conexión concreta por id,
// de ESA empresa (id ajena → null).
export async function obtenerConexionIAConClavePorId(empresaId: string, id: string): Promise<ConexionIAConClave | null> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx.select().from(iaConexiones).where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.id, id)))
  );
  const fila = filas[0];
  return fila ? { ...filaAConexion(fila), apiKey: descifrarToken(fila.apiKeyCifrada) } : null;
}

export async function listarConexionesIA(empresaId: string): Promise<ConexionIAConModulos[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx.select().from(iaConexiones).where(eq(iaConexiones.empresaId, empresaId)).orderBy(asc(iaConexiones.creadoTs), asc(iaConexiones.id));
    const asignaciones = await tx.select().from(iaConexionModulos).where(eq(iaConexionModulos.empresaId, empresaId));
    return filas.map((f) => ({
      ...filaAConexion(f),
      modulos: asignaciones.filter((a) => a.conexionId === f.id).map((a) => a.modulo as ModuloIA),
    }));
  });
}

export type DatosConexionIA = { nombre: string; proveedor: ProveedorIA; baseUrl: string | null; modelo: string; apiKey: string };

// La primera conexión de la empresa queda principal. Máximo 5 (revisado
// acá ANTES de insertar y, por si dos altas coinciden, por el trigger).
export async function crearConexionIA(empresaId: string, usuarioId: string, datos: DatosConexionIA): Promise<ConexionIA> {
  try {
    return await dbComoEmpresa(empresaId, async (tx) => {
      const [{ total }] = await tx.select({ total: count() }).from(iaConexiones).where(eq(iaConexiones.empresaId, empresaId));
      if (total >= MAX_CONEXIONES_IA) throw new LimiteConexionesIAError();
      const [fila] = await tx
        .insert(iaConexiones)
        .values({
          empresaId,
          nombre: datos.nombre,
          proveedor: datos.proveedor,
          baseUrl: datos.baseUrl,
          modelo: datos.modelo,
          apiKeyCifrada: cifrarToken(datos.apiKey),
          esPrincipal: total === 0,
          actualizadoPor: usuarioId,
        })
        .returning();
      return filaAConexion(fila);
    });
  } catch (error) {
    if (error instanceof LimiteConexionesIAError) throw error;
    if (esErrorLimiteTrigger(error)) throw new LimiteConexionesIAError();
    throw error;
  }
}

export type CambiosConexionIA = Omit<DatosConexionIA, "apiKey"> & { apiKey?: string };

// apiKey vacía/ausente = no cambiar la key guardada.
export async function actualizarConexionIA(empresaId: string, usuarioId: string, id: string, cambios: CambiosConexionIA): Promise<ConexionIA> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const nuevaKey = cambios.apiKey?.trim();
    const filas = await tx
      .update(iaConexiones)
      .set({
        nombre: cambios.nombre,
        proveedor: cambios.proveedor,
        baseUrl: cambios.baseUrl,
        modelo: cambios.modelo,
        ...(nuevaKey ? { apiKeyCifrada: cifrarToken(nuevaKey) } : {}),
        actualizadoTs: new Date(),
        actualizadoPor: usuarioId,
      })
      .where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.id, id)))
      .returning();
    if (!filas[0]) throw new ConexionIANoEncontradaError();
    return filaAConexion(filas[0]);
  });
}

// Solo borra una conexión de ESTA empresa. Eliminar la principal con
// otras conectadas se bloquea; eliminar la única sí se permite. Sus
// asignaciones de módulo se borran en cascada (el módulo vuelve a usar
// la principal).
export async function eliminarConexionIA(empresaId: string, id: string): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx.select().from(iaConexiones).where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.id, id)));
    const fila = filas[0];
    if (!fila) throw new ConexionIANoEncontradaError();
    if (fila.esPrincipal) {
      const [{ total }] = await tx.select({ total: count() }).from(iaConexiones).where(eq(iaConexiones.empresaId, empresaId));
      if (total > 1) throw new PrincipalNoEliminableError();
    }
    await tx.delete(iaConexiones).where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.id, id)));
  });
}

// En una transacción: primero se quita la marca a la actual (el índice
// único parcial solo permite una) y luego se pone a la elegida.
export async function marcarPrincipal(empresaId: string, id: string): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx.select({ id: iaConexiones.id }).from(iaConexiones).where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.id, id)));
    if (!filas[0]) throw new ConexionIANoEncontradaError();
    await tx.update(iaConexiones).set({ esPrincipal: false }).where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.esPrincipal, true)));
    await tx.update(iaConexiones).set({ esPrincipal: true }).where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.id, id)));
  });
}

// Deja a esta conexión con EXACTAMENTE esos módulos: asignar uno que
// estaba en otra conexión lo mueve (un módulo = una sola IA).
export async function asignarModulos(empresaId: string, conexionId: string, modulos: ModuloIA[]): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx.select({ id: iaConexiones.id }).from(iaConexiones).where(and(eq(iaConexiones.empresaId, empresaId), eq(iaConexiones.id, conexionId)));
    if (!filas[0]) throw new ConexionIANoEncontradaError();
    const quitar = and(eq(iaConexionModulos.empresaId, empresaId), eq(iaConexionModulos.conexionId, conexionId));
    if (modulos.length === 0) await tx.delete(iaConexionModulos).where(quitar);
    else await tx.delete(iaConexionModulos).where(and(quitar, notInArray(iaConexionModulos.modulo, modulos)));
    for (const modulo of modulos) {
      await tx
        .insert(iaConexionModulos)
        .values({ empresaId, conexionId, modulo })
        .onConflictDoUpdate({ target: [iaConexionModulos.empresaId, iaConexionModulos.modulo], set: { conexionId } });
    }
  });
}
