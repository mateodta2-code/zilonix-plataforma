import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { accesosTemporales } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";

export type AccesoTemporal = {
  id: string;
  alcance: string;
  creadoTs: Date;
  expiraTs: Date;
  revocadoTs: Date | null;
};

// Tarea 1.11 (decisión D8) — lado de la EMPRESA: conceder, listar y
// revocar accesos temporales siempre pasa por dbComoEmpresa() normal,
// igual que cualquier otra tabla de negocio. El superadmin nunca
// puede crear ni revocar su propio acceso — solo la empresa, desde
// /panel/soporte.
export async function concederAccesoTemporal(
  empresaId: string,
  concedidoPor: string,
  alcance: string,
  horasValidez: number
): Promise<void> {
  const expiraTs = new Date(Date.now() + horasValidez * 60 * 60 * 1000);
  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.insert(accesosTemporales).values({ id: randomUUID(), empresaId, concedidoPor, alcance, expiraTs });
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId: concedidoPor,
      actorTipo: "persona",
      accion: "conceder_acceso_temporal",
      entidad: "acceso_temporal",
      detalle: `Concedió acceso temporal a soporte: "${alcance}", vence en ${horasValidez}h.`,
    });
  });
}

export async function listarAccesosDeEmpresa(empresaId: string): Promise<AccesoTemporal[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx.select().from(accesosTemporales).where(eq(accesosTemporales.empresaId, empresaId)).orderBy(desc(accesosTemporales.creadoTs))
  );
}

export async function revocarAccesoTemporal(empresaId: string, accesoId: string, usuarioId: string): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    await tx
      .update(accesosTemporales)
      .set({ revocadoTs: new Date() })
      .where(and(eq(accesosTemporales.id, accesoId), eq(accesosTemporales.empresaId, empresaId)));
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "revocar_acceso_temporal",
      entidad: "acceso_temporal",
      detalle: "Revocó un acceso temporal antes de que venciera.",
    });
  });
}
