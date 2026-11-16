import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { empresas, membresias, permisosRol, roles } from "@/db/schema";
import { permisosDeDueno } from "@/lib/roles-plantillas";

export type MiMembresia = {
  rolId: string;
  rolNombre: string;
  permisos: { modulo: string; accion: string; alcance: string }[];
  // PR B — la empresa fue suspendida por Zilonix: sus miembros siguen
  // siendo miembros pero con CERO permisos, así que requierePermiso()
  // les niega todos los módulos y el layout de /panel muestra el aviso.
  empresaSuspendida?: boolean;
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

    // Misma transacción: no cuesta una consulta más de conexión. Toda
    // ruta de negocio pasa por aquí (requierePermiso/requiereDueno).
    const [empresa] = await tx.select({ estado: empresas.estado }).from(empresas).where(eq(empresas.id, empresaId));
    if (empresa?.estado === "suspendida") return { rolId, rolNombre, permisos: [], empresaSuspendida: true };

    // Diagnóstico real (Mateo, caso STOREKINGSAS/Publicidad): en
    // /panel/roles el Dueño dice "Siempre todo", pero esa etiqueta
    // nunca garantizó nada — permisosRol solo guarda la FOTO fija de
    // permisosDeDueno() que lib/empresas.ts copió una sola vez, al
    // crear la empresa. Cuando MODULOS/ACCIONES crece después (ej.
    // "publicidad", "promociones" llegaron en ramas posteriores), las
    // empresas con Dueño ya creado se quedan con menos filas que el
    // rol dice tener — sin ningún backfill de datos, el Dueño nunca
    // ve el módulo nuevo. En vez de confiar en lo guardado, el Dueño
    // SIEMPRE calcula el permiso completo en caliente — así "Siempre
    // todo" es verdad de verdad, para tienePermiso/requierePermiso y
    // para el menú, los tres leen este mismo `permisos`.
    if (rolNombre === "Dueño") return { rolId, rolNombre, permisos: permisosDeDueno() };

    const permisos = await tx
      .select({ modulo: permisosRol.modulo, accion: permisosRol.accion, alcance: permisosRol.alcance })
      .from(permisosRol)
      .where(eq(permisosRol.rolId, rolId));

    return { rolId, rolNombre, permisos };
  });
}
