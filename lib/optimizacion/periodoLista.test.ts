import { describe, expect, it } from "vitest";
import { descripcionPeriodo, hastaExclusivoIso, leerPeriodoLista, parametrosPeriodoLista, rotuloCortoPeriodo, rotuloRango, textoContraAnterior, tituloResumenTienda } from "@/lib/optimizacion/periodoLista";

// 2026-11-25 12:00 en Bogotá.
const AHORA = new Date("2026-11-25T17:00:00Z");

describe("leerPeriodoLista", () => {
  it("por defecto son 7 días (hoy cuenta) con su período anterior", () => {
    expect(leerPeriodoLista({}, AHORA)).toEqual({
      clave: "7",
      desde: "2026-11-19",
      hasta: "2026-11-25",
      dias: 7,
      rotulo: "Últimos 7 días",
      anteriorDesde: "2026-11-12",
      anteriorHasta: "2026-11-18",
    });
  });

  it("los enlaces viejos ?dias= siguen sirviendo; otro valor cae a 7", () => {
    expect(leerPeriodoLista({ dias: "30" }, AHORA)).toMatchObject({ clave: "30", dias: 30, desde: "2026-10-27" });
    expect(leerPeriodoLista({ dias: "90" }, AHORA).clave).toBe("90");
    expect(leerPeriodoLista({ dias: "500" }, AHORA).clave).toBe("7");
  });

  it("«hoy»: un día, y el anterior es ayer", () => {
    expect(leerPeriodoLista({ periodo: "hoy" }, AHORA)).toEqual({
      clave: "hoy",
      desde: "2026-11-25",
      hasta: "2026-11-25",
      dias: 1,
      rotulo: "Hoy",
      anteriorDesde: "2026-11-24",
      anteriorHasta: "2026-11-24",
    });
  });

  it("«hoy» usa el día de Bogotá, no el del servidor (UTC)", () => {
    // 2026-11-26 02:00 UTC = 21:00 del 25 en Bogotá.
    expect(leerPeriodoLista({ periodo: "hoy" }, new Date("2026-11-26T02:00:00Z")).hasta).toBe("2026-11-25");
  });

  it("rango válido, con el anterior del mismo largo", () => {
    expect(leerPeriodoLista({ desde: "2026-11-01", hasta: "2026-11-15" }, AHORA)).toEqual({
      clave: "rango",
      desde: "2026-11-01",
      hasta: "2026-11-15",
      dias: 15,
      rotulo: "1–15 nov",
      anteriorDesde: "2026-10-17",
      anteriorHasta: "2026-10-31",
    });
  });

  it("rango invertido se endereza", () => {
    expect(leerPeriodoLista({ desde: "2026-11-15", hasta: "2026-11-01" }, AHORA)).toMatchObject({ clave: "rango", desde: "2026-11-01", hasta: "2026-11-15" });
  });

  it("un solo día de rango y hasta = hoy valen", () => {
    expect(leerPeriodoLista({ desde: "2026-11-25", hasta: "2026-11-25" }, AHORA)).toMatchObject({ clave: "rango", dias: 1, rotulo: "25 nov" });
  });

  it("cruce de mes y de año en el rótulo", () => {
    expect(leerPeriodoLista({ desde: "2026-10-28", hasta: "2026-11-03" }, AHORA).rotulo).toBe("28 oct–3 nov");
    expect(rotuloRango("2025-12-28", "2026-01-03")).toBe("28 dic 2025–3 ene 2026");
  });

  it("cruce de año en el período anterior", () => {
    const p = leerPeriodoLista({ desde: "2027-01-01", hasta: "2027-01-05" }, new Date("2027-01-10T17:00:00Z"));
    expect(p).toMatchObject({ dias: 5, anteriorDesde: "2026-12-27", anteriorHasta: "2026-12-31" });
  });

  it("fecha futura cae al período por defecto", () => {
    expect(leerPeriodoLista({ desde: "2026-11-20", hasta: "2026-11-26" }, AHORA).clave).toBe("7");
    expect(leerPeriodoLista({ desde: "2026-12-01", hasta: "2026-12-05" }, AHORA).clave).toBe("7");
  });

  it("más de 150 días atrás cae al período por defecto; el límite exacto vale", () => {
    // hoy − 149 = 2026-06-29
    expect(leerPeriodoLista({ desde: "2026-06-29", hasta: "2026-07-05" }, AHORA)).toMatchObject({ clave: "rango", desde: "2026-06-29" });
    expect(leerPeriodoLista({ desde: "2026-06-28", hasta: "2026-07-05" }, AHORA).clave).toBe("7");
    expect(leerPeriodoLista({ desde: "2026-06-29", hasta: "2026-11-25" }, AHORA).dias).toBe(150);
  });

  it("basura nunca lanza y cae al período por defecto (respeta ?dias=)", () => {
    for (const malo of ["", "abc", "2026-13-01", "2026-02-30", "2026-1-1", "2026-11-01'; drop", undefined, null, 5, ["2026-11-01"]]) {
      expect(leerPeriodoLista({ desde: malo, hasta: "2026-11-10" }, AHORA).clave).toBe("7");
      expect(leerPeriodoLista({ desde: "2026-11-01", hasta: malo }, AHORA).clave).toBe("7");
    }
    expect(leerPeriodoLista({ periodo: "ayer", dias: "14" }, AHORA).clave).toBe("14");
    expect(leerPeriodoLista({ desde: "x", hasta: "y", dias: "30" }, AHORA).clave).toBe("30");
  });

  it("«hoy» manda sobre un rango", () => {
    expect(leerPeriodoLista({ periodo: "hoy", desde: "2026-11-01", hasta: "2026-11-15" }, AHORA).clave).toBe("hoy");
  });
});

describe("textos del período", () => {
  it("rótulos cortos, comparación y parámetros de URL", () => {
    const hoy = leerPeriodoLista({ periodo: "hoy" }, AHORA);
    const rango = leerPeriodoLista({ desde: "2026-11-01", hasta: "2026-11-15" }, AHORA);
    const siete = leerPeriodoLista({}, AHORA);
    expect(rotuloCortoPeriodo(hoy)).toBe("hoy");
    expect(rotuloCortoPeriodo(rango)).toBe("1–15 nov");
    expect(rotuloCortoPeriodo(siete)).toBe("7 d");
    expect(textoContraAnterior(hoy)).toBe("vs. el día anterior");
    expect(textoContraAnterior(rango)).toBe("vs. los 15 días anteriores");
    expect(parametrosPeriodoLista(hoy)).toEqual({ periodo: "hoy" });
    expect(parametrosPeriodoLista(rango)).toEqual({ desde: "2026-11-01", hasta: "2026-11-15" });
    expect(parametrosPeriodoLista(siete)).toEqual({});
    expect(parametrosPeriodoLista(leerPeriodoLista({ dias: "30" }, AHORA))).toEqual({ dias: "30" });
  });

  it("título del resumen y descripción de la página", () => {
    const hoy = leerPeriodoLista({ periodo: "hoy" }, AHORA);
    const rango = leerPeriodoLista({ desde: "2026-11-01", hasta: "2026-11-15" }, AHORA);
    const catorce = leerPeriodoLista({ dias: "14" }, AHORA);
    expect(tituloResumenTienda(hoy)).toBe("Resumen de la tienda · hoy");
    expect(tituloResumenTienda(rango)).toBe("Resumen de la tienda · 1–15 nov");
    expect(tituloResumenTienda(catorce)).toBe("Resumen de la tienda · últimos 14 días");
    expect(descripcionPeriodo(hoy)).toBe("de hoy");
    expect(descripcionPeriodo(rango)).toBe("del 1–15 nov");
    expect(descripcionPeriodo(catorce)).toBe("de los últimos 14 días");
  });

  it("el hasta exclusivo es el día siguiente", () => {
    expect(hastaExclusivoIso(leerPeriodoLista({ periodo: "hoy" }, AHORA))).toBe("2026-11-26");
    expect(hastaExclusivoIso(leerPeriodoLista({ desde: "2026-11-28", hasta: "2026-11-30" }, new Date("2026-12-05T17:00:00Z")))).toBe("2026-12-01");
  });
});
