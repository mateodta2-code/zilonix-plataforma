import { describe, expect, it } from "vitest";
import {
  DIAS_BACKFILL,
  DIAS_INCREMENTAL,
  DIAS_MAX_API,
  decidirTramo,
  diasEntreInclusive,
  evaluarRefrescoManual,
  hoyBogota,
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
    const texto = textoErrorCorto(new Error("falló Bearer abc.def.ghi access_token=secreto-largo"));
    expect(texto).not.toContain("abc.def.ghi");
    expect(texto).not.toContain("secreto-largo");
    expect(texto).toContain("Bearer [omitido]");
  });

  it("hoy en Bogotá no depende del huso del servidor", () => {
    expect(hoyBogota(new Date("2026-10-26T04:30:00Z"))).toBe("2026-10-25");
    expect(hoyBogota(new Date("2026-10-26T05:30:00Z"))).toBe("2026-10-26");
  });
});
