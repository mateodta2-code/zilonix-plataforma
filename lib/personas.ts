import { and, asc, eq, isNull } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { invitaciones, membresias, roles, usuarios } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { requierePermiso } from "@/lib/permisos";
import {
  asegurarRolDeEmpresa,
  listarRolesDeEmpresa,
  NOMBRES_PLANTILLA,
  permisosQueNoPuedeDar,
  PLANTILLAS,
  type NombrePlantilla,
  type Permiso,
} from "@/lib/roles";

// Issue #370 — pantalla Personas (/panel/personas): quién está en la
// empresa y con qué rol, las invitaciones pendientes, y cambiar el rol
// de alguien sin volver a invitarlo (antes, una segunda invitación al
// mismo correo con otro rol no cambiaba nada: membresias es única por
// usuario y empresa). Sin migración: membresias, invitaciones y roles.
//
// Ver pide personas.consultar; cambiar un rol, personas.modificar. La
// misma regla de no escalada que al invitar (#124): no se asigna un rol
// con permisos que quien edita no tiene. El rol «Dueño» no se da ni se
// quita desde acá, y nadie se cambia su propio rol.

type Tx = typeof db;

export const ROL_DUENO = "Dueño";

export type Miembro = {
  membresiaId: string;
  usuarioId: string;
  nombre: string;
  email: string;
  rolId: string;
  rolNombre: string;
  desde: Date;
};

export type InvitacionPendiente = {
  id: string;
  email: string;
  rolNombre: string;
  expiraTs: Date;
  estado: "pendiente" | "vencida";
};

export type PersonasEmpresa = { miembros: Miembro[]; invitaciones: InvitacionPendiente[] };

export async function listarPersonas(empresaId: string, usuarioId: string, ahora: Date): Promise<PersonasEmpresa> {
  await requierePermiso(usuarioId, empresaId, "personas", "consultar");
  return dbComoEmpresa(empresaId, async (tx) => {
    const miembros = await tx
      .select({
        membresiaId: membresias.id,
        usuarioId: membresias.usuarioId,
        nombre: usuarios.nombre,
        email: usuarios.email,
        rolId: membresias.rolId,
        rolNombre: roles.nombre,
        desde: membresias.creadoTs,
      })
      .from(membresias)
      .innerJoin(usuarios, eq(usuarios.id, membresias.usuarioId))
      .innerJoin(roles, eq(roles.id, membresias.rolId))
      .where(eq(membresias.empresaId, empresaId))
      .orderBy(asc(membresias.creadoTs));

    // Solo las no aceptadas. Se muestran también las vencidas (marcadas
    // así): sirven para saber a quién hay que volver a invitar.
    const filas = await tx
      .select({ id: invitaciones.id, email: invitaciones.email, rolNombre: invitaciones.rolNombre, expiraTs: invitaciones.expiraTs })
      .from(invitaciones)
      .where(and(eq(invitaciones.empresaId, empresaId), isNull(invitaciones.aceptadaTs)))
      .orderBy(asc(invitaciones.creadoTs));
    const invitacionesPendientes = filas.map((f) => ({ ...f, estado: f.expiraTs > ahora ? ("pendiente" as const) : ("vencida" as const) }));

    return { miembros, invitaciones: invitacionesPendientes };
  });
}

// Un rol que se puede elegir: uno que ya existe en la empresa (rolId) o
// una plantilla que todavía no se creó (se crea al asignarla).
export type OpcionRol = { clave: string; nombre: string; permisos: Permiso[]; puedeDar: boolean };

export function claveRolExistente(rolId: string): string {
  return `rol:${rolId}`;
}

export function clavePlantilla(nombre: NombrePlantilla): string {
  return `plantilla:${nombre}`;
}

// Roles que se pueden asignar (sin «Dueño»), con `puedeDar` según los
// permisos de quien edita. Las plantillas que la empresa ya tiene como
// rol salen una sola vez, con los permisos reales del rol (pudo
// ajustarse en /panel/roles).
export async function opcionesDeRol(empresaId: string, propios: { modulo: string; accion: string; alcance: string }[]): Promise<OpcionRol[]> {
  const existentes = (await listarRolesDeEmpresa(empresaId)).filter((r) => r.nombre !== ROL_DUENO);
  const nombresExistentes = new Set(existentes.map((r) => r.nombre));
  const opciones = [
    ...existentes.map((r) => ({ clave: claveRolExistente(r.id), nombre: r.nombre, permisos: r.permisos })),
    ...NOMBRES_PLANTILLA.filter((n) => !nombresExistentes.has(n)).map((n) => ({ clave: clavePlantilla(n), nombre: n, permisos: PLANTILLAS[n] })),
  ];
  return opciones
    .map((o) => ({ ...o, puedeDar: permisosQueNoPuedeDar(propios, o.permisos).length === 0 }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export class CambioRolInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CambioRolInvalidoError";
  }
}

async function resolverRol(tx: Tx, empresaId: string, clave: string): Promise<{ rolId: string; nombre: string } | null> {
  if (clave.startsWith("rol:")) {
    const [rol] = await tx
      .select({ id: roles.id, nombre: roles.nombre })
      .from(roles)
      .where(and(eq(roles.id, clave.slice(4)), eq(roles.empresaId, empresaId)));
    return rol ? { rolId: rol.id, nombre: rol.nombre } : null;
  }
  if (clave.startsWith("plantilla:")) {
    const nombre = clave.slice("plantilla:".length);
    if (!(NOMBRES_PLANTILLA as readonly string[]).includes(nombre)) return null;
    return { rolId: await asegurarRolDeEmpresa(tx, empresaId, nombre as NombrePlantilla), nombre };
  }
  return null;
}

export async function cambiarRolDeMiembro(
  empresaId: string,
  usuarioId: string,
  membresiaId: string,
  claveRol: string
): Promise<{ antes: string; despues: string }> {
  const miMembresia = await requierePermiso(usuarioId, empresaId, "personas", "modificar");

  // Antes de abrir la transacción: así un pedido no permitido no deja
  // creado el rol de una plantilla que no se iba a usar.
  const opcion = (await opcionesDeRol(empresaId, miMembresia.permisos)).find((o) => o.clave === claveRol);
  if (!opcion) throw new CambioRolInvalidoError("Ese rol no existe en esta empresa.");
  if (!opcion.puedeDar) {
    throw new CambioRolInvalidoError(`Tu rol (${miMembresia.rolNombre}) no puede asignar el rol ${opcion.nombre}: tiene permisos que tú no tienes.`);
  }

  return dbComoEmpresa(empresaId, async (tx) => {
    const [actual] = await tx
      .select({ id: membresias.id, usuarioId: membresias.usuarioId, rolId: membresias.rolId, rolNombre: roles.nombre, email: usuarios.email })
      .from(membresias)
      .innerJoin(roles, eq(roles.id, membresias.rolId))
      .innerJoin(usuarios, eq(usuarios.id, membresias.usuarioId))
      .where(and(eq(membresias.id, membresiaId), eq(membresias.empresaId, empresaId)));
    if (!actual) throw new CambioRolInvalidoError("Esa persona no está en esta empresa.");
    if (actual.usuarioId === usuarioId) throw new CambioRolInvalidoError("No puedes cambiar tu propio rol.");
    if (actual.rolNombre === ROL_DUENO) throw new CambioRolInvalidoError("El rol de un Dueño no se cambia desde acá.");

    const destino = await resolverRol(tx, empresaId, claveRol);
    if (!destino) throw new CambioRolInvalidoError("Ese rol no existe en esta empresa.");
    if (destino.rolId === actual.rolId) return { antes: actual.rolNombre, despues: destino.nombre };

    await tx.update(membresias).set({ rolId: destino.rolId }).where(and(eq(membresias.id, membresiaId), eq(membresias.empresaId, empresaId)));
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "cambiar_rol",
      entidad: "membresia",
      entidadId: membresiaId,
      valorAnterior: actual.rolNombre,
      valorNuevo: destino.nombre,
      detalle: `Cambió el rol de ${actual.email} de ${actual.rolNombre} a ${destino.nombre}.`,
    });
    return { antes: actual.rolNombre, despues: destino.nombre };
  });
}
