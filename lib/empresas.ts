import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { dbComoEmpresa, dbComoUsuario } from "@/db/empresa-context";
import { empresas, membresias, roles } from "@/db/schema";

export type EmpresaDeUsuario = { id: string; nombre: string; nit: string };

// Tarea 1.6 — lo que llena el selector "cambiar de empresa en 1 clic".
// Usa dbComoUsuario(), no dbComoEmpresa(): acá todavía no hay ninguna
// empresa "activa", es justo la lista para elegir una.
export async function listarEmpresasDeUsuario(usuarioId: string): Promise<EmpresaDeUsuario[]> {
  return dbComoUsuario(usuarioId, (tx) =>
    tx
      .select({ id: empresas.id, nombre: empresas.nombre, nit: empresas.nit })
      .from(membresias)
      .innerJoin(empresas, eq(membresias.empresaId, empresas.id))
      .where(eq(membresias.usuarioId, usuarioId))
  );
}

// Crea la empresa, su rol "Dueño" y la membresía que conecta a quien la
// crea, todo en una sola transacción (si algo falla a mitad de camino,
// no queda una empresa huérfana sin dueño).
//
// El rol "Dueño" nace SIN filas en permisos_rol todavía — armar las
// plantillas de permisos reales (Operador, Contador, Vendedor, con sus
// acciones peligrosas marcadas) es la tarea 1.8, a propósito fuera de
// esta. Por ahora el rol solo existe para que la membresía pueda
// apuntar a algo.
export async function crearEmpresaConDueno(usuarioId: string, nombre: string, nit: string): Promise<string> {
  const empresaId = randomUUID();
  const rolDuenoId = randomUUID();

  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.insert(empresas).values({ id: empresaId, nombre, nit });
    await tx.insert(roles).values({ id: rolDuenoId, nombre: "Dueño", empresaId });
    await tx.insert(membresias).values({ id: randomUUID(), usuarioId, empresaId, rolId: rolDuenoId });
  });

  return empresaId;
}
