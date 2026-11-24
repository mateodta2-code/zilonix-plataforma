import { and, eq, isNull } from "drizzle-orm";
import { conReglaYOrigen, nuevoLoteBitacora, resultadoMlOmitida, type ExtraBitacora } from "./promocionesBitacora";
import { dbComoEmpresa } from "@/db/empresa-context";
import { costosSku, cuentasMl, promocionesAcciones } from "@/db/schema";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import { LimiteMercadoLibreError, leerItemParaPromocionMl, leerPromocionesItemMl, listarItemsActivosMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import {
  calcularCandidatosItem,
  descuentoFueraDeRangoPriceDiscount,
  leerPisoYCostoFresco,
  leerReglasFrescasCuenta,
  puedeSalirPorApi,
  type CandidatoCalculado,
  type ItemConPromociones,
  type ReglasCuentaPromocion,
} from "@/lib/ml/promociones";
import { agruparPorCuenta, type ItemSeleccionado } from "@/lib/ml/promocionesSeleccion";
import { type AccionEscribible, escribirPromocionMl, validarCalculado } from "@/lib/ml/promocionesEjecucion";
import { evaluarCandidatoConReglas, leerReglasAdicionalesCuentas, nombreDePromocion, type CacheNombresPromocion } from "@/lib/ml/promocionesReglasAdicionales";
import type { ReglasAdicionales } from "@/lib/ml/promocionesReglasTexto";
import type { EvaluacionReglasAdicionales } from "@/lib/ml/promocionesReglasAplicar";
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
  // PR 2 — qué «regla adicional» (texto libre, solo para «tabla-maestra»)
  // la excluyó o la limitó: «Excluida por: …» / «Limitada a N% por: …».
  // null = ninguna la afecta. La pantalla solo lo muestra con
  // «tabla-maestra» elegida.
  reglaAdicionalMotivo: string | null;
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

function promocionParaUi(c: CandidatoCalculado, reglaAdicionalMotivo: string | null = null): PromocionParaUi {
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
    reglaAdicionalMotivo,
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
export async function conReintento429Lectura<T>(tarea: () => Promise<T>): Promise<T> {
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
  leerPiso: (skuCodigo: string | null) => Promise<{ precioMinimo: number | null; costo: number | null }>,
  // PR 2 — reglas adicionales ya guardadas de esta cuenta (o null). Solo
  // para mostrar el motivo por promoción; el piso sigue mandando.
  reglasAdicionales: ReglasAdicionales | null = null,
  cacheNombres: CacheNombresPromocion = new Map(),
  // Promo-D: false SOLO con la regla «todas» (sin piso ni tope nuestro; el
  // precio es el sugerido por Mercado Libre). Por defecto, el modo seguro.
  aplicarPiso: boolean = true,
  // Promo-F: «máximo X %» (sin piso) — tope de % a cargo del vendedor.
  maximoPct: number | null = null
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
  // Sin piso («todas») no se lee costos_sku: no se exige ni se muestra el piso.
  const { precioMinimo, costo } = aplicarPiso ? await leerPiso(detalle.skuCodigo) : { precioMinimo: null, costo: null };
  const calculadasMotor = calcularCandidatosItem(item, reglas, precioMinimo, costo, aplicarPiso);
  const calculadas = !aplicarPiso && maximoPct != null ? calculadasMotor.map((c) => aplicarTopeMaximo(c, maximoPct)) : calculadasMotor;
  const estaParticipando = calculadas.some((c) => c.estadoMl === "started" || c.estadoMl === "pending");

  const promociones: PromocionParaUi[] = [];
  for (let i = 0; i < calculadas.length; i++) {
    const c = calculadas[i];
    // Solo tiene sentido evaluar lo que el motor (con piso) dejaría hacer.
    const evaluacion = c.accionSugerida ? await evaluarCandidatoConReglas(c, resultadoPromos.promociones[i], reglasAdicionales, token, cacheNombres) : null;
    promociones.push(promocionParaUi(c, evaluacion?.motivoVisible ?? null));
  }
  return { ...comun, estado: estaParticipando ? "en_promocion" : "sin_promocion", promociones, motivoError: null };
}

// Promo-F: regla «Máximo X %» = SOLO el tope de % a cargo del vendedor (sin
// piso de Finanzas, sin tope de la cuenta). Se aplica sobre un candidato ya
// calculado en modo sin piso. Si la promo pide más del X %: no participa
// (motivo claro); si deja elegir el precio (PRICE_DISCOUNT) entra con el
// precio que deja X % (redondeado hacia arriba al entero, así nunca pasa de
// X %) siempre que respete max_discounted_price y el rango 5–80 % de ML.
export function aplicarTopeMaximo(c: CandidatoCalculado, maximoPct: number): CandidatoCalculado {
  if (!c.cumpleReglas || c.accionSugerida !== "participar") return c;
  const pct = descuentoVendedorPct(c);
  if (pct == null || pct <= maximoPct + 1e-9) return c;
  const bloquear = (motivo: string): CandidatoCalculado => ({ ...c, cumpleReglas: false, accionSugerida: null, motivoRevisarManual: motivo });
  const motivoSupera = `El descuento a cargo del vendedor (${pct.toFixed(1)} %) supera el máximo de ${maximoPct} %.`;
  if (c.tipoPromocion !== "PRICE_DISCOUNT" || c.precioOriginal == null) return bloquear(motivoSupera);
  const precio = Math.ceil(c.precioOriginal * (1 - maximoPct / 100));
  if (c.maxDiscountedPrice != null && precio > c.maxDiscountedPrice) {
    return bloquear(`${motivoSupera} Al máximo de ${maximoPct} % el precio (${precio}) superaría lo que permite esta promoción (${c.maxDiscountedPrice}).`);
  }
  const fueraDeRango = descuentoFueraDeRangoPriceDiscount(c.tipoPromocion, c.precioOriginal, precio, "sugerido-ml");
  if (fueraDeRango) return bloquear(`${motivoSupera} Al máximo de ${maximoPct} %: ${fueraDeRango}`);
  return { ...c, precioSugerido: precio };
}

export function maximoPctValido(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 1 && valor <= 80;
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

export type CuentaParaListar = { id: string; cuentaIdExterna: string; nickname: string; siteId: string };

export async function listarCuentasParaPublicaciones(empresaId: string, cuentaId: string | "todas"): Promise<CuentaParaListar[]> {
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

export const TAMANO_LOTE_ML = 20; // publicaciones crudas que se piden a ML por vuelta de la paginación
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
  opciones: { cuentaId: string | "todas"; filtro: FiltroPublicaciones; buscar: string; cursor: string | null; tamanoPagina: number; aplicarPiso?: boolean; maximoPct?: number | null }
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
    const reglasAdicionales = (await leerReglasAdicionalesCuentas(empresaId, [cuenta.id])).get(cuenta.id) ?? null;
    const cacheNombres: CacheNombresPromocion = new Map();
    let offset = cuentaIndice === posicion.cuentaIndice ? posicion.offset : 0;

    while (true) {
      const pagina = await conReintento429Lectura(() => listarItemsActivosMl(cuenta.cuentaIdExterna, token, offset, TAMANO_LOTE_ML));
      if (pagina.ids.length === 0) break; // esta cuenta se terminó

      const procesadas = await conConcurrenciaLimitada(pagina.ids, TOPE_CONCURRENCIA_ML, (itemId) =>
        leerPublicacionConEstado(itemId, cuenta.id, cuenta.nickname, cuenta.siteId, token, reglas, (sku) => leerPisoYCostoFrescoDeEmpresa(empresaId, sku), reglasAdicionales, cacheNombres, opciones.aplicarPiso ?? true, opciones.maximoPct ?? null)
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

// Nombre legible de la promoción para la bitácora (Promo-E). Reusa el caché
// de nombres; si Mercado Libre no lo da, nunca frena lo que ya se hizo.
async function nombreSeguro(promo: Parameters<typeof nombreDePromocion>[0], token: string, cache: CacheNombresPromocion): Promise<string | null> {
  try {
    return await nombreDePromocion(promo, token, cache);
  } catch {
    return null;
  }
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
  precioElegido: number | undefined,
  // Promo-D/F: solo «todas» y «maximo» relajan el piso; ausente o cualquier
  // otro valor = con piso (el servidor nunca confía en la UI para relajar).
  regla?: string,
  // Promo-F: obligatorio y válido (1–80) con «maximo»; si no, no participa.
  maximoPct?: number
): Promise<ResultadoParticiparDirecto> {
  const esMaximo = regla === "maximo";
  if (esMaximo && !maximoPctValido(maximoPct)) {
    return { ok: false, estado: "fallida", error: "El máximo de descuento no es válido (entre 1 y 80 %).", accionId: null };
  }
  const sinPiso = regla === "todas" || esMaximo;
  const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);

  const [detalle, resultadoPromos] = await Promise.all([leerItemParaPromocionMl(itemId, token), leerPromocionesItemMl(itemId, token)]);
  if (!detalle || resultadoPromos.estado !== "ok") {
    return { ok: false, estado: "fallida", error: "No se pudo confirmar el estado real en Mercado Libre antes de participar — probar de nuevo.", accionId: null };
  }
  const promoReal = resultadoPromos.promociones.find((p) => (promotionIdMl ? p.id === promotionIdMl : p.type === tipoPromocion));
  if (!promoReal) {
    return { ok: false, estado: "fallida", error: "Esta promoción ya no está disponible para esta publicación — volver a cargar la lista.", accionId: null };
  }

  const [reglas, piso] = await Promise.all([
    leerReglasFrescasCuenta(empresaId, cuentaMlId),
    sinPiso ? Promise.resolve({ precioMinimo: null, costo: null }) : leerPisoYCostoFresco(empresaId, detalle.skuCodigo),
  ]);
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
  const [recalculadoMotor] = calcularCandidatosItem(item, reglas, piso.precioMinimo, piso.costo, !sinPiso);
  if (!recalculadoMotor) {
    return { ok: false, estado: "fallida", error: "No se pudo recalcular esta publicación — probar de nuevo.", accionId: null };
  }
  const recalculado = esMaximo ? aplicarTopeMaximo(recalculadoMotor, maximoPct as number) : recalculadoMotor;
  // Con un precio elegido a mano el tope también manda (nunca solo en la UI).
  if (esMaximo && precioElegido !== undefined && recalculado.precioOriginal != null && recalculado.precioOriginal > 0) {
    const pctElegido = ((recalculado.precioOriginal - precioElegido) / recalculado.precioOriginal) * 100;
    if (pctElegido > (maximoPct as number) + 1e-9) {
      return { ok: false, estado: "fallida", error: `El descuento a cargo del vendedor (${pctElegido.toFixed(1)} %) supera el máximo de ${maximoPct} %.`, accionId: null };
    }
  }

  const accionSolicitada: AccionEscribible = recalculado.estadoMl === "candidate" ? "participar" : "modificar";
  const validacion = validarCalculado(recalculado, piso.precioMinimo, reglas, accionSolicitada, precioElegido, !sinPiso);
  if (!validacion.ok) {
    return { ok: false, estado: "fallida", error: validacion.motivo, accionId: null };
  }

  const resultado = await escribirPromocionMl(itemId, token, accionSolicitada, recalculado.promotionIdMl, recalculado.tipoPromocion, validacion.deal);
  // Promo-E: una acción individual es una tanda de 1.
  const nombrePromocion = await nombreSeguro(promoReal, token, new Map());

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
        resultadoMl: conReglaYOrigen(resultado.resultadoMl, esMaximo ? "maximo" : sinPiso ? "todas" : "manual", "individual", {
          lote: nuevoLoteBitacora(),
          maximoPct: esMaximo ? (maximoPct as number) : null,
          limite: esMaximo ? "tope" : sinPiso ? "ninguno" : "piso",
          sku: detalle.skuCodigo,
          nombrePromocion,
        }),
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

export const TOPE_CONCURRENCIA_APLICAR_REGLA = 4;

// Descuento a cargo del vendedor implícito en el precio que el motor
// sugiere — "a cargo del vendedor" porque deal_price es lo único que
// el vendedor de verdad fija; nunca se inventa un desglose en pesos
// del aporte de Mercado Libre (ver nota en el componente de UI).
function descuentoVendedorPct(c: CandidatoCalculado): number | null {
  if (c.precioOriginal == null || c.precioOriginal <= 0 || c.precioSugerido == null) return null;
  return ((c.precioOriginal - c.precioSugerido) / c.precioOriginal) * 100;
}

// Decisión de Mateo: «todas» NO aplica ningún piso (es literalmente
// todas) — usa el modo sin piso del motor (calcularCandidatosItem con
// aplicarPiso=false) y el precio que Mercado Libre sugiere; PUEDE
// vender bajo el costo. «maximo» (Promo-F) tampoco usa el piso: solo el
// tope de % a cargo del vendedor (aplicarTopeMaximo). Únicamente
// «tabla-maestra» usa el piso de Finanzas (costos_sku).
function cumpleRegla(c: CandidatoCalculado): boolean {
  return c.cumpleReglas && !!c.accionSugerida;
}

// Solo se procesan los itemId de `seleccion` (Promo-A, Refs #571): nunca
// se lista el catálogo de ML. Una cuenta que no es de la empresa (o está
// desconectada) no aparece en listarCuentasParaPublicaciones (RLS + filtro)
// y sus publicaciones quedan «omitidas», jamás se tocan.
export async function aplicarReglaALote(empresaId: string, usuarioId: string, seleccion: ItemSeleccionado[], regla: ReglaAplicable): Promise<ResumenAplicarRegla> {
  const cuentasEmpresa = await listarCuentasParaPublicaciones(empresaId, "todas");
  const gruposPorCuenta = agruparPorCuenta(seleccion);
  const cuentas = cuentasEmpresa.filter((c) => gruposPorCuenta.has(c.id));
  const resumen: ResumenAplicarRegla = { revisadas: 0, participadas: 0, fallidas: 0, omitidas: 0, filas: [] };
  for (const [cuentaIdSel, ids] of gruposPorCuenta) {
    if (cuentasEmpresa.some((c) => c.id === cuentaIdSel)) continue;
    for (const itemId of ids) {
      resumen.revisadas += 1;
      resumen.omitidas += 1;
      resumen.filas.push({ itemId, tituloProducto: null, tipoPromocion: "", estado: "omitida", error: "La cuenta de esta publicación no está disponible." });
    }
  }
  const aplicarPiso = regla.tipo === "tabla-maestra";
  // Promo-E: todas las filas de esta ejecución comparten el mismo lote.
  const lote = nuevoLoteBitacora();
  const extraLote = (extra: ExtraBitacora = {}): ExtraBitacora => ({
    lote,
    maximoPct: regla.tipo === "maximo" ? regla.maximoPct : null,
    limite: regla.tipo === "todas" ? "ninguno" : regla.tipo === "maximo" ? "tope" : "piso",
    ...extra,
  });
  // Una publicación omitida también queda en la bitácora (estado «rechazada»,
  // nunca se llamó a Mercado Libre) para que N elegidas = N filas. Si no hay
  // cuenta válida de la empresa (FK) o falla el insert, solo queda en el resumen.
  const registrarOmitida = async (cuentaMlId: string, f: { itemId: string; tituloProducto: string | null; tipoPromocion: string; motivo: string; promotionIdMl?: string | null; precioAntes?: number | null; sku?: string | null }) => {
    try {
      await dbComoEmpresa(empresaId, (tx) =>
        tx.insert(promocionesAcciones).values({
          empresaId,
          cuentaMlId,
          itemId: f.itemId,
          tituloProducto: f.tituloProducto,
          tipoPromocion: f.tipoPromocion,
          promotionIdMl: f.promotionIdMl ?? null,
          accion: "participar",
          precioAntes: f.precioAntes != null ? String(f.precioAntes) : null,
          precioDespues: null,
          estado: "rechazada",
          aprobadoPor: usuarioId,
          aprobadoTs: new Date(),
          ejecutadoPor: usuarioId,
          ejecutadoTs: new Date(),
          modoSimulacion: false,
          resultadoMl: resultadoMlOmitida(regla.tipo, "lote", f.motivo, extraLote({ sku: f.sku ?? null })),
          error: f.motivo.slice(0, 500),
        })
      );
    } catch {
      /* la bitácora nunca frena la regla */
    }
  };
  // Las «reglas adicionales» (texto libre) SOLO aplican a «tabla-maestra»:
  // nunca a «todas» (sin piso, decisión de Mateo), «maximo» ni «salir-todas».
  const usaReglasAdicionales = regla.tipo === "tabla-maestra";

  for (const cuenta of cuentas) {
    let token: string;
    try {
      token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
    } catch {
      for (const itemId of gruposPorCuenta.get(cuenta.id) ?? []) {
        resumen.revisadas += 1;
        resumen.omitidas += 1;
        const motivo = "No se pudo usar la cuenta de Mercado Libre (reconectarla).";
        resumen.filas.push({ itemId, tituloProducto: null, tipoPromocion: "", estado: "omitida", error: motivo });
        await registrarOmitida(cuenta.id, { itemId, tituloProducto: null, tipoPromocion: "", motivo });
      }
      continue;
    }
    const reglasCuenta = await leerReglasFrescasCuenta(empresaId, cuenta.id);
    const reglasAdicionales = usaReglasAdicionales ? (await leerReglasAdicionalesCuentas(empresaId, [cuenta.id])).get(cuenta.id) ?? null : null;
    const cacheNombres: CacheNombresPromocion = new Map();

    const idsCuenta = gruposPorCuenta.get(cuenta.id) ?? [];
    for (let desde = 0; desde < idsCuenta.length; desde += TAMANO_LOTE_ML) {
      const pagina = { ids: idsCuenta.slice(desde, desde + TAMANO_LOTE_ML) };

      const candidatosPorItem = await conConcurrenciaLimitada(pagina.ids, TOPE_CONCURRENCIA_APLICAR_REGLA, async (itemId) => {
        const [detalle, resultadoPromos] = await Promise.all([
          conReintento429Lectura(() => leerItemParaPromocionMl(itemId, token)),
          conReintento429Lectura(() => leerPromocionesItemMl(itemId, token)),
        ]);
        // Una publicación elegida a mano nunca desaparece en silencio: si no se
        // pudo leer o no tiene promociones, queda en el resumen con el motivo.
        if (!detalle || resultadoPromos.estado !== "ok" || resultadoPromos.promociones.length === 0) {
          resumen.revisadas += 1;
          resumen.omitidas += 1;
          const motivo = !detalle || resultadoPromos.estado !== "ok" ? "No se pudo leer la publicación en Mercado Libre." : "No tiene promociones disponibles.";
          resumen.filas.push({ itemId, tituloProducto: detalle?.title ?? null, tipoPromocion: "", estado: "omitida", error: motivo });
          await registrarOmitida(cuenta.id, { itemId, tituloProducto: detalle?.title ?? null, tipoPromocion: "", motivo, sku: detalle?.skuCodigo ?? null });
          return [];
        }
        // «todas»: no se lee ni se exige el piso (costos_sku).
        const { precioMinimo, costo } = aplicarPiso ? await leerPisoYCostoFresco(empresaId, detalle.skuCodigo) : { precioMinimo: null, costo: null };
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
        const calculadosMotor = calcularCandidatosItem(item, reglasCuenta, precioMinimo, costo, aplicarPiso);
        const calculados = regla.tipo === "maximo" ? calculadosMotor.map((c) => aplicarTopeMaximo(c, regla.maximoPct)) : calculadosMotor;
        const resultado: { c: CandidatoCalculado; precioMinimo: number | null; evaluacion: EvaluacionReglasAdicionales | null; promo: (typeof resultadoPromos.promociones)[number] }[] = [];
        for (let i = 0; i < calculados.length; i++) {
          const c = calculados[i];
          const evaluacion = reglasAdicionales && c.cumpleReglas && c.accionSugerida ? await evaluarCandidatoConReglas(c, resultadoPromos.promociones[i], reglasAdicionales, token, cacheNombres) : null;
          resultado.push({ c, precioMinimo, evaluacion, promo: resultadoPromos.promociones[i] });
        }
        return resultado;
      });

      const porAplicar: typeof candidatosPorItem[number] = [];
      for (const entrada of candidatosPorItem.flat()) {
        const { c, evaluacion } = entrada;
        resumen.revisadas += 1;
        const omitir = async (motivo: string) => {
          resumen.omitidas += 1;
          resumen.filas.push({ itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, estado: "omitida", error: motivo });
          await registrarOmitida(cuenta.id, { itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, motivo, promotionIdMl: c.promotionIdMl, precioAntes: c.precioActual, sku: c.skuCodigo });
        };
        if (evaluacion?.excluida) {
          await omitir(evaluacion.motivoVisible ?? "Excluida por una regla adicional.");
          continue;
        }
        // Sin piso, una candidata que el motor frena (ej. ML no dio
        // precio sugerido, o es compartida sin habilitar) queda visible
        // en el resumen con su motivo, nunca omitida en silencio.
        if (!aplicarPiso && c.estadoMl === "candidate" && !c.tieneVariantes && !c.soloEnMl && !c.cumpleReglas && c.motivoRevisarManual) {
          await omitir(c.motivoRevisarManual);
          continue;
        }
        if (cumpleRegla(c)) {
          porAplicar.push(entrada);
          continue;
        }
        // Promo-E: lo que la regla descarta también queda en la bitácora (100 = 100),
        // sin tocar el resumen que ya ve la persona (omitir() sí lo suma).
        const motivoRegla = c.motivoRevisarManual ?? "No cumple las reglas para participar automáticamente.";
        await registrarOmitida(cuenta.id, { itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, motivo: motivoRegla, promotionIdMl: c.promotionIdMl, precioAntes: c.precioActual, sku: c.skuCodigo });
      }

      await conConcurrenciaLimitada(porAplicar, TOPE_CONCURRENCIA_APLICAR_REGLA, async ({ c: cMotor, precioMinimo, evaluacion, promo }) => {
        // Una regla adicional solo puede SUBIR el precio (menos descuento):
        // el precio final ya es max(regla, piso) — ver promocionesReglasAplicar.ts
        // — y validarCalculado vuelve a exigir deal >= piso antes de escribir.
        const precioConRegla = evaluacion?.precioFinal ?? null;
        const c: CandidatoCalculado = precioConRegla != null && precioConRegla !== cMotor.precioSugerido ? { ...cMotor, precioSugerido: precioConRegla } : cMotor;
        if (c !== cMotor) {
          const fueraDeRango = descuentoFueraDeRangoPriceDiscount(c.tipoPromocion, c.precioOriginal, precioConRegla as number);
          if (fueraDeRango) {
            const motivo = `${evaluacion?.motivoVisible ?? "Regla adicional"} — ${fueraDeRango}`;
            resumen.omitidas += 1;
            resumen.filas.push({ itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, estado: "omitida", error: motivo });
            await registrarOmitida(cuenta.id, { itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, motivo, promotionIdMl: c.promotionIdMl, precioAntes: c.precioActual, sku: c.skuCodigo });
            return;
          }
          // Ya participa a un precio igual o más alto que el que dejaría la regla: nada que modificar.
          if (cMotor.accionSugerida === "modificar" && c.precioActual != null && (precioConRegla as number) >= c.precioActual) return;
        }
        const accionSolicitada: AccionEscribible = c.accionSugerida === "modificar" ? "modificar" : "participar";
        const validacion = validarCalculado(c, precioMinimo, reglasCuenta, accionSolicitada, undefined, aplicarPiso);
        if (!validacion.ok) {
          resumen.omitidas += 1;
          resumen.filas.push({ itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, estado: "omitida", error: validacion.motivo });
          await registrarOmitida(cuenta.id, { itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, motivo: validacion.motivo, promotionIdMl: c.promotionIdMl, precioAntes: c.precioActual, sku: c.skuCodigo });
          return;
        }
        const resultado = await escribirPromocionMl(c.itemId, token, accionSolicitada, c.promotionIdMl, c.tipoPromocion, validacion.deal);
        // Sin reglas adicionales no se consulta ML por el nombre: solo el que ya vino en la promoción.
        const nombrePromocion = usaReglasAdicionales ? await nombreSeguro(promo, token, cacheNombres) : typeof promo.name === "string" ? promo.name : null;
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
            resultadoMl: conReglaYOrigen(resultado.resultadoMl, regla.tipo, "lote", extraLote({ sku: c.skuCodigo, nombrePromocion })),
            error: resultado.error,
          })
        );
        if (resultado.estado === "ejecutada") resumen.participadas += 1;
        else resumen.fallidas += 1;
        resumen.filas.push({ itemId: c.itemId, tituloProducto: c.tituloProducto, tipoPromocion: c.tipoPromocion, estado: resultado.estado, error: resultado.error });
      });

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
