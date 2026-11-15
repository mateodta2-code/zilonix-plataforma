import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { costosSku, cuentasMl, promocionesAcciones } from "@/db/schema";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import { LimiteMercadoLibreError, leerItemParaPromocionMl, leerPromocionesItemMl, listarItemsActivosMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import {
  calcularCandidatosItem,
  leerPisoYCostoFresco,
  leerReglasFrescasCuenta,
  puedeSalirPorApi,
  type CandidatoCalculado,
  type ItemConPromociones,
  type ReglasCuentaPromocion,
} from "@/lib/ml/promociones";
import { type AccionEscribible, escribirPromocionMl, validarCalculado } from "@/lib/ml/promocionesEjecucion";
import { msDeReintento429 } from "@/lib/ml/reintento-429";

// Tarea "Promociones real" (Refs #295) — a diferencia del flujo viejo
// (lib/ml/promociones.ts + buscarPromocionesMultiCuenta.ts), que solo
// guarda en `promociones_candidatos` los ítems que SÍ tienen alguna
// promoción aplicable, la maqueta aprobada por Mateo pide ver TODAS
// las publicaciones (también "Sin promoción"), sin un botón "Buscar"
// previo. Decisión explícita de Mateo (2026-11-09): en vez de agregar
// una tabla nueva para guardar el catálogo completo (eso es una
// migración, y hay que pausar y avisar antes de escribir una), esto
// lee SIEMPRE en vivo, página por página, con tope de concurrencia —
// nunca escanea el catálogo entero de una sola vez para armar una
// lista o un contador "global". Los contadores que ve la pantalla son
// sobre lo YA REVISADO en esta sesión de scroll, nunca sobre el
// catálogo completo (ver listarPublicacionesConEstado).

export type EstadoPublicacion = "en_promocion" | "sin_promocion" | "error";

export type PromocionParaUi = {
  tipoPromocion: string;
  promotionIdMl: string | null;
  estadoMl: string;
  esCompartida: boolean;
  soloEnMl: boolean;
  puedeSalirApi: boolean;
  precioOriginal: number | null;
  precioActual: number | null;
  precioMinimo: number | null;
  precioSugerido: number | null;
  maxDiscountedPrice: number | null;
  gananciaEstimada: number | null;
  cumpleReglas: boolean;
  accionSugerida: "participar" | "modificar" | null;
  motivoRevisarManual: string | null;
};

export type PublicacionConEstado = {
  itemId: string;
  cuentaMlId: string;
  nicknameCuenta: string;
  siteId: string;
  tituloProducto: string | null;
  thumbnail: string | null;
  skuCodigo: string | null;
  precioOriginal: number | null;
  stock: number | null;
  tieneVariantes: boolean;
  estado: EstadoPublicacion;
  promociones: PromocionParaUi[];
  motivoError: string | null;
};

function promocionParaUi(c: CandidatoCalculado): PromocionParaUi {
  return {
    tipoPromocion: c.tipoPromocion,
    promotionIdMl: c.promotionIdMl,
    estadoMl: c.estadoMl,
    esCompartida: c.esCompartida,
    soloEnMl: c.soloEnMl,
    puedeSalirApi: puedeSalirPorApi(c.tipoPromocion),
    precioOriginal: c.precioOriginal,
    precioActual: c.precioActual,
    precioMinimo: c.precioMinimo,
    precioSugerido: c.precioSugerido,
    maxDiscountedPrice: c.maxDiscountedPrice,
    gananciaEstimada: c.gananciaEstimada,
    cumpleReglas: c.cumpleReglas,
    accionSugerida: c.accionSugerida,
    motivoRevisarManual: c.motivoRevisarManual,
  };
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const REINTENTOS_429_LECTURA = 1;
const ESPERA_BASE_429_LECTURA_MS = 1200;

// Mismo criterio que buscarPromocionesMultiCuenta.ts/promocionesEjecucion.ts
// (ambos con su propia copia — convención real de este repo, ver
// app/api/ml/promociones/_ayudantes.ts): un reintento corto y propio
// para la LECTURA en vivo, nunca compartido con el de escritura (otro
// presupuesto de tiempo: esto corre detrás de un scroll/página, no de
// un solo click).
async function conReintento429Lectura<T>(tarea: () => Promise<T>): Promise<T> {
  for (let intento = 0; ; intento++) {
    try {
      return await tarea();
    } catch (error) {
      if (error instanceof LimiteMercadoLibreError && intento < REINTENTOS_429_LECTURA) {
        await esperar(msDeReintento429(ESPERA_BASE_429_LECTURA_MS * (intento + 1), error.retryAfterMs));
        continue;
      }
      throw error;
    }
  }
}

// Lee UNA publicación completa (detalle + promociones reales) y la
// pasa por el motor de reglas — a diferencia de leerPromocionesDeItem
// (lib/ml/promociones.ts), esto SIEMPRE trae título/thumbnail/sku/
// precio/stock, también cuando el ítem no tiene ninguna promoción
// aplicable (la lista nueva necesita mostrar esas filas igual, como
// "Sin promoción" — el flujo viejo las descartaba por completo).
export async function leerPublicacionConEstado(
  itemId: string,
  cuentaMlId: string,
  nicknameCuenta: string,
  siteId: string,
  token: string,
  reglas: ReglasCuentaPromocion,
  leerPiso: (skuCodigo: string | null) => Promise<{ precioMinimo: number | null; costo: number | null }>
): Promise<PublicacionConEstado> {
  const base = { itemId, cuentaMlId, nicknameCuenta, siteId };
  let detalle, resultadoPromos;
  try {
    [detalle, resultadoPromos] = await Promise.all([
      conReintento429Lectura(() => leerItemParaPromocionMl(itemId, token)),
      conReintento429Lectura(() => leerPromocionesItemMl(itemId, token)),
    ]);
  } catch (error) {
    return {
      ...base,
      tituloProducto: null,
      thumbnail: null,
      skuCodigo: null,
      precioOriginal: null,
      stock: null,
      tieneVariantes: false,
      estado: "error",
      promociones: [],
      motivoError: error instanceof Error ? error.message.slice(0, 300) : "No se pudo consultar Mercado Libre.",
    };
  }

  if (!detalle) {
    return {
      ...base,
      tituloProducto: null,
      thumbnail: null,
      skuCodigo: null,
      precioOriginal: null,
      stock: null,
      tieneVariantes: false,
      estado: "error",
      promociones: [],
      motivoError: "No se pudo leer esta publicación en Mercado Libre.",
    };
  }

  const comun = {
    ...base,
    tituloProducto: detalle.title,
    thumbnail: detalle.thumbnail,
    skuCodigo: detalle.skuCodigo,
    precioOriginal: detalle.precio,
    stock: detalle.stock,
    tieneVariantes: detalle.tieneVariantes,
  };

  if (resultadoPromos.estado === "sin_permiso") {
    return { ...comun, estado: "error", promociones: [], motivoError: "La app no tiene permiso de Promociones para esta cuenta — reconectarla desde Cuentas." };
  }
  if (resultadoPromos.estado === "no_autorizado") {
    return { ...comun, estado: "error", promociones: [], motivoError: "El token de esta cuenta ya no es válido — reconectarla." };
  }
  if (resultadoPromos.estado === "otro_error") {
    return { ...comun, estado: "error", promociones: [], motivoError: "Mercado Libre no respondió bien para esta publicación — probar de nuevo." };
  }
  if (resultadoPromos.promociones.length === 0) {
    return { ...comun, estado: "sin_promocion", promociones: [], motivoError: null };
  }

  const item: ItemConPromociones = {
    itemId,
    cuentaMlId,
    nickname: nicknameCuenta,
    tituloProducto: detalle.title,
    thumbnail: detalle.thumbnail,
    skuCodigo: detalle.skuCodigo,
    tieneVariantes: detalle.tieneVariantes,
    skuVariantesDistintas: detalle.skuVariantesDistintas,
    promociones: resultadoPromos.promociones,
  };
  const { precioMinimo, costo } = await leerPiso(detalle.skuCodigo);
  const calculadas = calcularCandidatosItem(item, reglas, precioMinimo, costo);
  const estaParticipando = calculadas.some((c) => c.estadoMl === "started" || c.estadoMl === "pending");

  return { ...comun, estado: estaParticipando ? "en_promocion" : "sin_promocion", promociones: calculadas.map(promocionParaUi), motivoError: null };
}

export type FiltroPublicaciones = "todas" | "en-promocion" | "sin-promocion" | "con-error";

function pasaFiltro(fila: PublicacionConEstado, filtro: FiltroPublicaciones): boolean {
  if (filtro === "todas") return true;
  if (filtro === "en-promocion") return fila.estado === "en_promocion";
  if (filtro === "sin-promocion") return fila.estado === "sin_promocion";
  return fila.estado === "error";
}

function pasaBusqueda(fila: PublicacionConEstado, busqueda: string): boolean {
  if (!busqueda) return true;
  const texto = busqueda.trim().toLowerCase();
  if (!texto) return true;
  return (fila.tituloProducto ?? "").toLowerCase().includes(texto) || (fila.skuCodigo ?? "").toLowerCase().includes(texto);
}

export type CursorPublicaciones = { cuentaIndice: number; offset: number };

export function decodificarCursor(cursor: string | null | undefined): CursorPublicaciones {
  if (!cursor) return { cuentaIndice: 0, offset: 0 };
  try {
    const datos = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const cuentaIndice = Number(datos?.cuentaIndice);
    const offset = Number(datos?.offset);
    if (!Number.isInteger(cuentaIndice) || cuentaIndice < 0 || !Number.isInteger(offset) || offset < 0) return { cuentaIndice: 0, offset: 0 };
    return { cuentaIndice, offset };
  } catch {
    return { cuentaIndice: 0, offset: 0 };
  }
}

export function codificarCursor(cursor: CursorPublicaciones): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

type CuentaParaListar = { id: string; cuentaIdExterna: string; nickname: string; siteId: string };

async function listarCuentasParaPublicaciones(empresaId: string, cuentaId: string | "todas"): Promise<CuentaParaListar[]> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: cuentasMl.id, cuentaIdExterna: cuentasMl.cuentaIdExterna, nickname: cuentasMl.nickname, siteId: cuentasMl.siteId })
      .from(cuentasMl)
      .where(cuentaId === "todas" ? isNull(cuentasMl.desconectadaTs) : and(isNull(cuentasMl.desconectadaTs), eq(cuentasMl.id, cuentaId)))
  );
  // Orden estable para que el cursor (cuentaIndice, offset) de la
  // paginación siempre apunte a la misma cuenta entre una llamada y la
  // siguiente — nunca el orden que devuelva Postgres esta vez.
  return [...filas].sort((a, b) => a.nickname.localeCompare(b.nickname));
}

async function leerPisoYCostoFrescoDeEmpresa(empresaId: string, skuCodigo: string | null) {
  return leerPisoYCostoFresco(empresaId, skuCodigo);
}

const TAMANO_LOTE_ML = 20; // publicaciones crudas que se piden a ML por vuelta de la paginación
const TOPE_CONCURRENCIA_ML = 4; // nunca más de 4 llamadas de lectura en paralelo (tope pedido por Mateo)

export type ConteosPublicaciones = { todas: number; enPromocion: number; sinPromocion: number; conError: number };

export type ResultadoListaPublicaciones = {
  filas: PublicacionConEstado[];
  conteosLote: ConteosPublicaciones;
  cursorSiguiente: string | null;
};

// Página por página, en vivo — ver el comentario grande al principio
// del archivo. Nunca escanea el catálogo completo de una pasada.
export async function listarPublicacionesConEstado(
  empresaId: string,
  opciones: { cuentaId: string | "todas"; filtro: FiltroPublicaciones; buscar: string; cursor: string | null; tamanoPagina: number }
): Promise<ResultadoListaPublicaciones> {
  const cuentas = await listarCuentasParaPublicaciones(empresaId, opciones.cuentaId);
  const conteosLote: ConteosPublicaciones = { todas: 0, enPromocion: 0, sinPromocion: 0, conError: 0 };
  const filas: PublicacionConEstado[] = [];
  const posicion = decodificarCursor(opciones.cursor);

  for (let cuentaIndice = posicion.cuentaIndice; cuentaIndice < cuentas.length; cuentaIndice++) {
    const cuenta = cuentas[cuentaIndice];
    let token: string;
    try {
      token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
    } catch {
      // Una cuenta sin token válido no frena la lista — se salta a la
      // siguiente (mismo criterio que el resto del módulo: una cuenta
      // mal nunca tira abajo a las demás).
      continue;
    }
    const reglas = await leerReglasFrescasCuenta(empresaId, cuenta.id);
    let offset = cuentaIndice === posicion.cuentaIndice ? posicion.offset : 0;

    while (true) {
      const pagina = await conReintento429Lectura(() => listarItemsActivosMl(cuenta.cuentaIdExterna, token, offset, TAMANO_LOTE_ML));
      if (pagina.ids.length === 0) break; // esta cuenta se terminó

      const procesadas = await conConcurrenciaLimitada(pagina.ids, TOPE_CONCURRENCIA_ML, (itemId) =>
        leerPublicacionConEstado(itemId, cuenta.id, cuenta.nickname, cuenta.siteId, token, reglas, (sku) => leerPisoYCostoFrescoDeEmpresa(empresaId, sku))
      );

      for (const fila of procesadas) {
        conteosLote.todas += 1;
        if (fila.estado === "en_promocion") conteosLote.enPromocion += 1;
        else if (fila.estado === "sin_promocion") conteosLote.sinPromocion += 1;
        else conteosLote.conError += 1;
        if (pasaFiltro(fila, opciones.filtro) && pasaBusqueda(fila, opciones.buscar)) filas.push(fila);
      }

      offset += pagina.ids.length;
      const siguioEnEstaCuenta = pagina.ids.length === TAMANO_LOTE_ML && offset < pagina.totalCatalogo;

      if (filas.length >= opciones.tamanoPagina) {
        const hayMas = siguioEnEstaCuenta || cuentaIndice + 1 < cuentas.length;
        return { filas, conteosLote, cursorSiguiente: hayMas ? codificarCursor({ cuentaIndice, offset }) : null };
      }
      if (!siguioEnEstaCuenta) break; // pasa a la siguiente cuenta
    }
  }

  return { filas, conteosLote, cursorSiguiente: null };
}

// ---------- Participar / modificar directo (un click + confirmación) ----------

export type ResultadoParticiparDirecto = { ok: boolean; estado: "ejecutada" | "fallida"; error: string | null; accionId: string | null };

// Tarea "Promociones real" — la maqueta aprobada por Mateo pide
// "Participar" como una acción directa (confirmar y listo), sin la
// cola "aprobar → Lanzar aprobadas" del módulo viejo. Sigue siendo UNA
// SOLA función la que de verdad valida y escribe (validarCalculado +
// escribirPromocionMl, lib/ml/promocionesEjecucion.ts) — lo único que
// cambia acá es que el candidato se relee fresco de Mercado Libre en
// este mismo instante, nunca desde promociones_candidatos.
export async function participarEnPublicacionDirecto(
  empresaId: string,
  usuarioId: string,
  cuentaMlId: string,
  itemId: string,
  promotionIdMl: string | null,
  tipoPromocion: string,
  precioElegido: number | undefined
): Promise<ResultadoParticiparDirecto> {
  const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);

  const [detalle, resultadoPromos] = await Promise.all([leerItemParaPromocionMl(itemId, token), leerPromocionesItemMl(itemId, token)]);
  if (!detalle || resultadoPromos.estado !== "ok") {
    return { ok: false, estado: "fallida", error: "No se pudo confirmar el estado real en Mercado Libre antes de participar — probar de nuevo.", accionId: null };
  }
  const promoReal = resultadoPromos.promociones.find((p) => (promotionIdMl ? p.id === promotionIdMl : p.type === tipoPromocion));
  if (!promoReal) {
    return { ok: false, estado: "fallida", error: "Esta promoción ya no está disponible para esta publicación — volver a cargar la lista.", accionId: null };
  }

  const [reglas, piso] = await Promise.all([leerReglasFrescasCuenta(empresaId, cuentaMlId), leerPisoYCostoFresco(empresaId, detalle.skuCodigo)]);
  const item: ItemConPromociones = {
    itemId,
    cuentaMlId,
    nickname: "",
    tituloProducto: detalle.title,
    thumbnail: detalle.thumbnail,
    skuCodigo: detalle.skuCodigo,
    tieneVariantes: detalle.tieneVariantes,
    skuVariantesDistintas: detalle.skuVariantesDistintas,
    promociones: [promoReal],
  };
  const [recalculado] = calcularCandidatosItem(item, reglas, piso.precioMinimo, piso.costo);
  if (!recalculado) {
    return { ok: false, estado: "fallida", error: "No se pudo recalcular esta publicación — probar de nuevo.", accionId: null };
  }

  const accionSolicitada: AccionEscribible = recalculado.estadoMl === "candidate" ? "participar" : "modificar";
  const validacion = validarCalculado(recalculado, piso.precioMinimo, reglas, accionSolicitada, precioElegido);
  if (!validacion.ok) {
    return { ok: false, estado: "fallida", error: validacion.motivo, accionId: null };
  }

  const resultado = await escribirPromocionMl(itemId, token, accionSolicitada, recalculado.promotionIdMl, recalculado.tipoPromocion, validacion.deal);

  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(promocionesAcciones)
      .values({
        empresaId,
        cuentaMlId,
        itemId,
        tituloProducto: detalle.title,
        tipoPromocion: recalculado.tipoPromocion,
        promotionIdMl: recalculado.promotionIdMl,
        accion: accionSolicitada,
        precioAntes: recalculado.precioActual != null ? String(recalculado.precioActual) : null,
        precioDespues: String(validacion.deal),
        estado: resultado.estado,
        aprobadoPor: usuarioId,
        aprobadoTs: new Date(),
        ejecutadoPor: usuarioId,
        ejecutadoTs: new Date(),
        modoSimulacion: false,
        resultadoMl: resultado.resultadoMl,
        error: resultado.error,
      })
      .returning({ id: promocionesAcciones.id })
  );

  return { ok: resultado.estado === "ejecutada", estado: resultado.estado, error: resultado.error, accionId: fila?.id ?? null };
}

// ---------- Aplicar regla a las publicaciones (lote) ----------

export type ReglaAplicable = { tipo: "todas" } | { tipo: "maximo"; maximoPct: number } | { tipo: "tabla-maestra" };

export type FilaResumenAplicarRegla = { itemId: string; tituloProducto: string | null; tipoPromocion: string; estado: "ejecutada" | "fallida" | "omitida"; error: string | null };

export type ResumenAplicarRegla = { revisadas: number; participadas: number; fallidas: number; omitidas: number; filas: FilaResumenAplicarRegla[] };

const TOPE_CONCURRENCIA_APLICAR_REGLA = 4;

// Descuento a cargo del vendedor implícito en el precio que el motor
// sugiere — "a cargo del vendedor" porque deal_price es lo único que
// el vendedor de verdad fija; nunca se inventa un desglose en pesos
// del aporte de Mercado Libre (ver nota en el componente de UI).
function descuentoVendedorPct(c: CandidatoCalculado): number | null {
  if (c.precioOriginal == null || c.precioOriginal <= 0 || c.precioSugerido == null) return null;
  return ((c.precioOriginal - c.precioSugerido) / c.precioOriginal) * 100;
}

// "todas" y "tabla-maestra" son el mismo comportamiento de fondo: el
// piso de Finanzas (costos_sku) NUNCA se puede apagar en este motor
// (lib/ml/promociones.ts, calcularCandidatosItem) — ya es la regla
// real para TODO lo que pasa por acá, sea cual sea el radio-button
// elegido. "tabla-maestra" existe como opción separada solo para que
// la persona pueda elegirla explícitamente sin un tope de % adicional
// (a diferencia de "maximo"), nunca porque el piso se pueda prender o
// apagar — avisar esto en el texto de la UI en vez de fingir una
// regla nueva que el motor no tiene.
function cumpleRegla(c: CandidatoCalculado, regla: ReglaAplicable): boolean {
  if (!c.cumpleReglas || !c.accionSugerida) return false;
  if (regla.tipo !== "maximo") return true;
  const pct = descuentoVendedorPct(c);
  return pct == null || pct <= regla.maximoPct;
}

export async function aplicarReglaALote(empresaId: string, usuarioId: string, cuentaId: string | "todas", regla: ReglaAplicable): Promise<ResumenAplicarRegla> {
  const cuentas = await listarCuentasParaPublicaciones(empresaId, cuentaId);
  const resumen: ResumenAplicarRegla = { revisadas: 0, participadas: 0, fallidas: 0, omitidas: 0, filas: [] };

  for (const cuenta of cuentas) {
    let token: string;
    try {
      token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
    } catch {
      continue;
    }
    const reglasCuenta = await leerReglasFrescasCuenta(empresaId, cuenta.id);

    let offset = 0;
    while (true) {
      const pagina = await conReintento429Lectura(() => listarItemsActivosMl(cuenta.cuentaIdExterna, token, offset, TAMANO_LOTE_ML));
      if (pagina.ids.length === 0) break;

      const candidatosPorItem = await conConcurrenciaLimitada(pagina.ids, TOPE_CONCURRENCIA_APLICAR_REGLA, async (itemId) => {
        const [detalle, resultadoPromos] = await Promise.all([
          conReintento429Lectura(() => leerItemParaPromocionMl(itemId, token)),
          conReintento429Lectura(() => leerPromocionesItemMl(itemId, token)),
        ]);
        if (!detalle || resultadoPromos.estado !== "ok" || resultadoPromos.promociones.length === 0) return [];
        const { precioMinimo, costo } = await leerPisoYCostoFresco(empresaId, detalle.skuCodigo);
        const item: ItemConPromociones = {
          itemId,
          cuentaMlId: cuenta.id,
          nickname: cuenta.nickname,
          tituloProducto: detalle.title,
          thumbnail: detalle.thumbnail,
          skuCodigo: detalle.skuCodigo,
          tieneVariantes: detalle.tieneVariantes,
          skuVariantesDistintas: detalle.skuVariantesDistintas,
          promociones: resultadoPromos.promociones,
        };
        return calcularCandidatosItem(item, reglasCuenta, precioMinimo, costo).map((c) => ({ c, precioMinimo }));
      });

      const porAplicar = candidatosPorItem.flat().filter(({ c }) => {
        resumen.revisadas += 1;
        return cumpleRegla(c, regla);
      });

      await conConcurrenciaLimitada(porAplicar, TOPE_CONCURRENCIA_APLICAR_REGLA, async ({ c, precioMinimo }) => {
        const accionSolicitada: AccionEscribible = c.accionSugerida === "modificar" ? "modificar" : "participar";
        const validacion = validarCalculado(c, precioMinimo, reglasCuenta, accionSolicitada);
        if (!validacion.ok) {
          resumen.omitidas += 1;
          resumen.filas.push({ itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, estado: "omitida", error: validacion.motivo });
          return;
        }
        const resultado = await escribirPromocionMl(c.itemId, token, accionSolicitada, c.promotionIdMl, c.tipoPromocion, validacion.deal);
        await dbComoEmpresa(empresaId, (tx) =>
          tx.insert(promocionesAcciones).values({
            empresaId,
            cuentaMlId: cuenta.id,
            itemId: c.itemId,
            tituloProducto: c.tituloProducto,
            tipoPromocion: c.tipoPromocion,
            promotionIdMl: c.promotionIdMl,
            accion: accionSolicitada,
            precioAntes: c.precioActual != null ? String(c.precioActual) : null,
            precioDespues: String(validacion.deal),
            estado: resultado.estado,
            aprobadoPor: usuarioId,
            aprobadoTs: new Date(),
            ejecutadoPor: usuarioId,
            ejecutadoTs: new Date(),
            modoSimulacion: false,
            resultadoMl: resultado.resultadoMl,
            error: resultado.error,
          })
        );
        if (resultado.estado === "ejecutada") resumen.participadas += 1;
        else resumen.fallidas += 1;
        resumen.filas.push({ itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, estado: resultado.estado, error: resultado.error });
      });

      offset += pagina.ids.length;
      if (pagina.ids.length < TAMANO_LOTE_ML || offset >= pagina.totalCatalogo) break;
    }
  }

  return resumen;
}

// Para el aviso "Tabla maestra tomada del módulo SKU: N SKU, actualizada el ..."
export type ResumenMaestraSku = { total: number; actualizadoTs: Date | null };

export async function leerResumenMaestraSku(empresaId: string): Promise<ResumenMaestraSku> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx.select({ actualizadoTs: costosSku.actualizadoTs }).from(costosSku).where(eq(costosSku.empresaId, empresaId))
  );
  if (filas.length === 0) return { total: 0, actualizadoTs: null };
  const masReciente = filas.reduce<Date | null>((acc, f) => (acc == null || f.actualizadoTs > acc ? f.actualizadoTs : acc), null);
  return { total: filas.length, actualizadoTs: masReciente };
}
