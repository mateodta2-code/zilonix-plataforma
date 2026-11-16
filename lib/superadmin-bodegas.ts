import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { dbSuperadmin } from "@/db/superadmin-context";
import { auditoria, bodegas3pl, invitacionesBodega3pl, miembrosBodega3pl } from "@/db/schema";
import { nuevoTokenInvitacion } from "@/lib/bodega/invitaciones";

export class BodegaInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "BodegaInvalidaError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function exigirUuid(id: string) {
  if (!UUID_RE.test(id)) throw new BodegaInvalidaError("La bodega no existe.");
}

export type BodegaConConteo = {
  id: string;
  nombre: string;
  nit: string | null;
  estado: "activa" | "suspendida";
  creadoTs: Date;
  admins: number;
  operarios: number;
  domiciliarios: number;
};

// Toda lectura y escritura pasa por db/superadmin-context.ts. Solo cifras:
// el superadmin ve cuántas personas hay por rol, no quiénes son.
export async function listarBodegas(): Promise<BodegaConConteo[]> {
  const filas = await dbSuperadmin.select().from(bodegas3pl);
  const miembros = await dbSuperadmin.select({ bodegaId: miembrosBodega3pl.bodegaId, rol: miembrosBodega3pl.rol, activo: miembrosBodega3pl.activo }).from(miembrosBodega3pl);
  return filas
    .map((b) => {
      const de = miembros.filter((m) => m.bodegaId === b.id && m.activo);
      return {
        id: b.id,
        nombre: b.nombre,
        nit: b.nit,
        estado: b.estado,
        creadoTs: b.creadoTs,
        admins: de.filter((m) => m.rol === "admin_bodega").length,
        operarios: de.filter((m) => m.rol === "operario").length,
        domiciliarios: de.filter((m) => m.rol === "domiciliario").length,
      };
    })
    .sort((a, b) => b.creadoTs.getTime() - a.creadoTs.getTime());
}

export async function crearBodega(superadminUsuarioId: string, datos: { nombre: string; nit: string }): Promise<{ id: string }> {
  const nombre = datos.nombre.trim();
  if (!nombre) throw new BodegaInvalidaError("El nombre de la bodega es obligatorio.");
  if (nombre.length > 120 || datos.nit.length > 40) throw new BodegaInvalidaError("El nombre o el NIT son demasiado largos.");
  const id = randomUUID();
  await dbSuperadmin.transaction(async (tx) => {
    await tx.insert(bodegas3pl).values({ id, nombre, nit: datos.nit.trim() || null });
    await tx.insert(auditoria).values({
      id: randomUUID(),
      bodegaId: id,
      usuarioId: superadminUsuarioId,
      actorTipo: "persona",
      accion: "crear_bodega",
      entidad: "bodega",
      entidadId: id,
      detalle: `Creó la bodega "${nombre}".`,
    });
  });
  return { id };
}

// Cambio de estado + auditoría en UNA transacción (si la auditoría falla,
// el cambio tampoco queda).
async function cambiarEstado(superadminUsuarioId: string, bodegaId: string, estado: "activa" | "suspendida", accion: string, detalle: string) {
  exigirUuid(bodegaId);
  await dbSuperadmin.transaction(async (tx) => {
    const [actual] = await tx.select().from(bodegas3pl).where(eq(bodegas3pl.id, bodegaId));
    if (!actual) throw new BodegaInvalidaError("La bodega no existe.");
    await tx.update(bodegas3pl).set({ estado }).where(eq(bodegas3pl.id, bodegaId));
    await tx.insert(auditoria).values({
      id: randomUUID(),
      bodegaId,
      usuarioId: superadminUsuarioId,
      actorTipo: "persona",
      accion,
      entidad: "bodega",
      entidadId: bodegaId,
      valorAnterior: actual.estado,
      valorNuevo: estado,
      detalle,
    });
  });
}

export async function suspenderBodega(superadminUsuarioId: string, bodegaId: string, motivo: string) {
  const limpio = motivo.trim();
  if (!limpio) throw new BodegaInvalidaError("El motivo de la suspensión es obligatorio.");
  await cambiarEstado(superadminUsuarioId, bodegaId, "suspendida", "suspender_bodega", limpio);
}

export async function reactivarBodega(superadminUsuarioId: string, bodegaId: string) {
  await cambiarEstado(superadminUsuarioId, bodegaId, "activa", "reactivar_bodega", "Reactivó la bodega.");
}

// El superadmin solo invita al admin_bodega (la base lo exige también:
// política sa_inv_bodega_crear_admin).
export async function invitarAdminBodega(superadminUsuarioId: string, bodegaId: string, email: string): Promise<{ token: string }> {
  exigirUuid(bodegaId);
  const correo = email.trim();
  if (!correo || !correo.includes("@")) throw new BodegaInvalidaError("El correo es obligatorio.");
  const { token, expiraTs } = nuevoTokenInvitacion();
  await dbSuperadmin.transaction(async (tx) => {
    const [bodega] = await tx.select().from(bodegas3pl).where(eq(bodegas3pl.id, bodegaId));
    if (!bodega) throw new BodegaInvalidaError("La bodega no existe.");
    const id = randomUUID();
    await tx.insert(invitacionesBodega3pl).values({ id, bodegaId, email: correo, rol: "admin_bodega", bodegaNombre: bodega.nombre, token, invitadoPor: superadminUsuarioId, expiraTs });
    await tx.insert(auditoria).values({
      id: randomUUID(),
      bodegaId,
      usuarioId: superadminUsuarioId,
      actorTipo: "persona",
      accion: "invitar_admin_bodega",
      entidad: "invitacion",
      entidadId: id,
      detalle: `Invitó al administrador de "${bodega.nombre}".`,
    });
  });
  return { token };
}

