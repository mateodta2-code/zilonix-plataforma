import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { dbSuperadmin } from "@/db/superadmin-context";
import { auditoria, empresas } from "@/db/schema";
import { PLANES, type Plan } from "@/lib/superadmin";

export class EntradaInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "EntradaInvalidaError";
  }
}

// Cada cambio y su renglón de auditoria van en UNA transacción: si la
// auditoria falla, el cambio tampoco queda. Solo conexión superadmin_user,
// que apenas puede escribir las 5 columnas de plan/estado/notas (GRANT por
// columna en db/rls-setup.sql). `motivo` es el "por qué" que pide el PR.
async function cambiar(
  superadminUsuarioId: string,
  empresaId: string,
  accion: string,
  cambios: Partial<typeof empresas.$inferInsert>,
  valor: { anterior: (e: typeof empresas.$inferSelect) => string; nuevo: string },
  motivo: string
) {
  await dbSuperadmin.transaction(async (tx) => {
    const [actual] = await tx.select().from(empresas).where(eq(empresas.id, empresaId));
    if (!actual) throw new EntradaInvalidaError("La empresa no existe.");
    await tx.update(empresas).set(cambios).where(eq(empresas.id, empresaId));
    await tx.insert(auditoria).values({
      id: randomUUID(),
      empresaId,
      usuarioId: superadminUsuarioId,
      actorTipo: "persona",
      accion,
      entidad: "empresa",
      entidadId: empresaId,
      valorAnterior: valor.anterior(actual),
      valorNuevo: valor.nuevo,
      detalle: motivo,
    });
  });
}

export async function cambiarPlanEmpresa(superadminUsuarioId: string, empresaId: string, plan: string) {
  if (!(PLANES as readonly string[]).includes(plan)) throw new EntradaInvalidaError("Plan no válido.");
  await cambiar(
    superadminUsuarioId,
    empresaId,
    "cambiar_plan_superadmin",
    { plan },
    { anterior: (e) => e.plan, nuevo: plan },
    `Cambió el plan a "${plan as Plan}".`
  );
}

export async function suspenderEmpresa(superadminUsuarioId: string, empresaId: string, motivo: string) {
  const limpio = motivo.trim();
  if (!limpio) throw new EntradaInvalidaError("El motivo de la suspensión es obligatorio.");
  await cambiar(
    superadminUsuarioId,
    empresaId,
    "suspender_empresa",
    { estado: "suspendida", suspendidaMotivo: limpio, suspendidaTs: new Date() },
    { anterior: (e) => e.estado, nuevo: "suspendida" },
    limpio
  );
}

export async function reactivarEmpresa(superadminUsuarioId: string, empresaId: string) {
  await cambiar(
    superadminUsuarioId,
    empresaId,
    "reactivar_empresa",
    { estado: "activa", suspendidaMotivo: null, suspendidaTs: null },
    { anterior: (e) => e.estado, nuevo: "activa" },
    "Reactivó la empresa."
  );
}

// Las notas son internas de Zilonix: en auditoria solo queda que se
// editaron (no el texto, que puede tener datos sensibles del cliente).
export async function editarNotasEmpresa(superadminUsuarioId: string, empresaId: string, notas: string) {
  await cambiar(
    superadminUsuarioId,
    empresaId,
    "editar_notas_empresa",
    { notasInternas: notas.trim() || null },
    { anterior: () => "(notas anteriores)", nuevo: "(notas nuevas)" },
    "Editó las notas internas."
  );
}
