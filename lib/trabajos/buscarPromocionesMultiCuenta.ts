import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesCandidatos } from "@/db/schema";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import {
  calcularCandidatosItem,
  leerPisosYCostosFrescos,
  leerPromocionesDeItem,
  leerReglasFrescasCuenta,
  listarTodosLosItemsActivos,
  type ItemConPromociones,
  type ResultadoItemConPromociones,
} from "@/lib/ml/promociones";
import { msDeReintento429 } from "@/lib/ml/reintento-429";

// Bug real en staging (rama fix-promociones-buscar, Refs #44) — la
// empresa sharel dio "Buscar", el trabajo terminó "Listo (0/N)" sin
// ningún candidato y sin ningún error visible. leerPromocionesDeItem
// ya distingue "sin_permiso" (403 en seller-promotions — la APP no
// tiene el scope de Promociones para esta cuenta) de "sin_promos" (de
// verdad no hay nada que ofrecer); acá se CUENTA y, si se acumulan
// varios 403 de seguida, se frena la cuenta entera con un mensaje
// claro — nunca se sigue recorriendo el catálogo completo a ciegas
// contra una app que claramente no tiene el permiso.
const UMBRAL_SIN_PERMISO_PROMOCIONES = 5;

export class PromocionesSinPermisoError extends Error {
  constructor() {
    super("Reconectá esta cuenta en Conectar Mercado Libre — falta permiso de Promociones (scope).");
    this.name = "PromocionesSinPermisoError";
  }
}

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
  // Code review de Pablo — MED 8: true si la paginación por offset de
  // Mercado Libre cortó antes de terminar el catálogo real (ver
  // listarTodosLosItemsActivos en lib/ml/promociones.ts). No silencioso:
  // se muestra en /panel/promociones para esta cuenta.
  catalogoIncompleto: boolean;
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

function mensajeDeErrorBusqueda(error: unknown): string {
  if (error instanceof LimiteMercadoLibreError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 400);
  return "No se pudo buscar promociones en esta cuenta — intentá de nuevo.";
}

async function buscarPromocionesCuenta(empresaId: string, cuenta: CuentaParaBuscarPromociones, cuentaMlId: string, fila: ProgresoCuentaBusquedaPromo): Promise<void> {
  fila.estado = "buscando";
  try {
    const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
    const reglas = await leerReglasFrescasCuenta(empresaId, cuentaMlId);
    const { ids, catalogoIncompleto } = await conReintento429(() => listarTodosLosItemsActivos(cuenta.cuentaIdExterna, token));
    fila.productosRevisados = ids.length;
    fila.catalogoIncompleto = catalogoIncompleto;

    let sinPermiso = 0;
    let noAutorizado = 0;
    let otroError = 0;
    let sinPromos = 0;

    const resultadosItems = await conConcurrenciaLimitada(ids, CONCURRENCIA_ITEMS_POR_CUENTA, async (itemId) => {
      let resultado: ResultadoItemConPromociones;
      try {
        resultado = await conReintento429(() => leerPromocionesDeItem(itemId, cuentaMlId, cuenta.nickname, token));
      } catch {
        // Un 429 que agotó los reintentos en este ítem puntual nunca
        // tira abajo el resto de la cuenta — el umbral de sin_permiso,
        // de acá abajo, es la ÚNICA razón real para frenar la cuenta
        // entera.
        otroError += 1;
        return { estado: "otro_error" as const };
      }
      if (resultado.estado === "sin_permiso") {
        sinPermiso += 1;
        // Fuera del try/catch de arriba a propósito: este throw tiene
        // que llegar hasta el catch de buscarPromocionesCuenta (abajo),
        // nunca quedar atrapado como un fallo "tolerable" de un ítem
        // puntual.
        if (sinPermiso >= UMBRAL_SIN_PERMISO_PROMOCIONES) throw new PromocionesSinPermisoError();
      } else if (resultado.estado === "no_autorizado") {
        noAutorizado += 1;
      } else if (resultado.estado === "otro_error") {
        otroError += 1;
      } else if (resultado.estado === "sin_promos") {
        sinPromos += 1;
      }
      return resultado;
    });

    // Nunca en silencio — si hubo algo distinto de "sin_promos" real,
    // queda en el log (nunca el token, nunca datos de negocio) para
    // poder diagnosticar un "Listo (0/N)" sin tener que adivinar.
    if (sinPermiso > 0 || noAutorizado > 0 || otroError > 0) {
      console.warn(
        `[buscarPromocionesMultiCuenta] cuenta ${cuentaMlId} — de ${ids.length} ítems: sin_permiso=${sinPermiso} no_autorizado=${noAutorizado} otro_error=${otroError} sin_promos=${sinPromos}`
      );
    }

    const itemsReales = resultadosItems
      .filter((r): r is { estado: "con_promos"; item: ItemConPromociones } => r.estado === "con_promos")
      .map((r) => r.item);
    fila.itemsConPromociones = itemsReales.length;

    const skuCodigos = [...new Set(itemsReales.map((i) => i.skuCodigo).filter((s): s is string => Boolean(s)))];
    const pisosYCostos = await leerPisosYCostosFrescos(empresaId, skuCodigos);

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
    cuentas: cuentas.map((c) => ({ cuentaId: c.cuentaMlId, nickname: c.nickname, estado: "en_cola", productosRevisados: 0, itemsConPromociones: 0, catalogoIncompleto: false, error: null })),
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
