import { describe, expect, it } from "vitest";
import { datosSitioMl, esSiteIdValido, SITE_ID_DEFECTO, SITIOS_ML } from "./sitios";

// Issue #315 (Z-LATAM-01) — mapa puro, sin ningún import de db/ ni de
// Mercado Libre: se puede probar entero sin mocks.
describe("SITIOS_ML / datosSitioMl — mapa de país/moneda/idioma por site_id", () => {
  it("los 5 sitios reales que opera Zilonix en LATAM, con su moneda e idioma reales", () => {
    expect(datosSitioMl("MCO")).toEqual({ siteId: "MCO", moneda: "COP", idioma: "es-CO", nombre: "Colombia" });
    expect(datosSitioMl("MLM")).toEqual({ siteId: "MLM", moneda: "MXN", idioma: "es-MX", nombre: "México" });
    expect(datosSitioMl("MLB")).toEqual({ siteId: "MLB", moneda: "BRL", idioma: "pt-BR", nombre: "Brasil" });
    expect(datosSitioMl("MLA")).toEqual({ siteId: "MLA", moneda: "ARS", idioma: "es-AR", nombre: "Argentina" });
    expect(datosSitioMl("MLC")).toEqual({ siteId: "MLC", moneda: "CLP", idioma: "es-CL", nombre: "Chile" });
  });

  it("site_id null (Mercado Libre no lo mandó): cae al default (MCO/COP/es-CO), nunca lanza", () => {
    expect(datosSitioMl(null)).toEqual(SITIOS_ML[SITE_ID_DEFECTO]);
  });

  it("site_id desconocido (un país que Zilonix todavía no opera): cae al default, nunca bloquea conectar", () => {
    expect(datosSitioMl("MLU")).toEqual(SITIOS_ML[SITE_ID_DEFECTO]);
    expect(datosSitioMl("algo-inventado")).toEqual(SITIOS_ML[SITE_ID_DEFECTO]);
  });

  it("site_id con tipo distinto de string (nunca debería pasar, pero por si acaso): cae al default, nunca lanza", () => {
    expect(datosSitioMl(undefined)).toEqual(SITIOS_ML[SITE_ID_DEFECTO]);
    expect(datosSitioMl(123)).toEqual(SITIOS_ML[SITE_ID_DEFECTO]);
  });

  it("el default (SITE_ID_DEFECTO) es exactamente el mismo que el DEFAULT real de la columna site_id (migración 0020)", () => {
    expect(SITE_ID_DEFECTO).toBe("MCO");
  });

  it("esSiteIdValido reconoce exactamente los 5 sitios reales, nada más", () => {
    expect(esSiteIdValido("MCO")).toBe(true);
    expect(esSiteIdValido("MLM")).toBe(true);
    expect(esSiteIdValido("MLB")).toBe(true);
    expect(esSiteIdValido("MLA")).toBe(true);
    expect(esSiteIdValido("MLC")).toBe(true);
    expect(esSiteIdValido("MLU")).toBe(false);
    expect(esSiteIdValido(null)).toBe(false);
    expect(esSiteIdValido(undefined)).toBe(false);
    expect(esSiteIdValido(42)).toBe(false);
  });

  it("SITIOS_ML tiene EXACTAMENTE los 5 sitios del CHECK real de cuentas_ml — nunca más, nunca menos", () => {
    expect(Object.keys(SITIOS_ML).sort()).toEqual(["MCO", "MLA", "MLB", "MLC", "MLM"]);
  });

  it("cada moneda es un código ISO 4217 real de 3 letras, cada idioma es un locale BCP 47 con región", () => {
    for (const sitio of Object.values(SITIOS_ML)) {
      expect(sitio.moneda).toMatch(/^[A-Z]{3}$/);
      expect(sitio.idioma).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });
});
