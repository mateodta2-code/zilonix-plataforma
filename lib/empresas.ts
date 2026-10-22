import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { dbComoEmpresa, dbComoUsuario } from "@/db/empresa-context";
import { empresas, membresias, permisosRol, roles } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { detalleDeAceptacion, versionesAceptadasCompletas, type VersionesAceptadas } from "@/lib/legal";
import { permisosDeDueno } from "@/lib/roles";

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
// El rol "Dueño" nace con TODO sobre TODO (tarea 1.7, lib/roles.ts) —
// quien crea la empresa siempre puede hacer cualquier cosa en ella. La
// función única que de verdad hace cumplir esto en cada ruta ("¿puede
// [acción] en [módulo]?", con aviso aparte para permisos peligrosos) es
// la tarea 1.8, todavía no construida.
export async function crearEmpresaConDueno(
  usuarioId: string,
  nombre: string,
  nit: string,
  consentimiento: VersionesAceptadas
): Promise<string> {
  // Z-MT-15 — sin versiones no hay fila de aceptación que guardar, y
  // crear la empresa igual dejaría una autorización muda. La acción de
  // la pantalla ya exige la casilla; esto cubre cualquier otro llamado.
  if (!versionesAceptadasCompletas(consentimiento)) {
    throw new Error("Falta la versión de los textos legales aceptados.");
  }

  const empresaId = randomUUID();
  const rolDuenoId = randomUUID();

  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.insert(empresas).values({ id: empresaId, nombre, nit });
    await tx.insert(roles).values({ id: rolDuenoId, nombre: "Dueño", empresaId });
    await tx
      .insert(permisosRol)
      .values(permisosDeDueno().map((p) => ({ id: randomUUID(), rolId: rolDuenoId, ...p })));
    await tx.insert(membresias).values({ id: randomUUID(), usuarioId, empresaId, rolId: rolDuenoId });
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "crear",
      entidad: "empresa",
      detalle: `Empresa "${nombre}" (NIT ${nit}) creada.`,
    });
    // La versión va en `detalle` y la fecha en `ts` (la pone la base al
    // insertar). La tabla de auditoría ya tenía esas dos columnas: no
    // hace falta una tabla ni una columna nueva. Misma transacción que
    // crear la empresa: si esto falla, la empresa tampoco queda.
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "aceptar_terminos_y_datos",
      entidad: "consentimiento",
      detalle: detalleDeAceptacion(consentimiento),
    });
  });

  return empresaId;
}
