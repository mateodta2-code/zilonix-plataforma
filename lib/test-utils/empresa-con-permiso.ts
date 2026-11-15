import { randomUUID } from "crypto";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { empresas, membresias, permisosRol, roles, usuarios } from "@/db/schema";
import type { Accion, Modulo } from "@/lib/roles";

// Empresa + usuario con un rol real que tiene los permisos pedidos, para
// probar funciones que llaman requierePermiso() por su cuenta (mismo
// armado que lib/ml/sku-importar.test.ts).
export async function crearEmpresaConPermisos(nombre: string, permisos: { modulo: Modulo; accion: Accion }[]) {
  const empresaId = randomUUID();
  const usuarioId = randomUUID();
  const rolId = randomUUID();

  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre, nit: `TEST-PERM-${empresaId.slice(0, 8)}` }));
  await db.insert(usuarios).values({ id: usuarioId, email: `prueba-perm-${usuarioId.slice(0, 8)}@zilonix.test`, nombre: `Usuario ${nombre}` });
  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.insert(roles).values({ id: rolId, nombre: "Rol de prueba", empresaId });
    if (permisos.length > 0) await tx.insert(permisosRol).values(permisos.map((p) => ({ rolId, ...p })));
    await tx.insert(membresias).values({ usuarioId, empresaId, rolId });
  });
  return { empresaId, usuarioId };
}
