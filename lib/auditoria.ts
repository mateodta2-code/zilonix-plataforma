import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, usuarios } from "@/db/schema";

export type NuevaAuditoria = {
  empresaId: string;
  usuarioId: string | null; // null cuando actorTipo = "sistema"
  actorTipo: "persona" | "sistema";
  accion: string;
  entidad: string;
  detalle?: string;
};

// Tarea 1.9 — se llama SIEMPRE dentro de la misma transacción
// (dbComoEmpresa) que la acción real que registra: si la acción falla,
// no queda un registro de algo que nunca pasó; si el registro
// fallara, la acción tampoco queda guardada a medias sin dejar
// rastro. `detalle` es una frase corta para una persona, nunca un
// volcado de JSON — evidencia real (Effi, docs/investigacion/effi.md,
// sección H): el detalle de una orden de e-commerce mostraba el JSON
// crudo de la orden en vez de una línea de tiempo legible.
export async function registrarAuditoria(tx: typeof db, entrada: NuevaAuditoria): Promise<void> {
  await tx.insert(auditoria).values({
    id: randomUUID(),
    empresaId: entrada.empresaId,
    usuarioId: entrada.usuarioId,
    actorTipo: entrada.actorTipo,
    accion: entrada.accion,
    entidad: entrada.entidad,
    detalle: entrada.detalle,
  });
}

export type FilaAuditoria = {
  id: string;
  ts: Date;
  actorTipo: "persona" | "sistema";
  actorNombre: string;
  accion: string;
  entidad: string;
  detalle: string | null;
};

// Tarea 1.9 — evidencia real (misma sección de Effi): le atribuía a
// una PERSONA del equipo acciones que en realidad hizo la integración
// automática con Mercado Libre. Acá el nombre nunca sale de adivinar:
// "persona" siempre busca el nombre real en `usuarios` (join, sin
// RLS); "sistema" nunca se mezcla con un nombre de persona, por
// diseño — no hay ninguna columna de la que "robarle" un nombre.
export async function listarAuditoriaDeEmpresa(empresaId: string, limite = 50): Promise<FilaAuditoria[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({
        id: auditoria.id,
        ts: auditoria.ts,
        actorTipo: auditoria.actorTipo,
        actorNombre: usuarios.nombre,
        accion: auditoria.accion,
        entidad: auditoria.entidad,
        detalle: auditoria.detalle,
      })
      .from(auditoria)
      .leftJoin(usuarios, eq(auditoria.usuarioId, usuarios.id))
      .where(eq(auditoria.empresaId, empresaId))
      .orderBy(desc(auditoria.ts))
      .limit(limite);

    return filas.map((f) => ({
      ...f,
      actorNombre: f.actorTipo === "sistema" ? "Sistema / integración" : f.actorNombre ?? "Usuario eliminado",
    }));
  });
}
