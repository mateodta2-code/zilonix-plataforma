import { randomUUID } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { dbSuperadmin } from "@/db/superadmin-context";
import { anunciosPlataforma, auditoria } from "@/db/schema";
import { validarAnuncio, type TipoAnuncio } from "./anuncios-reglas";

// Anuncios de la plataforma (25-nov). Escribe solo superadmin_user (crear y
// retirar, cada uno con su renglón de auditoría en la misma transacción); el
// panel del vendedor solo lee los vigentes (RLS de app_user). Sin empresa:
// no es dato de negocio de nadie.

export class AnuncioInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "AnuncioInvalidoError";
  }
}

export type Anuncio = { id: string; mensaje: string; tipo: TipoAnuncio; inicioTs: Date; finTs: Date | null; retiradoTs: Date | null; creadoTs: Date };

const columnas = {
  id: anunciosPlataforma.id,
  mensaje: anunciosPlataforma.mensaje,
  tipo: anunciosPlataforma.tipo,
  inicioTs: anunciosPlataforma.inicioTs,
  finTs: anunciosPlataforma.finTs,
  retiradoTs: anunciosPlataforma.retiradoTs,
  creadoTs: anunciosPlataforma.creadoTs,
};

export async function crearAnuncio(superadminUsuarioId: string, entrada: { mensaje: string; tipo: string; desde: string; hasta: string }, ahora = new Date()): Promise<string> {
  const v = validarAnuncio(entrada, ahora);
  if (!v.ok) throw new AnuncioInvalidoError(v.error);
  const id = randomUUID();
  await dbSuperadmin.transaction(async (tx) => {
    await tx.insert(anunciosPlataforma).values({ id, ...v.anuncio, creadoPor: superadminUsuarioId });
    await tx.insert(auditoria).values({
      id: randomUUID(),
      usuarioId: superadminUsuarioId,
      actorTipo: "persona",
      accion: "crear_anuncio",
      entidad: "anuncio_plataforma",
      entidadId: id,
      detalle: v.anuncio.mensaje,
    });
  });
  return id;
}

export async function retirarAnuncio(superadminUsuarioId: string, anuncioId: string): Promise<void> {
  await dbSuperadmin.transaction(async (tx) => {
    // .returning(): si ya estaba retirado (o no existe), RLS deja 0 filas.
    const filas = await tx
      .update(anunciosPlataforma)
      .set({ retiradoTs: new Date() })
      .where(and(eq(anunciosPlataforma.id, anuncioId), isNull(anunciosPlataforma.retiradoTs)))
      .returning({ mensaje: anunciosPlataforma.mensaje });
    if (filas.length === 0) throw new AnuncioInvalidoError("Ese anuncio ya no está publicado.");
    await tx.insert(auditoria).values({
      id: randomUUID(),
      usuarioId: superadminUsuarioId,
      actorTipo: "persona",
      accion: "retirar_anuncio",
      entidad: "anuncio_plataforma",
      entidadId: anuncioId,
      detalle: filas[0].mensaje,
    });
  });
}

// Para /superadmin/anuncios: los últimos 50, el más nuevo primero.
export async function listarAnuncios(): Promise<Anuncio[]> {
  return (await dbSuperadmin.select(columnas).from(anunciosPlataforma).orderBy(desc(anunciosPlataforma.creadoTs)).limit(50)) as Anuncio[];
}

// Para el panel del vendedor: RLS ya devuelve solo los vigentes. Si la
// consulta falla, el panel sigue funcionando sin anuncios.
export async function anunciosVigentes(): Promise<Pick<Anuncio, "id" | "mensaje" | "tipo">[]> {
  try {
    const filas = await db
      .select({ id: anunciosPlataforma.id, mensaje: anunciosPlataforma.mensaje, tipo: anunciosPlataforma.tipo })
      .from(anunciosPlataforma)
      .orderBy(desc(anunciosPlataforma.inicioTs))
      .limit(3);
    return filas as Pick<Anuncio, "id" | "mensaje" | "tipo">[];
  } catch (error) {
    console.error("[lib/anuncios] no se pudieron leer los anuncios:", error instanceof Error ? error.name : error);
    return [];
  }
}
