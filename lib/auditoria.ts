import { randomUUID } from "crypto";
import { and, asc, desc, eq } from "drizzle-orm";
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
//
// Issue #124 (Z-FIN-02) — la bitácora se filtra por entidad y por
// quién. `usuarioId: "sistema"` filtra las acciones de integraciones
// (que no tienen usuario_id). Ningún filtro se arma como SQL a mano:
// van como parámetros de eq(), y la pantalla además solo los acepta
// si salen de opcionesFiltroAuditoria() (lista blanca).
export type FiltrosAuditoria = { entidad?: string; usuarioId?: string };

export const FILTRO_ACTOR_SISTEMA = "sistema";

export async function listarAuditoriaDeEmpresa(
  empresaId: string,
  limite = 50,
  filtros: FiltrosAuditoria = {}
): Promise<FilaAuditoria[]> {
  const condiciones = [eq(auditoria.empresaId, empresaId)];
  if (filtros.entidad) condiciones.push(eq(auditoria.entidad, filtros.entidad));
  if (filtros.usuarioId === FILTRO_ACTOR_SISTEMA) condiciones.push(eq(auditoria.actorTipo, "sistema"));
  else if (filtros.usuarioId) {
    condiciones.push(eq(auditoria.actorTipo, "persona"));
    condiciones.push(eq(auditoria.usuarioId, filtros.usuarioId));
  }

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
      .where(and(...condiciones))
      .orderBy(desc(auditoria.ts))
      .limit(limite);

    return filas.map((f) => ({
      ...f,
      actorNombre: f.actorTipo === "sistema" ? "Sistema / integración" : f.actorNombre ?? "Usuario eliminado",
    }));
  });
}

export type OpcionesFiltroAuditoria = {
  entidades: string[];
  actores: { valor: string; nombre: string }[];
};

// Las opciones de los <select> salen de lo que de verdad hay en la
// bitácora de ESTA empresa (dentro de dbComoEmpresa, así RLS nunca deja
// colar una entidad o una persona de otra empresa en la lista). La
// pantalla descarta cualquier valor de la URL que no esté acá.
export async function opcionesFiltroAuditoria(empresaId: string): Promise<OpcionesFiltroAuditoria> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const entidades = await tx
      .selectDistinct({ entidad: auditoria.entidad })
      .from(auditoria)
      .where(eq(auditoria.empresaId, empresaId))
      .orderBy(asc(auditoria.entidad));

    const personas = await tx
      .selectDistinct({ usuarioId: auditoria.usuarioId, nombre: usuarios.nombre })
      .from(auditoria)
      .innerJoin(usuarios, eq(auditoria.usuarioId, usuarios.id))
      .where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.actorTipo, "persona")))
      .orderBy(asc(usuarios.nombre));

    const haySistema = await tx
      .select({ id: auditoria.id })
      .from(auditoria)
      .where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.actorTipo, "sistema")))
      .limit(1);

    const actores = personas
      .filter((p): p is { usuarioId: string; nombre: string } => p.usuarioId !== null)
      .map((p) => ({ valor: p.usuarioId, nombre: p.nombre }));
    if (haySistema.length > 0) actores.push({ valor: FILTRO_ACTOR_SISTEMA, nombre: "Sistema / integración" });

    return { entidades: entidades.map((e) => e.entidad), actores };
  });
}
