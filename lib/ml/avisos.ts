import { dbComoAvisoWebhook, dbComoEmpresa } from "@/db/empresa-context";
import { avisosMl, cuentasMl } from "@/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

export type AvisoMl = {
  resource: string;
  user_id: number | string;
  topic: string;
  sent: string;
};

export type ResultadoRecibirAviso = "guardado" | "duplicado" | "cuenta_desconocida";

// Tarea 2.4 — RECIBE y GUARDA el aviso tal cual llega, rápido (un solo
// INSERT), para poder responderle 200 a Mercado Libre sin demora. El
// trabajador que lo procesa de verdad (lib/ml/trabajador.ts) corre
// aparte, disparado por un cron — marca procesado_ts cuando confirma el
// dato real contra la API.
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

export type ConteoAvisos = { recibidos: number; procesados: number; pendientes: number };

// Tarea 2.4 — el criterio de "listo" pide un panel que muestre
// "recibidos, procesados, 0 perdidos" (perdidos = pendientes que
// llevan mucho tiempo sin procesar, algo que el trabajador en marcha
// va bajando solo).
export async function contarAvisos(empresaId: string): Promise<ConteoAvisos> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx
      .select({
        recibidos: sql<number>`count(*)`.mapWith(Number),
        pendientes: sql<number>`count(*) filter (where ${isNull(avisosMl.procesadoTs)})`.mapWith(Number),
      })
      .from(avisosMl);
    return { recibidos: fila.recibidos, pendientes: fila.pendientes, procesados: fila.recibidos - fila.pendientes };
  });
}
