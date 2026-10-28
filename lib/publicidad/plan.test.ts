import { describe, expect, it } from "vitest";
import {
  DIAS_BACKFILL,
  DIAS_INCREMENTAL,
  DIAS_MAX_API,
  MAX_REINTENTOS_TRAMO,
  MIN_PRESUPUESTO_CUENTA_MS,
  alcanzaParaAbrirCuenta,
  backfillRealmenteCerrado,
  contarReintentosMismoTramo,
  decisionAnteErrorDeCosto,
  decidirTramo,
  diasARetomar,
  diasEntreInclusive,
  evaluarRefrescoManual,
  hoyBogota,
  leerRetryAfterMs,
  ordenarCuentasParaSync,
  ordenDeTrabajo,
  partidaAlCortar,
  restarDiasIso,
  textoErrorCorto,
} from "./plan";

describe("rango de sincronización de publicidad (issue #254)", () => {
  const hoy = "2026-10-26";

  it("la primera corrida pide un tramo de 7 días dentro de un backfill de 62, nunca más de 90", () => {
    const tramo = decidirTramo(hoy, null, false);
    expect(diasEntreInclusive(tramo.desde, tramo.hasta)).toBe(7);
    expect(tramo.hasta).toBe(hoy);
    expect(tramo.cierraBackfill).toBe(false);
    const objetivo = restarDiasIso(hoy, DIAS_BACKFILL - 1);
    expect(tramo.desde >= objetivo).toBe(true);
    expect(diasEntreInclusive(restarDiasIso(hoy, DIAS_MAX_API - 1), hoy)).toBe(DIAS_MAX_API);
    expect(diasEntreInclusive(objetivo, hoy)).toBe(DIAS_BACKFILL);
    expect(DIAS_BACKFILL).toBeLessThanOrEqual(DIAS_MAX_API);
  });

  it("un tramo parcial sigue hacia atrás y el último cierra el backfill", () => {
    const primero = decidirTramo(hoy, null, false);
    const siguiente = decidirTramo(
      hoy,
      { estado: "parcial", rangoDesde: primero.desde, rangoHasta: primero.hasta, iniciadaTs: new Date() },
      false
    );
    expect(siguiente.hasta).toBe(restarDiasIso(primero.desde, 1));
    expect(siguiente.desde < primero.desde).toBe(true);
  });

  it("con backfill ya cerrado, la corrida pide los últimos 15 días", () => {
    const tramo = decidirTramo(hoy, { estado: "ok", rangoDesde: "2026-08-26", rangoHasta: hoy, iniciadaTs: new Date() }, true);
    expect(diasEntreInclusive(tramo.desde, tramo.hasta)).toBe(DIAS_INCREMENTAL);
    expect(tramo.hasta).toBe(hoy);
    expect(DIAS_INCREMENTAL).toBe(15);
  });

  it("un error reintenta el mismo tramo, no avanza", () => {
    const tramo = decidirTramo(
      hoy,
      { estado: "error", rangoDesde: "2026-10-20", rangoHasta: "2026-10-26", iniciadaTs: new Date() },
      false
    );
    expect(tramo).toMatchObject({ desde: "2026-10-20", hasta: "2026-10-26" });
  });

  it("al tercer error del mismo tramo avanza, para no reintentar para siempre", () => {
    const tramo = decidirTramo(
      hoy,
      { estado: "error", rangoDesde: "2026-10-20", rangoHasta: "2026-10-26", iniciadaTs: new Date() },
      false,
      MAX_REINTENTOS_TRAMO
    );
    expect(tramo.hasta).toBe("2026-10-19");
    expect(tramo.desde < "2026-10-20").toBe(true);
  });

  it("un ok sin cierraBackfill no cuenta como backfill terminado", () => {
    expect(backfillRealmenteCerrado([{ estado: "ok", cierraBackfill: false }])).toBe(false);
    expect(backfillRealmenteCerrado([{ estado: "error", cierraBackfill: true }])).toBe(false);
    expect(backfillRealmenteCerrado([{ estado: "ok", cierraBackfill: true }])).toBe(true);
  });

  it("ordena por la sincronización más vieja y deja primero a quien nunca corrió", () => {
    const cuentas = [
      { id: "f", creadoTs: 1, ultimaSyncTs: 500 },
      { id: "a", creadoTs: 6, ultimaSyncTs: 100 },
      { id: "b", creadoTs: 2, ultimaSyncTs: null },
      { id: "c", creadoTs: 3, ultimaSyncTs: 100 },
      { id: "d", creadoTs: 4, ultimaSyncTs: null },
      { id: "e", creadoTs: 5, ultimaSyncTs: 200 },
    ];
    expect(ordenarCuentasParaSync(cuentas).map((c) => c.id)).toEqual(["b", "d", "c", "a", "e", "f"]);
  });

  it("un corte por tiempo que no avanza el día cuenta como intento", () => {
    const mismo = { estado: "error", rangoDesde: "2026-10-20", rangoHasta: "2026-10-26", reanudaDesde: null as string | null };
    const n = contarReintentosMismoTramo([
      { ...mismo, error: "CorridaIncompletaError: corte" },
      { ...mismo, error: "CorridaIncompletaError: corte" },
      { ...mismo, error: "Error: 500" },
    ]);
    expect(n).toBe(3);
  });

  it("tres cortes en el mismo día agotan el tramo y el backfill sigue", () => {
    const corte = {
      estado: "error",
      rangoDesde: "2026-10-20",
      rangoHasta: "2026-10-26",
      error: "CorridaIncompletaError: corte",
      reanudaDesde: "2026-10-22",
    };
    // El primer corte que dejó el día sí avanzó. Los tres siguientes, en
    // el mismo día, no: ahí el tramo se da por agotado.
    expect(contarReintentosMismoTramo([corte, corte, corte, corte])).toBe(MAX_REINTENTOS_TRAMO);
    const tramo = decidirTramo(
      hoy,
      { estado: "error", rangoDesde: "2026-10-20", rangoHasta: "2026-10-26", iniciadaTs: new Date() },
      false,
      MAX_REINTENTOS_TRAMO
    );
    expect(tramo.hasta).toBe("2026-10-19");
  });

  it("un corte que avanza el día no suma y corta la racha de intentos viejos", () => {
    const base = { estado: "error", rangoDesde: "2026-10-20", rangoHasta: "2026-10-26", error: "CorridaIncompletaError: corte" };
    expect(
      contarReintentosMismoTramo([
        { ...base, reanudaDesde: "2026-10-24" },
        { ...base, reanudaDesde: "2026-10-22" },
        { ...base, error: "Error: 500", reanudaDesde: null },
      ])
    ).toBe(0);
    expect(
      contarReintentosMismoTramo([
        { estado: "error", rangoDesde: "2026-10-20", rangoHasta: "2026-10-26", error: "CorridaIncompletaError: corte", reanudaDesde: "2026-10-22" },
      ])
    ).toBe(0);
  });

  it("un 4xx de costo, incluido el 403 de la app, no bloquea el backfill", () => {
    const cuatro = new Error("4xx");
    cuatro.name = "MlRespuestaInesperadaError";
    const sinPermiso = new Error("403");
    sinPermiso.name = "MlSinPermisoAppError";
    const corte = new Error("tiempo");
    corte.name = "CorridaIncompletaError";
    expect(decisionAnteErrorDeCosto(cuatro)).toBe("seguir");
    expect(decisionAnteErrorDeCosto(sinPermiso)).toBe("seguir");
    expect(decisionAnteErrorDeCosto(corte)).toBe("cerrar-tramo");
    expect(decisionAnteErrorDeCosto(new Error("token"))).toBe("fallar");
  });

  it("un corte antes de los días no gasta intentos aunque el cursor siga en null", () => {
    const pre = {
      estado: "error",
      rangoDesde: "2026-10-20",
      rangoHasta: "2026-10-26",
      error: "CorridaIncompletaError: fase:pre-dias. corte",
      reanudaDesde: null as string | null,
    };
    expect(contarReintentosMismoTramo([pre, pre, pre])).toBe(0);
    const tramo = decidirTramo(
      hoy,
      { estado: "error", rangoDesde: "2026-10-20", rangoHasta: "2026-10-26", iniciadaTs: new Date() },
      false,
      0
    );
    expect(tramo).toMatchObject({ desde: "2026-10-20", hasta: "2026-10-26" });
  });

  it("un corte durante costos no gasta intentos", () => {
    const costos = {
      estado: "error",
      rangoDesde: "2026-10-20",
      rangoHasta: "2026-10-26",
      error: "CorridaIncompletaError: fase:costos. corte",
      reanudaDesde: "2026-10-26",
    };
    expect(contarReintentosMismoTramo([costos, costos, costos])).toBe(0);
  });

  it("no abre otra cuenta si quedan menos de 60 segundos", () => {
    expect(alcanzaParaAbrirCuenta(MIN_PRESUPUESTO_CUENTA_MS)).toBe(true);
    expect(alcanzaParaAbrirCuenta(MIN_PRESUPUESTO_CUENTA_MS - 1)).toBe(false);
  });

  it("un corte a mitad de las campañas de un día no se salta los días ya pedidos ni las campañas que faltan", () => {
    const todos = diasARetomar("2026-10-20", "2026-10-22", null);
    expect(todos).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    const campanas = ["A", "B", "C"];
    const grupos = ["g1", "g2"];
    const orden = ordenDeTrabajo(campanas, grupos, todos);
    const corte = orden.findIndex((paso) => paso.fase === "ad_groups" && paso.entidad === "B" && paso.dia === "2026-10-21");
    const { hechos, pendientes } = partidaAlCortar(orden, corte);

    expect(hechos.some((paso) => paso.fase === "ad_groups" && paso.entidad === "C" && paso.dia === "2026-10-20")).toBe(true);
    expect(hechos.some((paso) => paso.fase === "anuncios" && paso.entidad === "g2" && paso.dia === "2026-10-20")).toBe(true);
    expect(pendientes[0]).toEqual({ fase: "ad_groups", entidad: "B", dia: "2026-10-21" });
    expect(pendientes.filter((paso) => paso.fase !== "metricas_campana" && paso.dia === "2026-10-22")).toHaveLength(campanas.length + grupos.length);

    const retomados = diasARetomar("2026-10-20", "2026-10-22", "2026-10-21");
    expect(retomados).not.toContain("2026-10-20");
    expect(retomados[0]).toBe("2026-10-21");
    const otraVez = ordenDeTrabajo(campanas, grupos, retomados);
    expect(otraVez.filter((paso) => paso.fase === "ad_groups" && paso.dia === "2026-10-21").map((paso) => paso.entidad)).toEqual(campanas);
  });

  it("un corte a mitad de los anuncios deja hechos los ad groups de ese día y pendientes los días siguientes", () => {
    const orden = ordenDeTrabajo(["A", "B"], ["g1", "g2"], ["2026-10-20", "2026-10-21"]);
    const corte = orden.findIndex((paso) => paso.fase === "anuncios" && paso.entidad === "g2" && paso.dia === "2026-10-20");
    const { hechos, pendientes } = partidaAlCortar(orden, corte);
    expect(hechos.filter((paso) => paso.fase === "ad_groups" && paso.dia === "2026-10-20").map((paso) => paso.entidad)).toEqual(["A", "B"]);
    expect(hechos.some((paso) => paso.fase === "anuncios" && paso.entidad === "g1" && paso.dia === "2026-10-20")).toBe(true);
    expect(pendientes[0]).toEqual({ fase: "anuncios", entidad: "g2", dia: "2026-10-20" });
    expect(pendientes.filter((paso) => paso.fase !== "metricas_campana" && paso.dia === "2026-10-21").map((paso) => paso.fase)).toEqual([
      "ad_groups",
      "ad_groups",
      "anuncios",
      "anuncios",
    ]);
  });

  it("el refresco manual se niega si hay una en curso o pasó menos de 10 minutos", () => {
    const ahora = new Date("2026-10-26T15:00:00Z");
    expect(evaluarRefrescoManual(ahora, null).permitir).toBe(true);
    const hace5 = new Date(ahora.getTime() - 5 * 60_000);
    expect(evaluarRefrescoManual(ahora, { estado: "ok", rangoDesde: hoy, rangoHasta: hoy, iniciadaTs: hace5 }).permitir).toBe(false);
    expect(evaluarRefrescoManual(ahora, { estado: "en_curso", rangoDesde: hoy, rangoHasta: hoy, iniciadaTs: hace5 }).permitir).toBe(false);
    const hace20 = new Date(ahora.getTime() - 20 * 60_000);
    expect(evaluarRefrescoManual(ahora, { estado: "ok", rangoDesde: hoy, rangoHasta: hoy, iniciadaTs: hace20 }).permitir).toBe(true);
  });

  it("el texto de error no conserva un bearer ni un access_token", () => {
    const texto = textoErrorCorto(
      new Error("falló Bearer abc.def.ghi access_token=secreto-largo refresh_token=otro-secreto client_secret=clave-app")
    );
    expect(texto).not.toContain("abc.def.ghi");
    expect(texto).not.toContain("secreto-largo");
    expect(texto).not.toContain("otro-secreto");
    expect(texto).not.toContain("clave-app");
    expect(texto).toContain("Bearer [omitido]");
    expect(texto).toContain("refresh_token=[omitido]");
    expect(texto).toContain("client_secret=[omitido]");
  });

  it("Retry-After en segundos o fecha HTTP, con tope de 60 s", () => {
    expect(leerRetryAfterMs("12")).toBe(12_000);
    expect(leerRetryAfterMs("120")).toBe(60_000);
    const ahora = Date.parse("2026-10-26T15:00:00Z");
    expect(leerRetryAfterMs("Mon, 26 Oct 2026 15:00:08 GMT", ahora)).toBe(8_000);
    expect(leerRetryAfterMs("no-es-fecha")).toBeNull();
  });

  it("hoy en Bogotá no depende del huso del servidor", () => {
    expect(hoyBogota(new Date("2026-10-26T04:30:00Z"))).toBe("2026-10-25");
    expect(hoyBogota(new Date("2026-10-26T05:30:00Z"))).toBe("2026-10-26");
  });
});
