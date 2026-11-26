import { randomUUID } from "crypto";
import type { db } from "@/db";
import { auditoria } from "@/db/schema";

// Rastro de una acción de bodega: va en la MISMA transacción que la acción
// (si falla una, no queda la otra). empresa_id queda vacío salvo que la acción
// toque datos de una empresa concreta (entregas del domiciliario, despachos), y siempre se
// llena bodega_id; detalle es una frase corta para una persona, sin correos
// completos de terceros ni secretos.
export async function registrarAuditoriaBodega(
  tx: typeof db,
  entrada: { bodegaId: string; empresaId?: string; usuarioId: string | null; accion: string; entidad: string; entidadId?: string; detalle?: string; valorAnterior?: string; valorNuevo?: string }
): Promise<void> {
  await tx.insert(auditoria).values({
    id: randomUUID(),
    bodegaId: entrada.bodegaId,
    empresaId: entrada.empresaId ?? null,
    usuarioId: entrada.usuarioId,
    actorTipo: "persona",
    accion: entrada.accion,
    entidad: entrada.entidad,
    entidadId: entrada.entidadId,
    valorAnterior: entrada.valorAnterior,
    valorNuevo: entrada.valorNuevo,
    detalle: entrada.detalle,
  });
}
