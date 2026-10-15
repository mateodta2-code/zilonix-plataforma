import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dbSuperadmin } from "@/db/superadmin-context";
import { accesosTemporales, auditoria, empresas, membresias, roles, usuarios } from "@/db/schema";

export class NoEsSuperadminError extends Error {
  constructor() {
    super("Esta cuenta no es superadmin.");
    this.name = "NoEsSuperadminError";
  }
}

export class SinAccesoTemporalError extends Error {
  constructor() {
    super("Esta empresa no tiene un acceso temporal activo — pídele que te conceda uno desde /panel/soporte.");
    this.name = "SinAccesoTemporalError";
  }
}

// Tarea 1.11 — la única función que toda ruta de /superadmin usa para
// preguntar "¿esta cuenta es superadmin?", igual de única que
// requierePermiso() en la tarea 1.8. `usuarios` no tiene RLS (tarea
// 1.3) así que esto se consulta con la conexión normal (`db`), sin
// necesitar ninguna de las dos conexiones especiales.
export async function requiereSuperadmin(usuarioId: string): Promise<void> {
  const [fila] = await db.select({ esSuperadmin: usuarios.esSuperadmin }).from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!fila?.esSuperadmin) throw new NoEsSuperadminError();
}

export type EmpresaConConteo = { id: string; nombre: string; nit: string; creadoTs: Date; miembros: number };

// Lo único que el superadmin ve SIEMPRE, sin pedir nada a nadie: las
// cifras agregadas (decisión D8). Hoy "agregado" es cuántos miembros
// tiene cada empresa — no hay todavía ventas/pedidos reales (llegan
// en Fase 2); cuando lleguen, se suman a esta misma lista sin cambiar
// el mecanismo.
export async function listarEmpresasConConteo(): Promise<EmpresaConConteo[]> {
  return dbSuperadmin
    .select({
      id: empresas.id,
      nombre: empresas.nombre,
      nit: empresas.nit,
      creadoTs: empresas.creadoTs,
      miembros: sql<number>`count(${membresias.id})`.mapWith(Number),
    })
    .from(empresas)
    .leftJoin(membresias, eq(membresias.empresaId, empresas.id))
    .groupBy(empresas.id, empresas.nombre, empresas.nit, empresas.creadoTs);
}

export type MiembroDeEmpresa = { nombre: string; email: string; rolNombre: string };

// El "detalle" que SÍ exige el acceso temporal explícito de la
// empresa — nunca se consulta sin comprobar antes que existe uno
// activo, y cada vista exitosa queda escrita en auditoria (nunca
// legible de vuelta por el propio superadmin: superadmin_user solo
// tiene INSERT en auditoria, ver db/rls-setup.sql).
export async function obtenerMiembrosConAcceso(empresaId: string, superadminUsuarioId: string): Promise<MiembroDeEmpresa[]> {
  const ahora = Date.now();
  const accesos = await dbSuperadmin.select().from(accesosTemporales).where(eq(accesosTemporales.empresaId, empresaId));
  const accesoValido = accesos.find((a) => !a.revocadoTs && a.expiraTs.getTime() > ahora);
  if (!accesoValido) throw new SinAccesoTemporalError();

  const filas = await dbSuperadmin
    .select({ nombre: usuarios.nombre, email: usuarios.email, rolNombre: roles.nombre })
    .from(membresias)
    .innerJoin(usuarios, eq(membresias.usuarioId, usuarios.id))
    .innerJoin(roles, eq(membresias.rolId, roles.id))
    .where(eq(membresias.empresaId, empresaId));

  await dbSuperadmin.insert(auditoria).values({
    id: randomUUID(),
    empresaId,
    usuarioId: superadminUsuarioId,
    actorTipo: "persona",
    accion: "ver_detalle_superadmin",
    entidad: "miembros",
    detalle: `Vio el detalle de miembros amparado en el acceso temporal "${accesoValido.alcance}".`,
  });

  return filas;
}
