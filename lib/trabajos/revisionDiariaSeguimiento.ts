import { and, desc, eq, isNull, lt } from "drizzle-orm";
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
  fallidos: number;
  alertasCreadas: number;
};

export async function revisarSeguimientosDelDia(): Promise<ResultadoRevisionDiaria> {
  const activos = await dbTrabajadorSeguimiento
    .select()
    .from(seguimientosMl)
    .where(isNull(seguimientosMl.eliminadoTs))
    .limit(TAMAÑO_LOTE);

  let procesados = 0;
  let fallidos = 0;
  let alertasCreadas = 0;

  for (let i = 0; i < activos.length; i++) {
    if (i > 0) await esperar(PAUSA_ENTRE_SEGUIMIENTOS_MS);
    const seguimiento = activos[i];
    try {
      alertasCreadas += await revisarUnSeguimiento(seguimiento);
      await dbTrabajadorSeguimiento.update(seguimientosMl).set({ ultimaRevisionTs: new Date() }).where(eq(seguimientosMl.id, seguimiento.id));
      procesados += 1;
    } catch (error) {
      // Un seguimiento que falla (cuenta sin token vigente, Mercado
      // Libre caído, etc.) no debe tumbar el lote entero — mismo
      // criterio que procesarAvisosPendientes (lib/ml/trabajador.ts).
      fallidos += 1;
      console.error(`Seguimiento ${seguimiento.id} (${seguimiento.tipo}) no se pudo revisar:`, error instanceof Error ? error.message : error);
    }
  }

  return { activos: activos.length, procesados, fallidos, alertasCreadas };
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

// Solo la FECHA (medianoche UTC) — "misma fecha" es la clave real de
// "misma foto del día", nunca el instante exacto en que corrió el
// trabajo (ver el comentario de seguimiento_fotos.fecha en db/schema.ts).
function fechaDeHoy(): Date {
  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);
  return hoy;
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

// Devuelve cuántas alertas creó — 0 si ya se había revisado hoy (no
// duplica foto, índice único seguimiento_id+fecha) o si es la primera
// foto de este seguimiento (nada con qué comparar todavía).
async function revisarUnSeguimiento(seguimiento: typeof seguimientosMl.$inferSelect): Promise<number> {
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
  if (!fotoNueva) return 0;
  if (!fotoAnterior) return 0;

  const alertas = compararFotos(seguimiento.tipo, aFotoComparable(fotoAnterior), aFotoComparable(fotoNueva));
  if (alertas.length === 0) return 0;

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

  return alertas.length;
}
