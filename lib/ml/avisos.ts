import { dbComoAvisoWebhook, dbComoEmpresa } from "@/db/empresa-context";
import { avisosMl, cuentasMl } from "@/db/schema";
import { eq } from "drizzle-orm";

export type AvisoMl = {
  resource: string;
  user_id: number | string;
  topic: string;
  sent: string;
};

export type ResultadoRecibirAviso = "guardado" | "duplicado" | "cuenta_desconocida";

// Tarea 2.4 — adelanto parcial: solo RECIBE y GUARDA el aviso tal cual
// llega. El trabajador que lo procesa de verdad (volver a pedirle el
// dato real a la API de Mercado Libre, nunca confiar en lo que trae el
// aviso) es el resto de la tarea 2.4, todavía sin construir — queda
// marcado con `procesadoTs` vacío para que ese trabajador sepa qué le
// falta.
export async function recibirAviso(aviso: AvisoMl): Promise<ResultadoRecibirAviso> {
  const cuentaIdExterna = String(aviso.user_id);

  const empresaId = await dbComoAvisoWebhook(cuentaIdExterna, async (tx) => {
    const [cuenta] = await tx.select({ empresaId: cuentasMl.empresaId }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, cuentaIdExterna));
    return cuenta?.empresaId ?? null;
  });

  // No es una de nuestras cuentas conectadas (o ya se desconectó) —
  // Mercado Libre igual espera un 200, pero no hay nada que guardar.
  if (!empresaId) return "cuenta_desconocida";

  const guardadas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(avisosMl)
      .values({
        empresaId,
        cuentaIdExterna,
        topic: aviso.topic,
        resource: aviso.resource,
        enviadoTs: new Date(aviso.sent),
      })
      .onConflictDoNothing({ target: [avisosMl.cuentaIdExterna, avisosMl.topic, avisosMl.resource, avisosMl.enviadoTs] })
      .returning({ id: avisosMl.id })
  );

  return guardadas.length > 0 ? "guardado" : "duplicado";
}
