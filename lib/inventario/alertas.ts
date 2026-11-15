import { and, asc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { alertasUltimaUnidad, skus } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { esUuid } from "@/lib/inventario/calculos";

// Issue #280 — banner de la última unidad. Fase 1, gap documentado: la
// API de promociones de ML (seller-promotions) no está en
// lib/ml/cliente.ts y, en Zilonix OS, sacar un ítem de una campaña
// nunca se usó en producción (lib/inventario-recompras.js lo marca como
// "la única operación de promociones que Zilonix no había usado
// nunca"). Por eso "Aplicar" acá NO llama a ML: deja registrado que la
// persona se hizo cargo (quitar la promo a mano en ML) y apaga el
// banner. Automatizarlo es la 1.1, cuando se confirme la API con un
// caso real.

export type AlertaUltimaUnidad = {
  id: string;
  skuId: string;
  codigo: string;
  nombre: string;
  disponibleAlCrear: number;
  regla: (typeof alertasUltimaUnidad.$inferSelect)["regla"];
  creadaTs: Date;
};

export async function listarAlertasPendientes(empresaId: string): Promise<AlertaUltimaUnidad[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: alertasUltimaUnidad.id,
        skuId: alertasUltimaUnidad.skuId,
        codigo: skus.codigo,
        nombre: skus.nombre,
        disponibleAlCrear: alertasUltimaUnidad.disponibleAlCrear,
        regla: alertasUltimaUnidad.regla,
        creadaTs: alertasUltimaUnidad.creadaTs,
      })
      .from(alertasUltimaUnidad)
      .innerJoin(skus, and(eq(skus.empresaId, alertasUltimaUnidad.empresaId), eq(skus.id, alertasUltimaUnidad.skuId)))
      .where(and(eq(alertasUltimaUnidad.empresaId, empresaId), eq(alertasUltimaUnidad.estado, "pendiente")))
      .orderBy(asc(alertasUltimaUnidad.creadaTs))
  );
}

// Lo que el banner le pide a la persona, según la regla de la empresa.
export function instruccionAlerta(regla: AlertaUltimaUnidad["regla"]): string {
  switch (regla) {
    case "quitar_promos":
      return "Quita las promociones de sus publicaciones en Mercado Libre antes de que se venda la última unidad.";
    case "vender_sin_promo":
      return "Si tiene una promoción activa, sácala para vender la última unidad a precio completo.";
    case "preguntar":
      return "¿Quieres quitarle las promociones a la última unidad? Hazlo en Mercado Libre y marca Aplicar.";
  }
}

export class AlertaNoPendienteError extends Error {
  constructor() {
    super("Esa alerta ya se resolvió.");
    this.name = "AlertaNoPendienteError";
  }
}

export async function resolverAlerta(
  empresaId: string,
  usuarioId: string,
  alertaId: string,
  decision: "aplicada" | "descartada"
): Promise<void> {
  if (!esUuid(alertaId)) throw new AlertaNoPendienteError();
  await dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .update(alertasUltimaUnidad)
      .set({ estado: decision, resueltaTs: new Date(), resueltaPor: usuarioId })
      .where(
        and(eq(alertasUltimaUnidad.empresaId, empresaId), eq(alertasUltimaUnidad.id, alertaId), eq(alertasUltimaUnidad.estado, "pendiente"))
      )
      .returning({ skuId: alertasUltimaUnidad.skuId });
    if (filas.length === 0) throw new AlertaNoPendienteError();
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: decision === "aplicada" ? "inventario.ultima_unidad_aplicada" : "inventario.ultima_unidad_no_aplicada",
      entidad: "alertas_ultima_unidad",
      entidadId: alertaId,
      detalle:
        decision === "aplicada"
          ? "Marcó que quitó las promociones a mano en Mercado Libre (Fase 1 no llama a la API de promociones)."
          : "Decidió no aplicar la regla de la última unidad.",
    });
  });
}
