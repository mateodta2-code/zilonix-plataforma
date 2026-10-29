import { inArray } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { costosSku, promocionesCandidatos, promocionesReglas } from "@/db/schema";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { calcularCandidatosItem, leerPromocionesDeItem, listarTodosLosItemsActivos, type ReglasCuentaPromocion } from "@/lib/ml/promociones";
import { msDeReintento429 } from "@/lib/ml/reintento-429";

// Rama feat-promociones, punto 4 — "La búsqueda corre como un trabajo
// en lib/trabajos/ sobre todas las cuentas de la empresa, con barra
// de progreso, concurrencia limitada, reintento ante 429 y sin tope
// fijo de 250 (paginado)". Mismo patrón real que
// lib/trabajos/subirClipMultiCuenta.ts (Clip, ya probado): arranca sin
// esperarlo, progreso por cuenta en un Map EN MEMORIA, se poda solo.
// Mismo límite real, documentado (no silencioso): con más de 1
// réplica de Railway, este Map no se comparte entre procesos — el
// polling de un trabajo puede caer en la réplica equivocada y dar 404
// real. Staging corre con 1 sola réplica hasta que exista persistencia
// real para esto.
//
// A diferencia de Clip, el RESULTADO de cada cuenta (los candidatos)
// se guarda en Postgres (promociones_candidatos, upsert) — nunca solo
// en memoria: así /panel/promociones puede mostrar los resultados
// aunque el trabajo ya se haya podado del Map, y el historial de
// "última búsqueda" sobrevive un redeploy.

export type EstadoCuentaBusquedaPromo = "en_cola" | "buscando" | "listo" | "error";

export type ProgresoCuentaBusquedaPromo = {
  cuentaId: string;
  nickname: string;
  estado: EstadoCuentaBusquedaPromo;
  productosRevisados: number;
  itemsConPromociones: number;
  error: string | null;
};

export type TrabajoBusquedaPromociones = {
  id: string;
  empresaId: string;
  creadoTs: number;
  terminadoTs: number | null;
  cuentas: ProgresoCuentaBusquedaPromo[];
};

export type CuentaParaBuscarPromociones = { cuentaId: string; cuentaIdExterna: string; nickname: string };

const CONCURRENCIA_CUENTAS = 2;
const CONCURRENCIA_ITEMS_POR_CUENTA = 5;
const REINTENTOS_429 = 3;
const ESPERA_BASE_429_MS = 2_000;
const TOPE_EDAD_TRABAJO_MS = 2 * 60 * 60 * 1000;

const REGLAS_POR_DEFECTO: ReglasCuentaPromocion = { descuentoMaximoPct: 20, participarCompartidas: false, igualarAlPiso: true };

const trabajos = new Map<string, TrabajoBusquedaPromociones>();

function podarTrabajosViejos(): void {
  const ahora = Date.now();
  for (const [id, trabajo] of trabajos) {
    if (ahora - trabajo.creadoTs > TOPE_EDAD_TRABAJO_MS) trabajos.delete(id);
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mismo criterio real que lib/trabajos/revisionDiariaSeguimiento.ts
// (leerConReintento429): 3 intentos, backoff propio pero el
// Retry-After real de Mercado Libre siempre gana si viene.
async function conReintento429<T>(tarea: () => Promise<T>): Promise<T> {
  for (let intento = 0; ; intento++) {
    try {
      return await tarea();
    } catch (error) {
      if (error instanceof LimiteMercadoLibreError && intento < REINTENTOS_429) {
        await esperar(msDeReintento429(ESPERA_BASE_429_MS * (intento + 1), error.retryAfterMs));
        continue;
      }
      throw error;
    }
  }
}

async function leerReglasCuenta(empresaId: string, cuentaMlId: string): Promise<ReglasCuentaPromocion> {
  const filas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(promocionesReglas).where(inArray(promocionesReglas.cuentaMlId, [cuentaMlId])));
  const fila = filas[0];
  if (!fila) return REGLAS_POR_DEFECTO;
  return { descuentoMaximoPct: fila.descuentoMaximoPct, participarCompartidas: fila.participarCompartidas, igualarAlPiso: fila.igualarAlPiso };
}

type PisoYCosto = { precioMinimo: number | null; costo: number | null };

async function leerPisosYCostos(empresaId: string, skuCodigos: string[]): Promise<Map<string, PisoYCosto>> {
  const mapa = new Map<string, PisoYCosto>();
  if (skuCodigos.length === 0) return mapa;
  const filas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(costosSku).where(inArray(costosSku.skuCodigo, skuCodigos)));
  for (const fila of filas) {
    mapa.set(fila.skuCodigo, {
      precioMinimo: fila.precioMinimoUnidad != null ? Number(fila.precioMinimoUnidad) : null,
      costo: fila.costo != null ? Number(fila.costo) : null,
    });
  }
  return mapa;
}

function mensajeDeErrorBusqueda(error: unknown): string {
  if (error instanceof LimiteMercadoLibreError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 400);
  return "No se pudo buscar promociones en esta cuenta — intentá de nuevo.";
}

async function buscarPromocionesCuenta(empresaId: string, cuenta: CuentaParaBuscarPromociones, cuentaMlId: string, fila: ProgresoCuentaBusquedaPromo): Promise<void> {
  fila.estado = "buscando";
  try {
    const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
    const reglas = await leerReglasCuenta(empresaId, cuentaMlId);
    const ids = await conReintento429(() => listarTodosLosItemsActivos(cuenta.cuentaIdExterna, token));
    fila.productosRevisados = ids.length;

    const itemsConPromos = await conConcurrenciaLimitada(ids, CONCURRENCIA_ITEMS_POR_CUENTA, async (itemId) => {
      try {
        return await conReintento429(() => leerPromocionesDeItem(itemId, cuentaMlId, cuenta.nickname, token));
      } catch {
        // Un item puntual que falla (403/5xx ya se traduce a null
        // dentro de leerPromocionesDeItem; esto cubre un 429 que agotó
        // los reintentos) nunca tira abajo el resto de la cuenta.
        return null;
      }
    });
    const itemsReales = itemsConPromos.filter((i): i is NonNullable<typeof i> => i !== null);
    fila.itemsConPromociones = itemsReales.length;

    const skuCodigos = [...new Set(itemsReales.map((i) => i.skuCodigo).filter((s): s is string => Boolean(s)))];
    const pisosYCostos = await leerPisosYCostos(empresaId, skuCodigos);

    const candidatos = itemsReales.flatMap((item) => {
      const pisoYCosto = item.skuCodigo ? pisosYCostos.get(item.skuCodigo) : undefined;
      return calcularCandidatosItem(item, reglas, pisoYCosto?.precioMinimo ?? null, pisoYCosto?.costo ?? null);
    });

    // Upsert — mismo (cuenta,item,tipo) de una búsqueda anterior se
    // ACTUALIZA, nunca se duplica (índice único de la migración 0017).
    if (candidatos.length > 0) {
      await dbComoEmpresa(empresaId, (tx) =>
        Promise.all(
          candidatos.map((c) =>
            tx
              .insert(promocionesCandidatos)
              .values({
                empresaId,
                cuentaMlId,
                itemId: c.itemId,
                skuCodigo: c.skuCodigo,
                tituloProducto: c.tituloProducto,
                thumbnail: c.thumbnail,
                tieneVariantes: c.tieneVariantes,
                tipoPromocion: c.tipoPromocion,
                promotionIdMl: c.promotionIdMl,
                estadoMl: c.estadoMl,
                esCompartida: c.esCompartida,
                soloEnMl: c.soloEnMl,
                precioOriginal: c.precioOriginal != null ? String(c.precioOriginal) : null,
                precioActual: c.precioActual != null ? String(c.precioActual) : null,
                precioMinimo: c.precioMinimo != null ? String(c.precioMinimo) : null,
                precioSugerido: c.precioSugerido != null ? String(c.precioSugerido) : null,
                maxDiscountedPrice: c.maxDiscountedPrice != null ? String(c.maxDiscountedPrice) : null,
                gananciaEstimada: c.gananciaEstimada != null ? String(c.gananciaEstimada) : null,
                cumpleReglas: c.cumpleReglas,
                motivoRevisarManual: c.motivoRevisarManual,
                actualizadoTs: new Date(),
              })
              .onConflictDoUpdate({
                target: [promocionesCandidatos.cuentaMlId, promocionesCandidatos.itemId, promocionesCandidatos.tipoPromocion],
                set: {
                  skuCodigo: c.skuCodigo,
                  tituloProducto: c.tituloProducto,
                  thumbnail: c.thumbnail,
                  tieneVariantes: c.tieneVariantes,
                  promotionIdMl: c.promotionIdMl,
                  estadoMl: c.estadoMl,
                  esCompartida: c.esCompartida,
                  soloEnMl: c.soloEnMl,
                  precioOriginal: c.precioOriginal != null ? String(c.precioOriginal) : null,
                  precioActual: c.precioActual != null ? String(c.precioActual) : null,
                  precioMinimo: c.precioMinimo != null ? String(c.precioMinimo) : null,
                  precioSugerido: c.precioSugerido != null ? String(c.precioSugerido) : null,
                  maxDiscountedPrice: c.maxDiscountedPrice != null ? String(c.maxDiscountedPrice) : null,
                  gananciaEstimada: c.gananciaEstimada != null ? String(c.gananciaEstimada) : null,
                  cumpleReglas: c.cumpleReglas,
                  motivoRevisarManual: c.motivoRevisarManual,
                  actualizadoTs: new Date(),
                },
              })
          )
        )
      );
    }

    fila.estado = "listo";
  } catch (error) {
    fila.estado = "error";
    fila.error = mensajeDeErrorBusqueda(error);
  }
}

export function iniciarBusquedaPromociones(empresaId: string, cuentas: (CuentaParaBuscarPromociones & { cuentaMlId: string })[]): string {
  podarTrabajosViejos();
  const id = crypto.randomUUID();
  const trabajo: TrabajoBusquedaPromociones = {
    id,
    empresaId,
    creadoTs: Date.now(),
    terminadoTs: null,
    cuentas: cuentas.map((c) => ({ cuentaId: c.cuentaMlId, nickname: c.nickname, estado: "en_cola", productosRevisados: 0, itemsConPromociones: 0, error: null })),
  };
  trabajos.set(id, trabajo);

  void (async () => {
    try {
      await conConcurrenciaLimitada(cuentas, CONCURRENCIA_CUENTAS, async (cuenta, indice) => {
        const fila = trabajo.cuentas[indice];
        try {
          await buscarPromocionesCuenta(empresaId, cuenta, cuenta.cuentaMlId, fila);
        } catch (error) {
          // Red de seguridad extra — buscarPromocionesCuenta ya atrapa
          // todo lo suyo (mismo criterio que subirClipMultiCuenta.ts).
          fila.estado = "error";
          fila.error = mensajeDeErrorBusqueda(error);
        }
      });
    } finally {
      trabajo.terminadoTs = Date.now();
    }
  })();

  return id;
}

export function obtenerTrabajoBusquedaPromociones(jobId: string, empresaId: string): TrabajoBusquedaPromociones | null {
  const trabajo = trabajos.get(jobId);
  if (!trabajo || trabajo.empresaId !== empresaId) return null;
  return trabajo;
}
