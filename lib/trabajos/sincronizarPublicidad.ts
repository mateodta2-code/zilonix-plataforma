// Issue #254 — sincronización de Product Ads. Solo lectura contra
// Mercado Libre. Una cuenta sin Product Ads o una app sin el permiso
// no corta a las demás. Los tokens no se escriben en el log ni en
// publicidad_sincronizaciones.error.
//
// El cron enumera cuentas con publicidad_trabajador_user. Apenas se
// sabe la empresa, el resto va por dbComoEmpresa, igual que la
// revisión diaria de seguimientos.

import { and, asc, eq, isNull } from "drizzle-orm";
import { dbTrabajadorPublicidad } from "@/db/trabajador-publicidad-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";
import { costosDeItem } from "@/lib/ml/costos-item";
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
  cerrarSincronizacion,
  costoYaConsultado,
  guardarAnunciante,
  guardarAnuncios,
  guardarCampanas,
  guardarCostoItem,
  guardarMetricas,
  historialSync,
  abrirSincronizacion,
  type AnuncioGuardado,
  type CampanaGuardada,
  type MetricaGuardada,
} from "@/lib/publicidad/guardar";
import { acosDesdeRoas, filasDiariasDeCampana, filasDiariasDeCuenta, metricasDesdeApi } from "@/lib/publicidad/metricas";
import { aEscala, textoDeNumeroJson } from "@/lib/numeros/normalizar-decimal";
import {
  decidirTramo,
  diasDelRango,
  evaluarRefrescoManual,
  hoyBogota,
  MINUTOS_EN_CURSO_ABANDONADO,
  textoErrorCorto,
  type UltimaSync,
} from "@/lib/publicidad/plan";

const PRESUPUESTO_MS = 200_000;
const LOTE_CUENTAS = 5;
const AVISO_DAILY =
  "aggregation_type=DAILY en campaigns/search repitió una fecha sin id de campaña. No se guardó el total de cuenta: la forma no está confirmada contra una cuenta real.";

class CorridaIncompletaError extends Error {
  constructor() {
    super("La corrida se cortó antes de terminar el tramo para poder retomarla.");
    this.name = "CorridaIncompletaError";
  }
}

export type ResultadoLote = { revisadas: number; procesadas: number; saltadas: number; fallidas: number };
export type ResultadoManual = { ok: boolean; aviso: string };

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function llamar<T>(contador: { n: number }, fn: () => Promise<T>): Promise<T> {
  let espera = 2_000;
  for (let intento = 0; intento < 4; intento++) {
    contador.n += 1;
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof LimiteMercadoLibreError) || intento === 3) throw error;
      await esperar(espera + Math.floor(Math.random() * 400));
      espera *= 2;
    }
  }
  throw new LimiteMercadoLibreError();
}

function decimalONull(valor: unknown, escala: number): string | null {
  if (valor == null) return null;
  try {
    if (typeof valor === "number") return aEscala(textoDeNumeroJson(valor), escala, { origenJson: true });
    if (typeof valor !== "string" || !valor.trim()) return null;
    return aEscala(valor.trim(), escala);
  } catch {
    return null;
  }
}

function fechaMl(valor: unknown): Date | null {
  if (typeof valor !== "string") return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function campanaDesde(cuentaMlId: string, raw: CampanaAds): CampanaGuardada | null {
  const campanaIdMl = idNumerico(raw.id);
  if (!campanaIdMl) return null;
  const roas = decimalONull(raw.roas_target, 2);
  let acos = decimalONull(raw.acos_target, 4);
  let calculado = false;
  if (!acos && roas) {
    const derivado = acosDesdeRoas(roas);
    if (derivado) {
      acos = derivado;
      calculado = true;
    }
  }
  return {
    cuentaMlId,
    campanaIdMl,
    nombre: typeof raw.name === "string" ? raw.name : null,
    estado: typeof raw.status === "string" ? raw.status : null,
    estrategia: typeof raw.strategy === "string" ? raw.strategy : null,
    presupuesto: decimalONull(raw.budget, 2),
    presupuestoDiario: decimalONull(raw.daily_budget, 2),
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

function vigilar(inicio: number): void {
  if (Date.now() - inicio > PRESUPUESTO_MS) throw new CorridaIncompletaError();
}

async function sincronizarCuenta(
  empresaId: string,
  cuentaMlId: string,
  origen: "programada" | "manual",
  solicitadaPor: string | null,
  ahora: Date
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
  const tramo = decidirTramo(hoy, ultima, historial.yaTerminoBackfill);
  const contador = { n: 0 };
  const avisos: string[] = [];
  const inicio = Date.now();
  const syncId = await abrirSincronizacion(empresaId, {
    cuentaMlId,
    origen,
    solicitadaPor,
    rangoDesde: tramo.desde,
    rangoHasta: tramo.hasta,
  });

  try {
    const token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({ cuentaIdExterna: cuentasMl.cuentaIdExterna })
        .from(cuentasMl)
        .where(eq(cuentasMl.id, cuentaMlId))
    );
    if (!cuenta) throw new Error("No se encontró la cuenta.");

    const anunciante = await llamar(contador, () => obtenerAnunciante(token));
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
      await cerrarSincronizacion(empresaId, syncId, { estado: "ok", llamadas: contador.n, error: aviso });
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

    const crudas = [
      ...(await llamar(contador, () => listarCampanas(ctx, { estado: "active" }))),
      ...(await llamar(contador, () => listarCampanas(ctx, { estado: "paused" }))),
    ];
    const campanas = crudas.map((raw) => campanaDesde(cuentaMlId, raw)).filter((c): c is CampanaGuardada => c !== null);
    const porId = new Map(campanas.map((c) => [c.campanaIdMl, c]));
    await guardarCampanas(empresaId, [...porId.values()]);

    const metricas: MetricaGuardada[] = [];
    for (const campana of porId.values()) {
      vigilar(inicio);
      const data = await llamar(contador, () => metricasDiariasCampana(ctx, campana.campanaIdMl, tramo));
      for (const fila of filasDiariasDeCampana(resultsDe(data), campana.campanaIdMl)) {
        if (!fila.entidadIdMl) continue;
        metricas.push({ cuentaMlId, nivel: "campana", entidadIdMl: fila.entidadIdMl, fecha: fila.fecha, metricas: fila.metricas });
      }
    }
    const diariasCuenta = await llamar(contador, () => metricasDiariasCuenta(ctx, tramo));
    const interpretadas = filasDiariasDeCuenta(diariasCuenta);
    if (interpretadas.ambiguo) avisos.push(AVISO_DAILY);
    for (const fila of interpretadas.filas) {
      const entidad = fila.entidadIdMl ?? anunciante.advertiserId;
      const nivel = fila.entidadIdMl ? "campana" : "cuenta";
      metricas.push({ cuentaMlId, nivel, entidadIdMl: entidad, fecha: fila.fecha, metricas: fila.metricas });
    }

    const grupos = [
      ...(await llamar(contador, () => adGroupsDeCampana(ctx, { campanas: [...porId.keys()], desde: tramo.desde, hasta: tramo.hasta, estado: "active" }))),
      ...(await llamar(contador, () => adGroupsDeCampana(ctx, { campanas: [...porId.keys()], desde: tramo.desde, hasta: tramo.hasta, estado: "paused" }))),
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

    const dias = diasDelRango(tramo.desde, tramo.hasta);
    for (const campana of porId.values()) {
      for (const dia of dias) {
        vigilar(inicio);
        const data = await llamar(contador, () => metricasAdGroupsDelDia(ctx, campana.campanaIdMl, dia));
        for (const raw of resultsDe(data)) {
          if (!raw || typeof raw !== "object") continue;
          const rec = raw as Record<string, unknown>;
          const entidad = idNumerico(rec.ad_group_id);
          if (!entidad) continue;
          metricas.push({
            cuentaMlId,
            nivel: "ad_group",
            entidadIdMl: entidad,
            fecha: typeof rec.date === "string" ? rec.date : dia,
            metricas: metricasDesdeApi(rec),
          });
        }
      }
    }
    // Se persiste antes de los anuncios: si la corrida se corta, el
    // reintento hace upsert y no pierde lo ya pedido.
    await guardarMetricas(empresaId, metricas);
    metricas.length = 0;

    const anuncios: AnuncioGuardado[] = [];
    const items = new Set<string>();
    for (const [adGroupId, meta] of tipoPorGrupo) {
      for (const dia of dias) {
        vigilar(inicio);
        const filas = await llamar(contador, () => anunciosDeAdGroup(ctx, adGroupId, { desde: dia, hasta: dia }));
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
            precio: decimalONull(rec.price, 2),
            logisticType: typeof rec.logistic_type === "string" ? rec.logistic_type : null,
            listingTypeId: typeof rec.listing_type_id === "string" ? rec.listing_type_id : null,
          });
          metricas.push({
            cuentaMlId,
            nivel: "anuncio",
            entidadIdMl: itemId,
            fecha: dia,
            metricas: metricasDesdeApi(rec),
          });
        }
      }
    }

    await guardarMetricas(empresaId, metricas);
    await guardarAnuncios(empresaId, anuncios);

    for (const itemId of items) {
      vigilar(inicio);
      if (await costoYaConsultado(empresaId, cuentaMlId, itemId, hoy)) continue;
      const costo = await llamar(contador, () =>
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
    }

    const estado = tramo.cierraBackfill ? "ok" : "parcial";
    await cerrarSincronizacion(empresaId, syncId, {
      estado,
      llamadas: contador.n,
      error: avisos[0] ?? null,
    });
    return estado === "ok" ? "Publicidad actualizada." : "Se guardó un tramo del historial. La próxima corrida sigue con los días anteriores.";
  } catch (error) {
    const aviso = textoErrorCorto(error);
    console.error(`[publicidad] cuenta ${cuentaMlId} no se pudo sincronizar:`, aviso);
    await cerrarSincronizacion(empresaId, syncId, { estado: "error", llamadas: contador.n, error: aviso });
    if (error instanceof CorridaIncompletaError) return "La actualización quedó a medias y se retoma en la próxima corrida.";
    throw error;
  }
}

function debeSaltar(ultima: UltimaSync | null, yaOk: boolean, ahora: Date): boolean {
  if (!ultima) return false;
  const edad = ahora.getTime() - ultima.iniciadaTs.getTime();
  if (ultima.estado === "en_curso" && edad < MINUTOS_EN_CURSO_ABANDONADO * 60_000) return true;
  if (yaOk && ultima.estado === "ok" && hoyBogota(ultima.iniciadaTs) === hoyBogota(ahora)) return true;
  return false;
}

export async function sincronizarPublicidadProgramada(ahora = new Date()): Promise<ResultadoLote> {
  const cuentas = await dbTrabajadorPublicidad
    .select({ id: cuentasMl.id, empresaId: cuentasMl.empresaId })
    .from(cuentasMl)
    .where(isNull(cuentasMl.desconectadaTs))
    .orderBy(asc(cuentasMl.creadoTs));

  const resultado: ResultadoLote = { revisadas: cuentas.length, procesadas: 0, saltadas: 0, fallidas: 0 };
  const inicio = Date.now();
  let hechas = 0;
  for (const cuenta of cuentas) {
    if (hechas >= LOTE_CUENTAS || Date.now() - inicio > PRESUPUESTO_MS) break;
    const historial = await historialSync(cuenta.empresaId, cuenta.id);
    const ultima: UltimaSync | null = historial.ultima
      ? {
          estado: historial.ultima.estado,
          rangoDesde: historial.ultima.rangoDesde,
          rangoHasta: historial.ultima.rangoHasta,
          iniciadaTs: historial.ultima.iniciadaTs,
        }
      : null;
    if (debeSaltar(ultima, historial.yaTerminoBackfill, ahora)) {
      resultado.saltadas += 1;
      continue;
    }
    hechas += 1;
    try {
      await sincronizarCuenta(cuenta.empresaId, cuenta.id, "programada", null, ahora);
      resultado.procesadas += 1;
    } catch (error) {
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
    const aviso = await sincronizarCuenta(empresaId, cuentaMlId, "manual", usuarioId, ahora);
    return { ok: true, aviso };
  } catch (error) {
    return { ok: false, aviso: textoErrorCorto(error) };
  }
}
