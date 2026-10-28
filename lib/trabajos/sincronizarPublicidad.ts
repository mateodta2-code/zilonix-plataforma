// Issue #254 — sincronización de Product Ads. Solo lectura contra
// Mercado Libre. Una cuenta sin Product Ads o una app sin el permiso
// no corta a las demás. Los tokens no se escriben en el log ni en
// publicidad_sincronizaciones.error.
//
// El cron enumera cuentas con publicidad_trabajador_user (id, empresa,
// alta y última corrida — nunca el token). Apenas se sabe la empresa,
// el resto va por dbComoEmpresa. El orden es la última sincronización
// más vieja, no la fecha de alta: si no, las primeras cinco cuentas
// se comen la única corrida del día y el resto nunca corre.
//
// El presupuesto es de la corrida entera (240 s), alineado con el
// curl de 300 s del workflow. Lo que no entra queda en `pendientes`
// para la tanda siguiente.

import { and, eq, isNull, max } from "drizzle-orm";
import { dbTrabajadorPublicidad } from "@/db/trabajador-publicidad-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, publicidadSincronizaciones } from "@/db/schema";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";
import { costosDeItem } from "@/lib/ml/costos-item";
import { msDeReintento429 } from "@/lib/ml/reintento-429";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import {
  adGroupsDeCampana,
  anunciosDeAdGroup,
  idNumerico,
  itemIdDe,
  listarCampanas,
  metricasAdGroupsDelDia,
  metricasDiariasCampana,
  metricasDiariasCuenta,
  obtenerAnunciante,
  SUGERENCIA_RECONECTAR_PUBLICIDAD,
  type CampanaAds,
} from "@/lib/ml/publicidad";
import {
  SyncEnCursoError,
  SyncMuyRecienteError,
  abrirSincronizacion,
  cerrarSincronizacion,
  costoYaConsultado,
  guardarAnunciante,
  guardarAnuncios,
  guardarCampanas,
  guardarCostoItem,
  guardarMetricas,
  historialSync,
  itemsSincronizadosDesde,
  type AnuncioGuardado,
  type CampanaGuardada,
  type MetricaGuardada,
} from "@/lib/publicidad/guardar";
import {
  AVISO_FUERA_DE_RANGO,
  acosDesdeRoas,
  filasDiariasDeCampana,
  filasDiariasDeCuenta,
  metricasDesdeApi,
  type MetricasLeidas,
} from "@/lib/publicidad/metricas";
import { aEscala, cabeEnNumeric, textoDeNumeroJson } from "@/lib/numeros/normalizar-decimal";
import {
  MINUTOS_EN_CURSO_ABANDONADO,
  PRESUPUESTO_CORRIDA_MS,
  alcanzaParaAbrirCuenta,
  decisionAnteErrorDeCosto,
  decidirTramo,
  diasARetomar,
  evaluarRefrescoManual,
  faseDeCorte,
  hoyBogota,
  marcaDeFase,
  ordenarCuentasParaSync,
  textoErrorCorto,
  type FaseCorte,
  type UltimaSync,
} from "@/lib/publicidad/plan";

const AVISO_DAILY =
  "aggregation_type=DAILY en campaigns/search repitió una fecha sin id de campaña. No se guardó el total de cuenta: la forma no está confirmada contra una cuenta real.";
const AVISO_COSTO =
  "Un costo de ítem no se pudo leer (respuesta 4xx de Mercado Libre). El resto de la cuenta siguió; ese ítem se reintenta en la próxima corrida.";

class CorridaIncompletaError extends Error {
  readonly fase: FaseCorte;
  constructor(fase: FaseCorte) {
    super(`${marcaDeFase(fase)}. La corrida se cortó antes de terminar el tramo para poder retomarla.`);
    this.name = "CorridaIncompletaError";
    this.fase = fase;
  }
}

export type ResultadoLote = {
  revisadas: number;
  procesadas: number;
  saltadas: number;
  fallidas: number;
  pendientes: number;
};
export type ResultadoManual = { ok: boolean; aviso: string };

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function vigilar(deadline: number, fase: FaseCorte): void {
  if (Date.now() > deadline) throw new CorridaIncompletaError(fase);
}

async function llamar<T>(contador: { n: number }, deadline: number, fase: FaseCorte, fn: () => Promise<T>): Promise<T> {
  let espera = 2_000;
  for (let intento = 0; intento < 4; intento++) {
    contador.n += 1;
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof LimiteMercadoLibreError) || intento === 3) throw error;
      const pausa = msDeReintento429(espera + Math.floor(Math.random() * 400), error.retryAfterMs);
      if (Date.now() + pausa > deadline) throw new CorridaIncompletaError(fase);
      await esperar(pausa);
      espera *= 2;
    }
  }
  throw new LimiteMercadoLibreError();
}

function decimalONull(valor: unknown, escala: number, precision = 14, alDesbordar?: () => void): string | null {
  if (valor == null) return null;
  try {
    const texto =
      typeof valor === "number"
        ? aEscala(textoDeNumeroJson(valor), escala, { origenJson: true })
        : typeof valor === "string" && valor.trim()
          ? aEscala(valor.trim(), escala)
          : null;
    if (!texto) return null;
    if (!cabeEnNumeric(texto, precision, escala)) {
      alDesbordar?.();
      return null;
    }
    return texto;
  } catch {
    return null;
  }
}

function fechaMl(valor: unknown): Date | null {
  if (typeof valor !== "string") return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function campanaDesde(cuentaMlId: string, raw: CampanaAds, alDesbordar?: () => void): CampanaGuardada | null {
  const campanaIdMl = idNumerico(raw.id);
  if (!campanaIdMl) return null;
  const roas = decimalONull(raw.roas_target, 2, 6, alDesbordar);
  let acos = decimalONull(raw.acos_target, 4, 10, alDesbordar);
  let calculado = false;
  if (!acos && roas) {
    const derivado = acosDesdeRoas(roas);
    if (derivado && cabeEnNumeric(derivado, 10, 4)) {
      acos = derivado;
      calculado = true;
    } else if (derivado) alDesbordar?.();
  }
  return {
    cuentaMlId,
    campanaIdMl,
    nombre: typeof raw.name === "string" ? raw.name : null,
    estado: typeof raw.status === "string" ? raw.status : null,
    estrategia: typeof raw.strategy === "string" ? raw.strategy : null,
    presupuesto: decimalONull(raw.budget, 2, 14, alDesbordar),
    presupuestoDiario: decimalONull(raw.daily_budget, 2, 14, alDesbordar),
    presupuestoAutomatico: typeof raw.automatic_budget === "boolean" ? raw.automatic_budget : null,
    roasObjetivo: roas,
    acosObjetivo: acos,
    acosObjetivoCalculado: calculado,
    moneda: typeof raw.currency_id === "string" ? raw.currency_id : null,
    creadaMlTs: fechaMl(raw.date_created),
    actualizadaMlTs: fechaMl(raw.last_updated),
  };
}

function resultsDe(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const rec = data as { results?: unknown; date?: unknown };
  if (!Array.isArray(rec.results)) {
    return typeof rec.date === "string" ? [data] : [];
  }
  if (typeof rec.date !== "string") return rec.results;
  return rec.results.map((fila) => {
    if (fila && typeof fila === "object" && !("date" in (fila as object))) return { ...(fila as object), date: rec.date };
    return fila;
  });
}

function aMs(valor: Date | string | null): number | null {
  if (valor == null) return null;
  const ms = valor instanceof Date ? valor.getTime() : Date.parse(String(valor));
  return Number.isNaN(ms) ? null : ms;
}

function metricaDe(
  cuentaMlId: string,
  nivel: MetricaGuardada["nivel"],
  entidadIdMl: string,
  fecha: string,
  leidas: MetricasLeidas,
  adGroupId = ""
): MetricaGuardada {
  return {
    cuentaMlId,
    nivel,
    entidadIdMl,
    fecha,
    adGroupId,
    metricas: leidas.metricas,
    invalidos: leidas.invalidos,
  };
}

export async function sincronizarCuenta(
  empresaId: string,
  cuentaMlId: string,
  origen: "programada" | "manual",
  solicitadaPor: string | null,
  ahora: Date,
  deadline: number
): Promise<string> {
  const hoy = hoyBogota(ahora);
  const historial = await historialSync(empresaId, cuentaMlId);
  const ultima: UltimaSync | null = historial.ultima
    ? {
        estado: historial.ultima.estado,
        rangoDesde: historial.ultima.rangoDesde,
        rangoHasta: historial.ultima.rangoHasta,
        iniciadaTs: historial.ultima.iniciadaTs,
      }
    : null;
  const tramo = decidirTramo(hoy, ultima, historial.yaTerminoBackfill, historial.reintentosMismoTramo);
  const mismoTramoError = Boolean(
    ultima && ultima.estado === "error" && ultima.rangoDesde === tramo.desde && ultima.rangoHasta === tramo.hasta
  );
  const reanudaInicial = mismoTramoError ? historial.ultima?.reanudaDesde ?? null : null;
  const faseInicial = mismoTramoError ? faseDeCorte(historial.ultima?.error ?? null) : null;
  const contador = { n: 0 };
  const avisos: string[] = [];
  const syncId = await abrirSincronizacion(empresaId, {
    cuentaMlId,
    origen,
    solicitadaPor,
    rangoDesde: tramo.desde,
    rangoHasta: tramo.hasta,
  });

  const metricas: MetricaGuardada[] = [];
  const anuncios: AnuncioGuardado[] = [];
  // Antes del bucle de días la fase queda en pre-dias: ese corte no
  // gasta intento. En el bucle, el cursor es el día. En costos, el
  // cursor es el último día del tramo y la fase dice que no hay que
  // rehacerlos.
  let reanuda: string | null = reanudaInicial;
  let faseActual: FaseCorte = "pre-dias";
  let cerrado = false;
  let errorCierre: unknown = null;
  function anotarDesborde(): void {
    if (!avisos.includes(AVISO_FUERA_DE_RANGO)) avisos.push(AVISO_FUERA_DE_RANGO);
  }

  async function volcar(): Promise<void> {
    if (metricas.length > 0) {
      const lote = metricas.splice(0, metricas.length);
      await guardarMetricas(empresaId, lote);
    }
    if (anuncios.length > 0) {
      const lote = anuncios.splice(0, anuncios.length);
      await guardarAnuncios(empresaId, lote);
    }
  }

  try {
    const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({ cuentaIdExterna: cuentasMl.cuentaIdExterna })
        .from(cuentasMl)
        .where(eq(cuentasMl.id, cuentaMlId))
    );
    if (!cuenta) throw new Error("No se encontró la cuenta.");

    const anunciante = await llamar(contador, deadline, faseActual, () => obtenerAnunciante(token));
    if (anunciante.estado !== "ok") {
      await guardarAnunciante(empresaId, {
        cuentaMlId,
        advertiserId: null,
        siteId: null,
        nombre: null,
        estadoAcceso: anunciante.estado,
      });
      const aviso = anunciante.estado === "sin_permiso_app" ? anunciante.sugerencia : null;
      if (anunciante.estado === "sin_permiso_app") {
        console.warn(`[publicidad] cuenta ${cuentaMlId} sin_permiso_app. ${SUGERENCIA_RECONECTAR_PUBLICIDAD}`);
      }
      // ok de clasificación, no de backfill: cierraBackfill queda en
      // false para que mañana se vuelva a preguntar si ya tiene ads.
      await cerrarSincronizacion(empresaId, syncId, {
        estado: "ok",
        llamadas: contador.n,
        error: aviso,
        cierraBackfill: false,
      });
      cerrado = true;
      return anunciante.estado === "sin_permiso_app"
        ? SUGERENCIA_RECONECTAR_PUBLICIDAD
        : "Esta cuenta no tiene Product Ads activo en Mercado Libre.";
    }

    await guardarAnunciante(empresaId, {
      cuentaMlId,
      advertiserId: anunciante.advertiserId,
      siteId: anunciante.siteId,
      nombre: anunciante.nombre,
      estadoAcceso: "ok",
    });
    const ctx = { token, siteId: anunciante.siteId, advertiserId: anunciante.advertiserId };
    const seguir = () => vigilar(deadline, faseActual);
    let items = new Set<string>();
    const itemsDeCostos =
      faseInicial === "costos" && historial.ultima?.iniciadaTs
        ? await itemsSincronizadosDesde(empresaId, cuentaMlId, historial.ultima.iniciadaTs)
        : [];

    if (itemsDeCostos.length > 0) {
      faseActual = "costos";
      reanuda = tramo.hasta;
      items = new Set(itemsDeCostos);
    } else {
    const crudas = [
      ...(await llamar(contador, deadline, faseActual, () => listarCampanas(ctx, { estado: "active", seguir }))),
      ...(await llamar(contador, deadline, faseActual, () => listarCampanas(ctx, { estado: "paused", seguir }))),
    ];
    const campanas = crudas.map((raw) => campanaDesde(cuentaMlId, raw, anotarDesborde)).filter((c): c is CampanaGuardada => c !== null);
    const porId = new Map(campanas.map((c) => [c.campanaIdMl, c]));
    await guardarCampanas(empresaId, [...porId.values()]);

    for (const campana of porId.values()) {
      vigilar(deadline, faseActual);
      const data = await llamar(contador, deadline, faseActual, () => metricasDiariasCampana(ctx, campana.campanaIdMl, tramo));
      for (const fila of filasDiariasDeCampana(resultsDe(data), campana.campanaIdMl)) {
        if (!fila.entidadIdMl) continue;
        if (fila.desbordados.length > 0) anotarDesborde();
        metricas.push(metricaDe(cuentaMlId, "campana", fila.entidadIdMl, fila.fecha, fila));
      }
      await volcar();
    }
    vigilar(deadline, faseActual);
    const diariasCuenta = await llamar(contador, deadline, faseActual, () =>
      metricasDiariasCuenta(ctx, { desde: tramo.desde, hasta: tramo.hasta, seguir })
    );
    const interpretadas = filasDiariasDeCuenta(diariasCuenta);
    if (interpretadas.ambiguo) avisos.push(AVISO_DAILY);
    for (const fila of interpretadas.filas) {
      if (fila.desbordados.length > 0) anotarDesborde();
      const entidad = fila.entidadIdMl ?? anunciante.advertiserId;
      const nivel = fila.entidadIdMl ? "campana" : "cuenta";
      metricas.push(metricaDe(cuentaMlId, nivel, entidad, fila.fecha, fila));
    }
    await volcar();

    const grupos = [
      ...(await llamar(contador, deadline, faseActual, () =>
        adGroupsDeCampana(ctx, { campanas: [...porId.keys()], desde: tramo.desde, hasta: tramo.hasta, estado: "active", seguir })
      )),
      ...(await llamar(contador, deadline, faseActual, () =>
        adGroupsDeCampana(ctx, { campanas: [...porId.keys()], desde: tramo.desde, hasta: tramo.hasta, estado: "paused", seguir })
      )),
    ];
    const tipoPorGrupo = new Map<string, { tipo: string | null; externo: string | null; campana: string | null }>();
    for (const raw of grupos) {
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as Record<string, unknown>;
      const id = idNumerico(rec.id);
      if (!id) continue;
      tipoPorGrupo.set(id, {
        tipo: typeof rec.ad_group_type === "string" ? rec.ad_group_type : null,
        externo: typeof rec.ad_group_external_id === "string" ? rec.ad_group_external_id : null,
        campana: idNumerico(rec.campaign_id),
      });
    }

    // Mismo orden que ordenDeTrabajo: el día va por fuera. Si el corte
    // cae en la campaña 2 del día 3, los días 1 y 2 ya se pidieron para
    // todas las campañas, los ad groups y los anuncios. Retomar ese día
    // los rehace (el upsert es idempotente) y no se salta los anteriores.
    faseActual = "dias";
    const dias = diasARetomar(tramo.desde, tramo.hasta, reanudaInicial);
    for (const dia of dias) {
      reanuda = dia;
      for (const campana of porId.values()) {
        vigilar(deadline, faseActual);
        const data = await llamar(contador, deadline, faseActual, () => metricasAdGroupsDelDia(ctx, campana.campanaIdMl, dia));
        for (const raw of resultsDe(data)) {
          if (!raw || typeof raw !== "object") continue;
          const rec = raw as Record<string, unknown>;
          const entidad = idNumerico(rec.ad_group_id);
          if (!entidad) continue;
          const fecha = typeof rec.date === "string" ? rec.date : dia;
          const leidas = metricasDesdeApi(rec);
          if (leidas.desbordados.length > 0) anotarDesborde();
          metricas.push(metricaDe(cuentaMlId, "ad_group", entidad, fecha, leidas));
        }
        await volcar();
      }
      for (const [adGroupId, meta] of tipoPorGrupo) {
        vigilar(deadline, faseActual);
        const filas = await llamar(contador, deadline, faseActual, () => anunciosDeAdGroup(ctx, adGroupId, { desde: dia, hasta: dia, seguir }));
        for (const raw of filas) {
          if (!raw || typeof raw !== "object") continue;
          const rec = raw as Record<string, unknown>;
          const itemId = itemIdDe(rec.item_id);
          if (!itemId) continue;
          items.add(itemId);
          anuncios.push({
            cuentaMlId,
            adGroupId,
            tipoAdGroup: meta.tipo,
            adGroupExternoId: meta.externo,
            campanaIdMl: idNumerico(rec.campaign_id) ?? meta.campana,
            itemId,
            titulo: typeof rec.title === "string" ? rec.title : null,
            permalink: typeof rec.permalink === "string" ? rec.permalink : null,
            estado: typeof rec.status === "string" ? rec.status : null,
            precio: decimalONull(rec.price, 2, 14, anotarDesborde),
            logisticType: typeof rec.logistic_type === "string" ? rec.logistic_type : null,
            listingTypeId: typeof rec.listing_type_id === "string" ? rec.listing_type_id : null,
          });
          const leidas = metricasDesdeApi(rec);
          if (leidas.desbordados.length > 0) anotarDesborde();
          metricas.push(metricaDe(cuentaMlId, "anuncio", itemId, dia, leidas, adGroupId));
        }
        await volcar();
      }
    }
    faseActual = "costos";
    reanuda = tramo.hasta;
    }

    for (const itemId of items) {
      vigilar(deadline, faseActual);
      if (await costoYaConsultado(empresaId, cuentaMlId, itemId, hoy)) continue;
      try {
        const costo = await llamar(contador, deadline, faseActual, () =>
          costosDeItem({ token, userId: cuenta.cuentaIdExterna, itemId, siteId: anunciante.siteId })
        );
        await guardarCostoItem(empresaId, {
          cuentaMlId,
          itemId,
          fecha: hoy,
          skuCodigo: costo.skuCodigo,
          categoryId: costo.categoryId,
          precioVentaVigente: costo.precioVentaVigente,
          precioRegular: costo.precioRegular,
          comisionMl: costo.comisionMl,
          comisionDetalle: costo.comisionDetalle,
          envioVendedorEstimado: costo.envioVendedorEstimado,
          compradorPagaEnvio: costo.compradorPagaEnvio,
          logisticType: costo.logisticType,
          shippingMode: costo.shippingMode,
          listingTypeId: costo.listingTypeId,
        });
      } catch (error) {
        const decision = decisionAnteErrorDeCosto(error);
        if (decision === "cerrar-tramo") throw error;
        if (decision === "seguir") {
          if (!avisos.includes(AVISO_COSTO)) avisos.push(AVISO_COSTO);
          continue;
        }
        throw error;
      }
    }

    const estado = tramo.cierraBackfill ? "ok" : "parcial";
    await cerrarSincronizacion(empresaId, syncId, {
      estado,
      llamadas: contador.n,
      error: avisos.length > 0 ? avisos.join(" ") : null,
      cierraBackfill: estado === "ok" && tramo.cierraBackfill,
    });
    cerrado = true;
    return estado === "ok" ? "Publicidad actualizada." : "Se guardó un tramo del historial. La próxima corrida sigue con los días anteriores.";
  } catch (error) {
    errorCierre = error;
    console.error(`[publicidad] cuenta ${cuentaMlId} no se pudo sincronizar:`, textoErrorCorto(error));
  } finally {
    // Si volcar vuelve a fallar, igual se cierra: si no, la fila queda
    // en_curso 30 minutos y la cuenta no se retoma. Un return acá se
    // comería el resultado del try, así que el cierre no retorna.
    if (!cerrado) {
      try {
        await volcar();
      } catch (errorVolcar) {
        console.error(`[publicidad] cuenta ${cuentaMlId} no pudo guardar el avance:`, textoErrorCorto(errorVolcar));
      }
      try {
        await cerrarSincronizacion(empresaId, syncId, {
          estado: "error",
          llamadas: contador.n,
          error: textoErrorCorto(errorCierre),
          cierraBackfill: false,
          reanudaDesde: errorCierre instanceof CorridaIncompletaError ? reanuda : null,
        });
      } catch (errorCerrar) {
        console.error(`[publicidad] cuenta ${cuentaMlId} no pudo cerrar la sincronización:`, textoErrorCorto(errorCerrar));
      }
    }
  }
  if (errorCierre instanceof CorridaIncompletaError) return "La actualización quedó a medias y se retoma en la próxima corrida.";
  throw errorCierre;
}

function debeSaltar(ultima: UltimaSync | null, ahora: Date): boolean {
  if (!ultima) return false;
  const edad = ahora.getTime() - ultima.iniciadaTs.getTime();
  if (ultima.estado === "en_curso" && edad < MINUTOS_EN_CURSO_ABANDONADO * 60_000) return true;
  if (ultima.estado === "ok" && hoyBogota(ultima.iniciadaTs) === hoyBogota(ahora)) return true;
  return false;
}

export async function sincronizarPublicidadProgramada(ahora = new Date()): Promise<ResultadoLote> {
  const ultimas = dbTrabajadorPublicidad
    .select({
      cuentaMlId: publicidadSincronizaciones.cuentaMlId,
      ultimaSyncTs: max(publicidadSincronizaciones.iniciadaTs).as("ultima_sync_ts"),
    })
    .from(publicidadSincronizaciones)
    .groupBy(publicidadSincronizaciones.cuentaMlId)
    .as("ultimas_sync");

  const cuentas = await dbTrabajadorPublicidad
    .select({
      id: cuentasMl.id,
      empresaId: cuentasMl.empresaId,
      creadoTs: cuentasMl.creadoTs,
      ultimaSyncTs: ultimas.ultimaSyncTs,
    })
    .from(cuentasMl)
    .leftJoin(ultimas, eq(ultimas.cuentaMlId, cuentasMl.id))
    .where(isNull(cuentasMl.desconectadaTs));

  const ordenadas = ordenarCuentasParaSync(
    cuentas.map((cuenta) => ({
      ...cuenta,
      creadoTs: aMs(cuenta.creadoTs) ?? 0,
      ultimaSyncTs: aMs(cuenta.ultimaSyncTs),
    }))
  );

  const resultado: ResultadoLote = {
    revisadas: ordenadas.length,
    procesadas: 0,
    saltadas: 0,
    fallidas: 0,
    pendientes: 0,
  };
  const deadline = Date.now() + PRESUPUESTO_CORRIDA_MS;
  for (let i = 0; i < ordenadas.length; i++) {
    if (!alcanzaParaAbrirCuenta(deadline - Date.now())) {
      resultado.pendientes = ordenadas.length - i;
      break;
    }
    const cuenta = ordenadas[i];
    const historial = await historialSync(cuenta.empresaId, cuenta.id);
    const ultima: UltimaSync | null = historial.ultima
      ? {
          estado: historial.ultima.estado,
          rangoDesde: historial.ultima.rangoDesde,
          rangoHasta: historial.ultima.rangoHasta,
          iniciadaTs: historial.ultima.iniciadaTs,
        }
      : null;
    if (debeSaltar(ultima, ahora)) {
      resultado.saltadas += 1;
      continue;
    }
    try {
      await sincronizarCuenta(cuenta.empresaId, cuenta.id, "programada", null, ahora, deadline);
      resultado.procesadas += 1;
    } catch (error) {
      if (error instanceof SyncEnCursoError || error instanceof SyncMuyRecienteError) {
        resultado.saltadas += 1;
        continue;
      }
      resultado.fallidas += 1;
      console.error(`[publicidad] lote, cuenta ${cuenta.id}:`, textoErrorCorto(error));
    }
  }
  return resultado;
}

export async function refrescarPublicidadManual(
  empresaId: string,
  cuentaMlId: string,
  usuarioId: string,
  ahora = new Date()
): Promise<ResultadoManual> {
  const propia = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: cuentasMl.id })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, cuentaMlId), eq(cuentasMl.empresaId, empresaId), isNull(cuentasMl.desconectadaTs)))
  );
  if (propia.length === 0) return { ok: false, aviso: "Esa cuenta no está conectada en esta empresa." };

  const historial = await historialSync(empresaId, cuentaMlId);
  const ultima: UltimaSync | null = historial.ultima
    ? {
        estado: historial.ultima.estado,
        rangoDesde: historial.ultima.rangoDesde,
        rangoHasta: historial.ultima.rangoHasta,
        iniciadaTs: historial.ultima.iniciadaTs,
      }
    : null;
  const decision = evaluarRefrescoManual(ahora, ultima);
  if (!decision.permitir) return { ok: false, aviso: decision.aviso };

  try {
    const aviso = await sincronizarCuenta(empresaId, cuentaMlId, "manual", usuarioId, ahora, Date.now() + PRESUPUESTO_CORRIDA_MS);
    return { ok: true, aviso };
  } catch (error) {
    if (error instanceof SyncEnCursoError || error instanceof SyncMuyRecienteError) return { ok: false, aviso: error.message };
    return { ok: false, aviso: textoErrorCorto(error) };
  }
}
