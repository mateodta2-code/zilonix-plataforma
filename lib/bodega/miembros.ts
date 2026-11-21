import { and, asc, eq } from "drizzle-orm";
import { dbComoBodega, dbComoUsuarioBodega } from "@/db/bodega-context";
import { bodegas3pl, miembrosBodega3pl, usuarios } from "@/db/schema";
import { registrarAuditoriaBodega } from "./auditoria";
import type { MembresiaBodega } from "./acceso";
import { esRolInvitablePorAdmin, type RolBodega } from "./roles";

export class CambioBodegaInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CambioBodegaInvalidoError";
  }
}

// Todas las bodegas donde esta persona tiene fila (activa o no): la
// decisión de acceso (decidirAcceso) mira activo/estado/rol.
export async function listarMembresiasDeUsuario(usuarioId: string): Promise<MembresiaBodega[]> {
  return dbComoUsuarioBodega(usuarioId, async (tx) => {
    const filas = await tx
      .select({
        bodegaId: bodegas3pl.id,
        bodegaNombre: bodegas3pl.nombre,
        bodegaNit: bodegas3pl.nit,
        bodegaEstado: bodegas3pl.estado,
        rol: miembrosBodega3pl.rol,
        activo: miembrosBodega3pl.activo,
      })
      .from(miembrosBodega3pl)
      .innerJoin(bodegas3pl, eq(bodegas3pl.id, miembrosBodega3pl.bodegaId))
      .where(eq(miembrosBodega3pl.usuarioId, usuarioId))
      .orderBy(asc(miembrosBodega3pl.creadoTs));
    return filas;
  });
}

export type MiembroBodega = { miembroId: string; usuarioId: string; nombre: string; email: string; rol: RolBodega; activo: boolean; desde: Date };

export async function listarMiembros(bodegaId: string): Promise<MiembroBodega[]> {
  return dbComoBodega(bodegaId, (tx) =>
    tx
      .select({
        miembroId: miembrosBodega3pl.id,
        usuarioId: miembrosBodega3pl.usuarioId,
        nombre: usuarios.nombre,
        email: usuarios.email,
        rol: miembrosBodega3pl.rol,
        activo: miembrosBodega3pl.activo,
        desde: miembrosBodega3pl.creadoTs,
      })
      .from(miembrosBodega3pl)
      .innerJoin(usuarios, eq(usuarios.id, miembrosBodega3pl.usuarioId))
      .where(eq(miembrosBodega3pl.bodegaId, bodegaId))
      .orderBy(asc(miembrosBodega3pl.creadoTs))
  );
}

export function contarPorRol(miembros: Pick<MiembroBodega, "rol" | "activo">[]): Record<RolBodega, number> {
  const c: Record<RolBodega, number> = { admin_bodega: 0, operario: 0, domiciliario: 0 };
  for (const m of miembros) if (m.activo) c[m.rol]++;
  return c;
}

// Reglas del admin_bodega sobre una persona: nunca sobre sí mismo ni sobre
// otro admin_bodega (a esos los maneja el superadmin), y solo hacia
// operario o domiciliario (no se puede escalar a nadie).
async function miembroEditable(tx: Parameters<Parameters<typeof dbComoBodega>[1]>[0], bodegaId: string, actorId: string, miembroId: string) {
  const [m] = await tx
    .select()
    .from(miembrosBodega3pl)
    .where(and(eq(miembrosBodega3pl.id, miembroId), eq(miembrosBodega3pl.bodegaId, bodegaId)));
  if (!m) throw new CambioBodegaInvalidoError("Esa persona no está en tu bodega.");
  if (m.usuarioId === actorId) throw new CambioBodegaInvalidoError("No puedes cambiarte a ti mismo.");
  if (m.rol === "admin_bodega") throw new CambioBodegaInvalidoError("El administrador de la bodega no se cambia desde acá.");
  return m;
}

export async function cambiarRolDeMiembro(bodegaId: string, actorId: string, miembroId: string, rolNuevo: string, rolActor: string) {
  if (!esRolInvitablePorAdmin(rolNuevo)) throw new CambioBodegaInvalidoError("Elige un rol válido (operario o domiciliario).");
  return dbComoBodega(bodegaId, async (tx) => {
    const m = await miembroEditable(tx, bodegaId, actorId, miembroId);
    if (m.rol !== rolNuevo) {
      await tx.update(miembrosBodega3pl).set({ rol: rolNuevo }).where(and(eq(miembrosBodega3pl.id, miembroId), eq(miembrosBodega3pl.bodegaId, bodegaId)));
      await registrarAuditoriaBodega(tx, {
        bodegaId,
        usuarioId: actorId,
        accion: "cambiar_rol",
        entidad: "miembro",
        entidadId: miembroId,
        valorAnterior: m.rol,
        valorNuevo: rolNuevo,
        detalle: `Cambió el rol de ${m.rol} a ${rolNuevo}.`,
      });
    }
    return { antes: m.rol, despues: rolNuevo };
  }, rolActor);
}

export async function cambiarActivoDeMiembro(bodegaId: string, actorId: string, miembroId: string, activo: boolean, rolActor: string) {
  return dbComoBodega(bodegaId, async (tx) => {
    const m = await miembroEditable(tx, bodegaId, actorId, miembroId);
    if (m.activo !== activo) {
      await tx.update(miembrosBodega3pl).set({ activo }).where(and(eq(miembrosBodega3pl.id, miembroId), eq(miembrosBodega3pl.bodegaId, bodegaId)));
      await registrarAuditoriaBodega(tx, {
        bodegaId,
        usuarioId: actorId,
        accion: activo ? "reactivar_miembro" : "desactivar_miembro",
        entidad: "miembro",
        entidadId: miembroId,
        detalle: activo ? "Reactivó a una persona." : "Desactivó a una persona.",
      });
    }
  }, rolActor);
}

export async function actualizarDatosBodega(bodegaId: string, actorId: string, datos: { nombre: string; nit: string }, rolActor: string) {
  const nombre = datos.nombre.trim();
  const nit = datos.nit.trim();
  if (!nombre) throw new CambioBodegaInvalidoError("El nombre de la bodega es obligatorio.");
  if (nombre.length > 120 || nit.length > 40) throw new CambioBodegaInvalidoError("El nombre o el NIT son demasiado largos.");
  await dbComoBodega(bodegaId, async (tx) => {
    const [antes] = await tx.select().from(bodegas3pl).where(eq(bodegas3pl.id, bodegaId));
    await tx.update(bodegas3pl).set({ nombre, nit: nit || null }).where(eq(bodegas3pl.id, bodegaId));
    await registrarAuditoriaBodega(tx, {
      bodegaId,
      usuarioId: actorId,
      accion: "editar_bodega",
      entidad: "bodega",
      entidadId: bodegaId,
      valorAnterior: antes ? `${antes.nombre} | ${antes.nit ?? ""}` : undefined,
      valorNuevo: `${nombre} | ${nit}`,
      detalle: "Editó el nombre o el NIT de la bodega.",
    });
  }, rolActor);
}
