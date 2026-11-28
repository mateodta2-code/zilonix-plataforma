import { and, desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { publicacionesFalabella } from "@/db/schema";
import { obtenerCredenciales } from "@/lib/falabella/cuentas";
import { consultarFeed, enviarImagenes, enviarProductCreate } from "@/lib/falabella/publicar";
import type { BorradorFalabella } from "@/lib/falabella/publicar-reglas";

// Historial de publicaciones de Falabella (igual idea que productos_ml).
// Cada transición de estado es un UPDATE condicionado al estado anterior
// (`WHERE estado = ...`), para que dos pantallas abiertas o dos sondeos a
// la vez nunca manden dos veces el mismo ProductCreate o las mismas imágenes.

export type FilaPublicacionFalabella = typeof publicacionesFalabella.$inferSelect;

export async function guardarBorrador(
  empresaId: string,
  datos: { cuentaFalabellaId: string; borrador: BorradorFalabella; usuarioId: string }
): Promise<{ id: string }> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(publicacionesFalabella)
      .values({
        empresaId,
        cuentaFalabellaId: datos.cuentaFalabellaId,
        sku: datos.borrador.sku,
        titulo: datos.borrador.titulo,
        borrador: datos.borrador,
        creadoPorUsuarioId: datos.usuarioId,
      })
      .returning({ id: publicacionesFalabella.id })
  );
  return fila;
}

export async function listarPublicaciones(empresaId: string, limite = 50): Promise<FilaPublicacionFalabella[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx.select().from(publicacionesFalabella).where(eq(publicacionesFalabella.empresaId, empresaId)).orderBy(desc(publicacionesFalabella.creadoTs)).limit(limite)
  );
}

async function obtener(empresaId: string, id: string): Promise<FilaPublicacionFalabella | null> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx.select().from(publicacionesFalabella).where(and(eq(publicacionesFalabella.id, id), eq(publicacionesFalabella.empresaId, empresaId)))
  );
  return fila ?? null;
}

async function transicion(
  empresaId: string,
  id: string,
  desde: FilaPublicacionFalabella["estado"],
  cambios: Partial<Pick<FilaPublicacionFalabella, "estado" | "feedProductoId" | "feedImagenesId" | "errores" | "borrador">>
): Promise<boolean> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(publicacionesFalabella)
      .set({ ...cambios, actualizadoTs: new Date() })
      .where(and(eq(publicacionesFalabella.id, id), eq(publicacionesFalabella.empresaId, empresaId), eq(publicacionesFalabella.estado, desde)))
      .returning({ id: publicacionesFalabella.id })
  );
  return filas.length > 0;
}

// Aprobar el borrador = crear de verdad en Falabella. Solo desde "borrador".
export async function aprobarYCrear(empresaId: string, id: string): Promise<void> {
  const fila = await obtener(empresaId, id);
  if (!fila) throw new Error("No se encontró esa publicación.");
  if (fila.borrador.problemas.length) throw new Error(`El borrador tiene problemas: ${fila.borrador.problemas.join(" ")}`);
  // Se reserva primero (borrador → creando): si otra pestaña ya lo hizo, no se envía de nuevo.
  if (!(await transicion(empresaId, id, "borrador", { estado: "creando" }))) throw new Error("Esta publicación ya se envió.");
  try {
    const cred = await obtenerCredenciales(empresaId, fila.cuentaFalabellaId);
    const feedId = await enviarProductCreate(cred, fila.borrador);
    await transicion(empresaId, id, "creando", { feedProductoId: feedId });
  } catch (error) {
    // Falabella no llegó a aceptarlo: vuelve a borrador, con el motivo, para reintentar.
    await transicion(empresaId, id, "creando", { estado: "borrador", errores: [error instanceof Error ? error.message : "No se pudo enviar a Falabella."] });
    throw error;
  }
}

// Un paso de seguimiento: se llama cada pocos segundos mientras la pantalla
// tiene publicaciones en "creando" o "imagenes". Idempotente.
export async function avanzar(empresaId: string, id: string): Promise<void> {
  const fila = await obtener(empresaId, id);
  if (!fila) return;
  const cred = await obtenerCredenciales(empresaId, fila.cuentaFalabellaId);

  if (fila.estado === "creando" && fila.feedProductoId) {
    const feed = await consultarFeed(cred, fila.feedProductoId);
    if (feed.estado === "con_errores" || feed.estado === "cancelado") {
      await transicion(empresaId, id, "creando", { estado: "rechazado", errores: feed.errores.length ? feed.errores : ["Falabella rechazó el producto sin dar detalle."] });
    } else if (feed.estado === "terminado") {
      // Las imágenes SOLO se mandan cuando el producto ya existe.
      if (!(await transicion(empresaId, id, "creando", { estado: "imagenes" }))) return;
      try {
        const feedImagenes = await enviarImagenes(cred, fila.sku, fila.borrador.imagenes);
        await transicion(empresaId, id, "imagenes", { feedImagenesId: feedImagenes });
      } catch (error) {
        await transicion(empresaId, id, "imagenes", { estado: "rechazado", errores: [`El producto se creó pero las imágenes fallaron: ${error instanceof Error ? error.message : "error"}`] });
      }
    }
    return;
  }

  if (fila.estado === "imagenes" && fila.feedImagenesId) {
    const feed = await consultarFeed(cred, fila.feedImagenesId);
    if (feed.estado === "terminado") await transicion(empresaId, id, "imagenes", { estado: "publicado" });
    else if (feed.estado === "con_errores" || feed.estado === "cancelado") {
      await transicion(empresaId, id, "imagenes", { estado: "rechazado", errores: feed.errores.length ? feed.errores : ["Falabella rechazó las imágenes sin dar detalle."] });
    }
  }
}

// Solo borra la fila local — nunca toca Falabella (igual que borrarProductoAction en ML).
export async function descartar(empresaId: string, id: string): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.delete(publicacionesFalabella).where(and(eq(publicacionesFalabella.id, id), eq(publicacionesFalabella.empresaId, empresaId)))
  );
}

// Corregir un rechazo: suma los atributos que Falabella pidió al borrador y lo
// devuelve a «borrador» para que se apruebe de nuevo (nunca se reenvía solo).
// Solo desde «rechazado»; el producto no existe en Falabella (el feed falló).
export async function corregirRechazado(empresaId: string, id: string, atributos: Record<string, string>): Promise<void> {
  const fila = await obtener(empresaId, id);
  if (!fila) throw new Error("No se encontró esa publicación.");
  const atributosNuevos = { ...fila.borrador.atributos, ...atributos };
  // «X is/are not applicable to <categoría>»: Falabella no quiere ese atributo.
  for (const e of fila.errores ?? []) {
    const m = String(e).match(/^(\w+) is\/are not applicable to /i);
    if (m) delete atributosNuevos[m[1]];
  }
  const borrador = { ...fila.borrador, atributos: atributosNuevos };
  if (!(await transicion(empresaId, id, "rechazado", { estado: "borrador", borrador, errores: [] }))) {
    throw new Error("Esta publicación ya no está rechazada.");
  }
}
