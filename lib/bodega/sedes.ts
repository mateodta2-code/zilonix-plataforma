import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import { dbComoBodega } from "@/db/bodega-context";
import { sedesBodega } from "@/db/schema";
import { registrarAuditoriaBodega } from "./auditoria";

export class SedeBodegaError extends Error {}

export type DatosSede = { nombre: string; direccion?: string; ciudad?: string };
export type DatosSedeLimpios = { nombre: string; direccion: string | null; ciudad: string | null };
export type SedeBodega = { id: string; nombre: string; direccion: string | null; ciudad: string | null; activa: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un índice único (bodega_id, nombre) frena repetidos: Postgres responde 23505
// (a veces dentro de `cause`, según cómo envuelva el error el driver).
export function esChoqueUnico(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export function validarDatosSede(datos: DatosSede): DatosSedeLimpios {
  const nombre = (datos.nombre ?? "").trim();
  const direccion = (datos.direccion ?? "").trim();
  const ciudad = (datos.ciudad ?? "").trim();
  if (nombre.length < 2 || nombre.length > 80) throw new SedeBodegaError("El nombre de la sede debe tener entre 2 y 80 caracteres.");
  if (direccion.length > 200) throw new SedeBodegaError("La dirección es demasiado larga (máximo 200 caracteres).");
  if (ciudad.length > 80) throw new SedeBodegaError("La ciudad es demasiado larga (máximo 80 caracteres).");
  return { nombre, direccion: direccion || null, ciudad: ciudad || null };
}

// Solo el admin_bodega escribe. Se revisa acá además de la política RLS
// (sede_bodega_crear/editar): un POST directo de un operario no cambia nada.
function exigirAdmin(rol: string) {
  if (rol !== "admin_bodega") throw new SedeBodegaError("Solo el administrador de la bodega puede cambiar las sedes.");
}

export async function listarSedes(bodegaId: string, rol: string): Promise<SedeBodega[]> {
  return dbComoBodega(
    bodegaId,
    (tx) =>
      tx
        .select({ id: sedesBodega.id, nombre: sedesBodega.nombre, direccion: sedesBodega.direccion, ciudad: sedesBodega.ciudad, activa: sedesBodega.activa })
        .from(sedesBodega)
        .where(eq(sedesBodega.bodegaId, bodegaId))
        .orderBy(asc(sedesBodega.creadoTs)),
    rol
  );
}

export async function crearSede(bodegaId: string, actorId: string, rol: string, datos: DatosSede): Promise<string> {
  exigirAdmin(rol);
  const limpios = validarDatosSede(datos);
  const id = randomUUID();
  try {
    await dbComoBodega(
      bodegaId,
      async (tx) => {
        await tx.insert(sedesBodega).values({ id, bodegaId, ...limpios });
        await registrarAuditoriaBodega(tx, { bodegaId, usuarioId: actorId, accion: "sede_creada", entidad: "sede_bodega", entidadId: id, valorNuevo: limpios.nombre, detalle: "Agregó una sede." });
      },
      rol
    );
  } catch (error) {
    if (esChoqueUnico(error)) throw new SedeBodegaError("Ya existe una sede con ese nombre.");
    throw error;
  }
  return id;
}

function validarSedeId(sedeId: string) {
  if (!UUID_RE.test(sedeId)) throw new SedeBodegaError("La sede no es válida.");
}

export async function editarSede(bodegaId: string, actorId: string, rol: string, sedeId: string, datos: DatosSede): Promise<void> {
  exigirAdmin(rol);
  validarSedeId(sedeId);
  const limpios = validarDatosSede(datos);
  try {
    await dbComoBodega(
      bodegaId,
      async (tx) => {
        const [antes] = await tx.select().from(sedesBodega).where(eq(sedesBodega.id, sedeId));
        if (!antes || antes.bodegaId !== bodegaId) throw new SedeBodegaError("La sede no existe.");
        await tx.update(sedesBodega).set(limpios).where(eq(sedesBodega.id, sedeId));
        await registrarAuditoriaBodega(tx, {
          bodegaId,
          usuarioId: actorId,
          accion: "sede_editada",
          entidad: "sede_bodega",
          entidadId: sedeId,
          valorAnterior: `${antes.nombre} | ${antes.direccion ?? ""} | ${antes.ciudad ?? ""}`,
          valorNuevo: `${limpios.nombre} | ${limpios.direccion ?? ""} | ${limpios.ciudad ?? ""}`,
          detalle: "Editó los datos de una sede.",
        });
      },
      rol
    );
  } catch (error) {
    if (esChoqueUnico(error)) throw new SedeBodegaError("Ya existe una sede con ese nombre.");
    throw error;
  }
}

// Nunca se borra una sede: se desactiva o se reactiva.
export async function cambiarActivaSede(bodegaId: string, actorId: string, rol: string, sedeId: string, activa: boolean): Promise<void> {
  exigirAdmin(rol);
  validarSedeId(sedeId);
  await dbComoBodega(
    bodegaId,
    async (tx) => {
      const [antes] = await tx.select().from(sedesBodega).where(eq(sedesBodega.id, sedeId));
      if (!antes || antes.bodegaId !== bodegaId) throw new SedeBodegaError("La sede no existe.");
      await tx.update(sedesBodega).set({ activa }).where(eq(sedesBodega.id, sedeId));
      await registrarAuditoriaBodega(tx, {
        bodegaId,
        usuarioId: actorId,
        accion: activa ? "sede_reactivada" : "sede_desactivada",
        entidad: "sede_bodega",
        entidadId: sedeId,
        valorAnterior: antes.activa ? "activa" : "inactiva",
        valorNuevo: activa ? "activa" : "inactiva",
        detalle: `${activa ? "Reactivó" : "Desactivó"} la sede ${antes.nombre}.`,
      });
    },
    rol
  );
}
