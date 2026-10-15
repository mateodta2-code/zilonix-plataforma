import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { permisosRol, roles } from "@/db/schema";

// Tarea 1.7 — módulos de negocio. Todavía no existe ninguna pantalla
// real detrás de la mayoría (llegan en las Fases 2 y 3) salvo
// "finanzas", que acá sirve de demo para el criterio de "listo" de
// esta tarea ("el operador no ve Finanzas"). La lista es a propósito
// la misma que ya anticipaba el comentario de `auditoria` en
// db/schema.ts.
export const MODULOS = ["ventas", "inventario", "finanzas", "personas", "configuracion"] as const;
export type Modulo = (typeof MODULOS)[number];

export const ACCIONES = ["consultar", "crear", "modificar", "anular", "autorizar"] as const;
export type Accion = (typeof ACCIONES)[number];

type Permiso = { modulo: Modulo; accion: Accion; alcance: "todo" | "propio" };

// Plantillas de fábrica — a propósito viven como constante en código,
// no como filas de `roles` con empresa_id NULL: no hay todavía ninguna
// pantalla que necesite EDITAR la plantilla en sí (eso sería una
// función de superadmin, fuera de alcance), solo copiarla al invitar
// por primera vez a alguien con ese rol. El esquema sigue soportando
// plantillas como filas reales el día que haga falta.
//
// Operador/Contador tienen permisos reales porque 1.7 los puede probar
// de verdad (ventas/inventario vs. finanzas). Proveedor y Domiciliario
// nacen sin ningún permiso: sus pantallas reales (portal del
// proveedor, app Flex) son las tareas 3.10 y 3.11 — inventar permisos
// para pantallas que no existen todavía sería adivinar, no construir.
export const NOMBRES_PLANTILLA = ["Operador", "Contador", "Proveedor", "Domiciliario"] as const;
export type NombrePlantilla = (typeof NOMBRES_PLANTILLA)[number];

const PLANTILLAS: Record<NombrePlantilla, Permiso[]> = {
  Operador: [
    { modulo: "ventas", accion: "consultar", alcance: "todo" },
    { modulo: "ventas", accion: "crear", alcance: "todo" },
    { modulo: "ventas", accion: "modificar", alcance: "todo" },
    { modulo: "inventario", accion: "consultar", alcance: "todo" },
    { modulo: "inventario", accion: "modificar", alcance: "todo" },
  ],
  Contador: [
    { modulo: "finanzas", accion: "consultar", alcance: "todo" },
    { modulo: "finanzas", accion: "crear", alcance: "todo" },
    { modulo: "finanzas", accion: "modificar", alcance: "todo" },
    { modulo: "finanzas", accion: "autorizar", alcance: "todo" },
    { modulo: "ventas", accion: "consultar", alcance: "todo" },
    { modulo: "inventario", accion: "consultar", alcance: "todo" },
  ],
  Proveedor: [],
  Domiciliario: [],
};

// Los permisos del rol "Dueño" no vienen de una plantilla — nace con
// TODO sobre TODO, por definición (es quien creó la empresa). Lo usa
// lib/empresas.ts al crearla (tarea 1.6/1.7).
export function permisosDeDueno(): Permiso[] {
  return MODULOS.flatMap((modulo) => ACCIONES.map((accion) => ({ modulo, accion, alcance: "todo" as const })));
}

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

export function tienePermiso(permisos: { modulo: string; accion: string }[], modulo: Modulo, accion: Accion): boolean {
  return permisos.some((p) => p.modulo === modulo && p.accion === accion);
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

export async function obtenerRolDeEmpresa(empresaId: string, rolId: string): Promise<RolConPermisos | null> {
  const roles_ = await listarRolesDeEmpresa(empresaId);
  return roles_.find((r) => r.id === rolId) ?? null;
}

// Reemplaza TODOS los permisos de un rol por el set que llega del
// formulario — más simple y menos propenso a error que calcular un
// diff casilla por casilla. "Dueño" nunca se puede editar desde acá:
// siempre tiene TODO sobre TODO por definición.
export async function reemplazarPermisosDeRol(empresaId: string, rolId: string, permisos: Permiso[]): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const [rol] = await tx.select().from(roles).where(and(eq(roles.id, rolId), eq(roles.empresaId, empresaId)));
    if (!rol) throw new Error("Rol no encontrado en esta empresa.");
    if (rol.nombre === "Dueño") throw new Error('El rol "Dueño" no se puede editar.');

    await tx.delete(permisosRol).where(eq(permisosRol.rolId, rolId));
    if (permisos.length > 0) {
      await tx.insert(permisosRol).values(permisos.map((p) => ({ id: randomUUID(), rolId, ...p })));
    }
  });
}
