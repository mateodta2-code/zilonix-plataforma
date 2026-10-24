import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { dbTrabajadorSeguimiento } from "@/db/trabajador-seguimiento-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, seguimientoAlertas, seguimientoFotos, seguimientosMl } from "@/db/schema";
import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";
import { leerFotoSeguimiento, type SeguimientoParaLeer } from "@/lib/seguimiento/lector";
import { compararFotos, type FotoComparable } from "@/lib/seguimiento/alertas";

// Issue #175 — regla de CLAUDE.md: "toda tarea en segundo plano vive
// en lib/trabajos/". Mismo patrón que lib/ml/trabajador.ts (tarea
// 2.4): dbTrabajadorSeguimiento (rol de base restringido, SELECT/
// UPDATE solo en seguimientos_ml) enumera seguimientos de CUALQUIER
// empresa; apenas se sabe a qué empresa pertenece uno, el resto
// (cuenta, token, foto, alertas) pasa por dbComoEmpresa()/app_user,
// como cualquier consulta de negocio real.
const TAMAÑO_LOTE = 50;

// "Respeta los límites de ML: pausa entre llamadas" — entre CADA
// seguimiento procesado (lib/ml/cliente.ts ya pacea sus propias
// llamadas múltiples dentro de un mismo seguimiento, ej. los lotes de
// /items?ids= de una tienda).
const PAUSA_ENTRE_SEGUIMIENTOS_MS = 500;

// "Reintento con espera en 429" — 3 reintentos con espera creciente
// antes de darse por vencido con ESE seguimiento puntual (nunca tumba
// el lote entero, igual que procesarAvisosPendientes).
const REINTENTOS_429 = 3;
const ESPERA_BASE_429_MS = 2_000;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ResultadoRevisionDiaria = {
  activos: number;
  procesados: number;
  // Issue #196 — distinto de "procesados": el índice único
  // seguimiento_id+fecha bloqueó el insert porque YA había una foto de
  // hoy para este seguimiento (corrida manual repetida, o una carrera
  // entre dos corridas del cron a la vez) — nunca se escribió nada
  // nuevo, pero tampoco fue un error real (ver revisarUnSeguimiento).
  saltados: number;
  fallidos: number;
  alertasCreadas: number;
};

// Solo la FECHA (medianoche UTC) — "misma fecha" es la clave real de
// "misma foto del día", nunca el instante exacto en que corrió el
// trabajo (ver el comentario de seguimiento_fotos.fecha en db/schema.ts).
function fechaDeHoy(): Date {
  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);
  return hoy;
}

// Issue real: el lote tomaba siempre los mismos 50 sin ningún orden —
// un seguimiento 51 nunca llegaba a revisarse si la empresa tenía más
// de un lote. Dos correcciones, exportada aparte para poder probar el
// orden y el filtro solos:
// - Filtro: nunca un seguimiento ya eliminado, y solo los que NO se
//   revisaron hoy (ultima_revision_ts < medianoche UTC, o null — nunca
//   revisado) — uno ya revisado hoy no vuelve a entrar en la cola
//   aunque el cron corra varias veces (ver docs/cron-seguimiento.md,
//   corre cada hora).
// - Orden: ASC NULLS FIRST por ultima_revision_ts — el que nunca se
//   revisó, o el que hace más tiempo que no se revisa, entra primero
//   al lote. Así, entre varias corridas del mismo día, el lote
//   siguiente SÍ llega a los que quedaron afuera del anterior, nunca
//   repite los mismos primeros 50 una y otra vez.
export async function obtenerSeguimientosPendientesDeHoy(): Promise<(typeof seguimientosMl.$inferSelect)[]> {
  const hoy = fechaDeHoy();
  return dbTrabajadorSeguimiento
    .select()
    .from(seguimientosMl)
    .where(and(isNull(seguimientosMl.eliminadoTs), or(isNull(seguimientosMl.ultimaRevisionTs), lt(seguimientosMl.ultimaRevisionTs, hoy))))
    .orderBy(sql`${seguimientosMl.ultimaRevisionTs} ASC NULLS FIRST`)
    .limit(TAMAÑO_LOTE);
}

export async function revisarSeguimientosDelDia(): Promise<ResultadoRevisionDiaria> {
  const activos = await obtenerSeguimientosPendientesDeHoy();

  let procesados = 0;
  let saltados = 0;
  let fallidos = 0;
  let alertasCreadas = 0;

  for (let i = 0; i < activos.length; i++) {
    if (i > 0) await esperar(PAUSA_ENTRE_SEGUIMIENTOS_MS);
    const seguimiento = activos[i];
    try {
      const resultado = await revisarUnSeguimiento(seguimiento);
      if (resultado.saltado) saltados += 1;
      else procesados += 1;
      alertasCreadas += resultado.alertasCreadas;
      await dbTrabajadorSeguimiento.update(seguimientosMl).set({ ultimaRevisionTs: new Date() }).where(eq(seguimientosMl.id, seguimiento.id));
    } catch (error) {
      // Un seguimiento que falla (cuenta sin token vigente, Mercado
      // Libre caído, etc.) no debe tumbar el lote entero — mismo
      // criterio que procesarAvisosPendientes (lib/ml/trabajador.ts).
      fallidos += 1;
      console.error(`Seguimiento ${seguimiento.id} (${seguimiento.tipo}) no se pudo revisar:`, error instanceof Error ? error.message : error);
      // Bug real (issue #175): si un fallido NUNCA marca
      // ultima_revision_ts, el orden ASC NULLS FIRST lo deja al frente
      // del lote para siempre — ahoga los cupos en cada corrida
      // siguiente (encontrado en CI: seguimientos viejos sin cuenta ML
      // conectada, ahogando el lote de 50 y haciendo timeout). Marcarlo
      // igual que un éxito lo rota al final; el filtro "ya revisado
      // hoy" evita que la MISMA corrida (o una corrida posterior el
      // mismo día) lo vuelva a tomar, pero mañana sí se reintenta.
      await dbTrabajadorSeguimiento.update(seguimientosMl).set({ ultimaRevisionTs: new Date() }).where(eq(seguimientosMl.id, seguimiento.id));
    }
  }

  // Issue #196 — un solo log por LOTE (nunca por seguimiento, eso ya
  // lo hace el console.error de arriba), con los conteos nada más —
  // nunca un id de seguimiento, un token ni el cuerpo de una respuesta
  // de Mercado Libre. Sirve para confirmar en los logs del cron (acá y
  // en producción) que el lote corrió y qué tan ocupado estaba, sin
  // tener que sumar a mano las líneas de error de arriba.
  console.log(
    `[lib/trabajos/revisionDiariaSeguimiento] lote del día: ${activos.length} activos, ${procesados} procesados, ${saltados} saltados, ${fallidos} con error, ${alertasCreadas} alertas creadas.`
  );

  return { activos: activos.length, procesados, saltados, fallidos, alertasCreadas };
}

// Exportada para poder probar el reintento con espera en 429 sola,
// mockeando lib/seguimiento/lector.ts con vi.useFakeTimers() — sin
// Postgres real, que no tiene nada que ver con esta lógica puntual.
export async function leerConReintento429(seguimiento: SeguimientoParaLeer, token: string, cuentaIdExterna: string) {
  for (let intento = 0; ; intento++) {
    try {
      return await leerFotoSeguimiento(seguimiento, token, cuentaIdExterna);
    } catch (error) {
      if (error instanceof LimiteMercadoLibreError && intento < REINTENTOS_429) {
        await esperar(ESPERA_BASE_429_MS * (intento + 1));
        continue;
      }
      throw error;
    }
  }
}

function aFotoComparable(fila: typeof seguimientoFotos.$inferSelect): FotoComparable {
  return {
    precio: fila.precio != null ? Number(fila.precio) : null,
    inventarioDisponible: fila.inventarioDisponible,
    vendidos: fila.vendidos,
    estado: fila.estado,
    enCatalogo: fila.enCatalogo,
    ganaBotonCompra: fila.ganaBotonCompra,
    publicaciones: fila.publicaciones,
  };
}

type ResultadoUnSeguimiento = { saltado: boolean; alertasCreadas: number };

// `saltado: true` SOLO cuando el índice único seguimiento_id+fecha
// bloqueó el insert porque ya había una foto de hoy (ver el
// onConflictDoNothing más abajo) — nunca se escribió nada nuevo.
// `saltado: false` con `alertasCreadas: 0` es un caso DISTINTO: la
// foto de hoy SÍ se escribió (sí fue "procesado"), simplemente no hay
// foto de ayer con qué compararla todavía (primera foto de este
// seguimiento) — no hay alertas que generar, pero no es un salto.
async function revisarUnSeguimiento(seguimiento: typeof seguimientosMl.$inferSelect): Promise<ResultadoUnSeguimiento> {
  const cuenta = await obtenerCuentaMlActiva(seguimiento.empresaId);
  if (!cuenta) throw new Error("La empresa no tiene ninguna cuenta de Mercado Libre conectada.");

  const [cuentaFila] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx.select({ cuentaIdExterna: cuentasMl.cuentaIdExterna }).from(cuentasMl).where(eq(cuentasMl.id, cuenta.id))
  );
  const token = await obtenerAccessTokenVigente(seguimiento.empresaId, cuenta.id);

  const datos = await leerConReintento429(seguimiento, token, cuentaFila.cuentaIdExterna);

  const hoy = fechaDeHoy();

  const [fotoAnterior] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx
      .select()
      .from(seguimientoFotos)
      .where(and(eq(seguimientoFotos.seguimientoId, seguimiento.id), lt(seguimientoFotos.fecha, hoy)))
      .orderBy(desc(seguimientoFotos.fecha))
      .limit(1)
  );

  const [fotoNueva] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx
      .insert(seguimientoFotos)
      .values({
        empresaId: seguimiento.empresaId,
        seguimientoId: seguimiento.id,
        fecha: hoy,
        precio: datos.precio != null ? String(datos.precio) : null,
        precioAnterior: datos.precioAnterior != null ? String(datos.precioAnterior) : null,
        inventarioDisponible: datos.inventarioDisponible,
        inventarioAproximado: datos.inventarioAproximado,
        vendidos: datos.vendidos,
        estado: datos.estado,
        enCatalogo: datos.enCatalogo,
        ganaBotonCompra: datos.ganaBotonCompra,
        esFull: datos.esFull,
        esEnvioGratis: datos.esEnvioGratis,
        publicaciones: datos.publicaciones,
      })
      // Si el trabajo ya corrió hoy para este seguimiento (una corrida
      // manual repetida, o el cron disparado dos veces), el índice
      // único seguimiento_id+fecha lo bloquea — onConflictDoNothing en
      // vez de dejar que la excepción tumbe el lote entero.
      .onConflictDoNothing()
      .returning()
  );
  if (!fotoNueva) return { saltado: true, alertasCreadas: 0 };
  if (!fotoAnterior) return { saltado: false, alertasCreadas: 0 };

  const alertas = compararFotos(seguimiento.tipo, aFotoComparable(fotoAnterior), aFotoComparable(fotoNueva));
  if (alertas.length === 0) return { saltado: false, alertasCreadas: 0 };

  await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx.insert(seguimientoAlertas).values(
      alertas.map((alerta) => ({
        empresaId: seguimiento.empresaId,
        seguimientoId: seguimiento.id,
        fotoId: fotoNueva.id,
        tipo: alerta.tipo,
        detalle: alerta.detalle,
      }))
    )
  );

  return { saltado: false, alertasCreadas: alertas.length };
}
