import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { permisosRol, roles } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";

// Tarea 1.8 — los datos puros (módulos, acciones, plantillas, permisos
// peligrosos) viven en lib/roles-plantillas.ts, sin ningún import de
// `db/` — se reexportan acá para no tener que tocar cada archivo que
// ya importaba estos nombres desde "@/lib/roles". Lo que queda en este
// archivo es solo lo que de verdad necesita Postgres.
export {
  ACCIONES,
  codificarPermisos,
  decodificarPermisos,
  esPeligroso,
  MODULOS,
  NOMBRES_PLANTILLA,
  PERMISOS_PELIGROSOS,
  permisosDeDueno,
  permisosQueNoPuedeDar,
  PLANTILLAS,
  plantillasQuePuedeDar,
  tienePermiso,
} from "@/lib/roles-plantillas";
export type { Accion, Modulo, NombrePlantilla, Permiso } from "@/lib/roles-plantillas";

import { PLANTILLAS, type NombrePlantilla, type Permiso } from "@/lib/roles-plantillas";

// Encuentra el rol de ESTA empresa con ese nombre, o lo crea copiando
// los permisos de la plantilla de fábrica. Debe llamarse dentro de un
// dbComoEmpresa(empresaId, ...) — tx ya tiene esa empresa como activa.
export async function asegurarRolDeEmpresa(
  tx: typeof db,
  empresaId: string,
  nombre: NombrePlantilla
): Promise<string> {
  const existente = await tx.select().from(roles).where(and(eq(roles.empresaId, empresaId), eq(roles.nombre, nombre)));
  if (existente.length > 0) return existente[0].id;

  const rolId = randomUUID();
  await tx.insert(roles).values({ id: rolId, nombre, empresaId });
  const permisos = PLANTILLAS[nombre];
  if (permisos.length > 0) {
    await tx.insert(permisosRol).values(permisos.map((p) => ({ id: randomUUID(), rolId, ...p })));
  }
  return rolId;
}

export async function permisosDeRol(tx: typeof db, rolId: string) {
  return tx.select().from(permisosRol).where(eq(permisosRol.rolId, rolId));
}

export type RolConPermisos = { id: string; nombre: string; permisos: Permiso[] };

export async function listarRolesDeEmpresa(empresaId: string): Promise<RolConPermisos[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filasRoles = await tx.select().from(roles).where(eq(roles.empresaId, empresaId));
    const resultado: RolConPermisos[] = [];
    for (const rol of filasRoles) {
      const permisos = await tx
        .select({ modulo: permisosRol.modulo, accion: permisosRol.accion, alcance: permisosRol.alcance })
        .from(permisosRol)
        .where(eq(permisosRol.rolId, rol.id));
      resultado.push({ id: rol.id, nombre: rol.nombre, permisos: permisos as Permiso[] });
    }
    return resultado;
  });
}

// Issue #124 — permisos reales de cada rol que ya existe en la empresa,
// por nombre: lo que necesita plantillasQuePuedeDar() para no comparar
// contra la plantilla cuando la invitación va a reutilizar un rol ya
// ajustado a mano en /panel/roles.
export async function permisosDeRolesPorNombre(empresaId: string): Promise<Record<string, Permiso[]>> {
  const roles_ = await listarRolesDeEmpresa(empresaId);
  return Object.fromEntries(roles_.map((r) => [r.nombre, r.permisos]));
}

export async function obtenerRolDeEmpresa(empresaId: string, rolId: string): Promise<RolConPermisos | null> {
  const roles_ = await listarRolesDeEmpresa(empresaId);
  return roles_.find((r) => r.id === rolId) ?? null;
}

// Reemplaza TODOS los permisos de un rol por el set que llega del
// formulario — más simple y menos propenso a error que calcular un
// diff casilla por casilla. "Dueño" nunca se puede editar desde acá:
// siempre tiene TODO sobre TODO por definición.
export async function reemplazarPermisosDeRol(
  empresaId: string,
  rolId: string,
  permisos: Permiso[],
  usuarioId: string
): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const [rol] = await tx.select().from(roles).where(and(eq(roles.id, rolId), eq(roles.empresaId, empresaId)));
    if (!rol) throw new Error("Rol no encontrado en esta empresa.");
    if (rol.nombre === "Dueño") throw new Error('El rol "Dueño" no se puede editar.');

    await tx.delete(permisosRol).where(eq(permisosRol.rolId, rolId));
    if (permisos.length > 0) {
      await tx.insert(permisosRol).values(permisos.map((p) => ({ id: randomUUID(), rolId, ...p })));
    }

    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "cambiar_permisos",
      entidad: "rol",
      detalle: `Permisos de "${rol.nombre}" actualizados (${permisos.length} permiso${permisos.length === 1 ? "" : "s"} activos).`,
    });
  });
}
