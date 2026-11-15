import { describe, expect, it } from "vitest";
import { datosSitioMl, dominioMl, esSiteIdValido, formatearMoneda, formatearNumero, SITE_ID_DEFECTO, SITIOS_ML } from "./sitios";

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

// Helpers de formato — el reemplazo real de "$" + toLocaleString("es-CO")
// fijos en Publicar/Promociones (issue #315). Puros, con Intl — se
// prueban los 5 sitios reales + sitio desconocido (cae al default).
describe("formatearMoneda — moneda e idioma reales por sitio, nunca $/es-CO fijo", () => {
  it("MCO: pesos colombianos, sin decimales, símbolo $", () => {
    expect(formatearMoneda(150000, "MCO")).toBe("$ 150.000");
  });

  it("MLM: pesos mexicanos", () => {
    expect(formatearMoneda(1500.5, "MLM")).toBe("$1,500.50");
  });

  it("MLA: pesos argentinos", () => {
    expect(formatearMoneda(1500.5, "MLA")).toBe("$ 1.500,50");
  });

  it("MLB: reales brasileños, símbolo R$", () => {
    expect(formatearMoneda(1500.5, "MLB")).toBe("R$ 1.500,50");
  });

  it("MLC: pesos chilenos, sin decimales", () => {
    expect(formatearMoneda(150000, "MLC")).toBe("$150.000");
  });

  it("siteId desconocido: cae al default (COP/es-CO), nunca lanza", () => {
    expect(formatearMoneda(150000, "algo-inventado")).toBe(formatearMoneda(150000, SITE_ID_DEFECTO));
    expect(formatearMoneda(150000, null)).toBe(formatearMoneda(150000, SITE_ID_DEFECTO));
  });
});

// Issue #315 — dominio real del sitio público, para armar un
// permalink sin fijar ".com.co" (lib/ml/permalink.ts).
describe("dominioMl — dominio real por site_id, nunca mercadolibre.com.co fijo", () => {
  it("cada uno de los 5 sitios reales, con el dominio real de Mercado Libre de ese país", () => {
    expect(dominioMl("MCO")).toBe("mercadolibre.com.co");
    expect(dominioMl("MLM")).toBe("mercadolibre.com.mx");
    expect(dominioMl("MLB")).toBe("mercadolivre.com.br"); // Brasil: mercadoLIVRE, no mercadoLIBRE
    expect(dominioMl("MLA")).toBe("mercadolibre.com.ar");
    expect(dominioMl("MLC")).toBe("mercadolibre.cl"); // Chile: sin ".com"
  });

  it("site_id desconocido o inválido: cae al dominio del default, nunca lanza", () => {
    expect(dominioMl("MLU")).toBe(dominioMl(SITE_ID_DEFECTO));
    expect(dominioMl("algo-inventado")).toBe(dominioMl(SITE_ID_DEFECTO));
    expect(dominioMl(null)).toBe(dominioMl(SITE_ID_DEFECTO));
    expect(dominioMl(undefined)).toBe(dominioMl(SITE_ID_DEFECTO));
  });
});

describe("formatearNumero — agrupado de miles del idioma real, nunca es-CO fijo", () => {
  it("formatea con el separador de miles real de cada idioma", () => {
    expect(formatearNumero(12345, "es-CO")).toBe("12.345");
    expect(formatearNumero(12345, "es-MX")).toBe("12,345");
    expect(formatearNumero(12345, "pt-BR")).toBe("12.345");
  });

  it("idioma desconocido o no-string: cae al idioma del default, nunca lanza", () => {
    expect(formatearNumero(12345, "algo-inventado")).toBe(formatearNumero(12345, SITIOS_ML[SITE_ID_DEFECTO].idioma));
    expect(formatearNumero(12345, null)).toBe(formatearNumero(12345, SITIOS_ML[SITE_ID_DEFECTO].idioma));
    expect(formatearNumero(12345, undefined)).toBe(formatearNumero(12345, SITIOS_ML[SITE_ID_DEFECTO].idioma));
  });
});
