import { and, eq, isNull } from "drizzle-orm";
import { dbTrabajador } from "@/db/trabajador-context";
import { avisosMl, cuentasMl } from "@/db/schema";
import { dbComoEmpresa } from "@/db/empresa-context";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { guardarPregunta, guardarReclamo, guardarMensajeVenta, resolverPackIdDeMensaje } from "@/lib/ml/bandeja";

const TAMAÑO_LOTE = 50;

export type ResultadoTrabajador = {
  recibidosPendientes: number;
  procesados: number;
  fallidos: number;
};

// Tarea 2.4 — la otra mitad del receptor de avisos (la primera, recibir
// y guardar rápido, ya estaba). Acá se cumple la regla real del plan
// técnico: "consulta el dato real a la API, no confía en el aviso" —
// nunca se asume que lo que trae `resource`/`topic` es cierto, se
// vuelve a pedir ese mismo dato directo a Mercado Libre antes de
// marcarlo procesado. No escribe en ninguna tabla de pedidos/productos
// todavía (esas tablas son las tareas 2.6+) — hoy "procesar" significa
// "confirmar que el dato es real y accesible", honesto con el alcance
// actual.
export async function procesarAvisosPendientes(): Promise<ResultadoTrabajador> {
  const pendientes = await dbTrabajador
    .select()
    .from(avisosMl)
    .where(isNull(avisosMl.procesadoTs))
    .limit(TAMAÑO_LOTE);

  let procesados = 0;
  let fallidos = 0;

  for (const aviso of pendientes) {
    try {
      await procesarUnAviso(aviso);
      await dbTrabajador
        .update(avisosMl)
        .set({ procesadoTs: new Date() })
        .where(and(eq(avisosMl.id, aviso.id), isNull(avisosMl.procesadoTs)));
      procesados += 1;
    } catch (error) {
      // Un aviso que falla (cuenta sin token vigente, orden borrada en
      // ML, error de red) no debe tumbar el lote entero — se deja
      // pendiente (procesado_ts sigue null) para que el próximo paso
      // del trabajador lo reintente.
      fallidos += 1;
      console.error(`Aviso ${aviso.id} (${aviso.topic}) no se pudo procesar:`, error instanceof Error ? error.message : error);
    }
  }

  return { recibidosPendientes: pendientes.length, procesados, fallidos };
}

async function procesarUnAviso(aviso: typeof avisosMl.$inferSelect): Promise<void> {
  const cuentaId = await dbComoEmpresa(aviso.empresaId, async (tx) => {
    const [cuenta] = await tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, aviso.cuentaIdExterna));
    return cuenta?.id ?? null;
  });
  if (!cuentaId) throw new Error("La cuenta de Mercado Libre ya no está conectada a esta empresa.");

  // Tarea 2.9 — preguntas, mensajes y reclamos se procesan de verdad
  // (guardan en la bandeja de atención), no solo se confirman. El resto
  // de los tópicos (ej. orders_v2) sigue con el chequeo genérico de
  // abajo — procesarlos de verdad es trabajo de otras tareas.
  if (aviso.topic === "questions") {
    const match = aviso.resource.match(/\/questions\/(\d+)/);
    if (!match) throw new Error(`No se pudo leer el id de pregunta del recurso "${aviso.resource}".`);
    await guardarPregunta(aviso.empresaId, cuentaId, match[1]);
    return;
  }
  if (aviso.topic === "claims") {
    const match = aviso.resource.match(/\/claims\/([\w-]+)/);
    if (!match) throw new Error(`No se pudo leer el id de reclamo del recurso "${aviso.resource}".`);
    await guardarReclamo(aviso.empresaId, cuentaId, match[1]);
    return;
  }
  if (aviso.topic === "messages") {
    // Bug real confirmado en el sistema actual: acá "resource" no es un
    // path, es el message_id crudo — hay que resolver a qué venta
    // pertenece antes de poder guardar el hilo.
    const accessTokenMensaje = await obtenerAccessTokenVigente(aviso.empresaId, cuentaId);
    const packId = await resolverPackIdDeMensaje(accessTokenMensaje, aviso.resource);
    await guardarMensajeVenta(aviso.empresaId, cuentaId, aviso.cuentaIdExterna, packId);
    return;
  }

  const accessToken = await obtenerAccessTokenVigente(aviso.empresaId, cuentaId);

  // El dato real se vuelve a pedir directo a la API — nunca se confía
  // en lo que traía el aviso más allá de la ruta a consultar.
  const res = await fetch(`https://api.mercadolibre.com${aviso.resource}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    // 404 (ej. una orden de prueba que nunca existió de verdad) no es
    // un fallo del trabajador — se consulta igual, responde que no
    // existe, y con eso ya se cumplió "consultar el dato real". Otros
    // códigos (401, 500) sí son fallos reales que ameritan reintento.
    throw new Error(`Mercado Libre respondió ${res.status} al consultar ${aviso.resource}.`);
  }
}
