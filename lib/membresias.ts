import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { membresias, permisosRol, roles } from "@/db/schema";

export type MiMembresia = {
  rolId: string;
  rolNombre: string;
  permisos: { modulo: string; accion: string; alcance: string }[];
};

// Tarea 1.7 — lo que necesita cualquier pantalla para decidir qué
// mostrarle a quien la mira: su rol en la empresa activa y la lista
// completa de permisos de ese rol. Esto NO es la función única de la
// tarea 1.8 ("¿puede [acción] en [módulo]?", exigida en cada ruta por
// el CI) — es la pieza mínima que 1.7 necesita para poder demostrar su
// propio criterio de "listo" (el operador no ve Finanzas).
export async function obtenerMiMembresia(usuarioId: string, empresaId: string): Promise<MiMembresia | null> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({ rolId: membresias.rolId, rolNombre: roles.nombre })
      .from(membresias)
      .innerJoin(roles, eq(membresias.rolId, roles.id))
      .where(and(eq(membresias.usuarioId, usuarioId), eq(membresias.empresaId, empresaId)));

    if (filas.length === 0) return null;
    const { rolId, rolNombre } = filas[0];

    const permisos = await tx
      .select({ modulo: permisosRol.modulo, accion: permisosRol.accion, alcance: permisosRol.alcance })
      .from(permisosRol)
      .where(eq(permisosRol.rolId, rolId));

    return { rolId, rolNombre, permisos };
  });
}
