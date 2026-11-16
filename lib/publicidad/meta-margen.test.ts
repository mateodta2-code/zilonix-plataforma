import { describe, expect, it } from "vitest";
import { leerMetaMargen, metaComoPorcentaje, mitadDeMeta } from "@/lib/publicidad/meta-margen";
import { margenRealProducto, semaforoMargen } from "@/lib/publicidad/kpis";

describe("meta de margen (semáforo de productos)", () => {
  it("lee el porcentaje del formulario y lo guarda en fracción", () => {
    expect(leerMetaMargen("30")).toBe("0.3000");
    expect(leerMetaMargen(" 27,5 % ")).toBe("0.2750");
    expect(leerMetaMargen("1")).toBe("0.0100");
    expect(leerMetaMargen("99")).toBe("0.9900");
  });

  it("rechaza lo que no es una meta posible", () => {
    for (const malo of ["", "0", "100", "-5", "abc", "30.123", "150"]) expect(leerMetaMargen(malo)).toBeNull();
  });

  it("muestra la fracción guardada como porcentaje", () => {
    expect(metaComoPorcentaje("0.3000")).toBe("30");
    expect(metaComoPorcentaje("0.2750")).toBe("27,5");
    expect(metaComoPorcentaje("0.0500")).toBe("5");
    expect(mitadDeMeta("0.3000")).toBe("0.1500");
    expect(mitadDeMeta("0.2750")).toBe("0.1375");
  });
});

describe("margen real por producto", () => {
  const base = {
    precio: "100000.00",
    costo: "40000.00",
    empaque: "2000.00",
    envioAgencia: "3000.00",
    comisionMl: "15000.00",
    envioMl: "10000.00",
    compradorPagaEnvio: false,
  };

  it("resta costo, empaque, envío a agencia, comisión y envío de Mercado Libre", () => {
    expect(margenRealProducto(base)).toEqual({ tipo: "ok", ganancia: "30000.00", margen: "0.3000" });
  });

  it("el envío de Mercado Libre solo cuenta si lo paga el vendedor", () => {
    expect(margenRealProducto({ ...base, compradorPagaEnvio: true })).toEqual({ tipo: "ok", ganancia: "40000.00", margen: "0.4000" });
  });

  it("empaque y envío a agencia vacíos cuentan como $0; ganancia negativa se muestra", () => {
    expect(margenRealProducto({ ...base, empaque: null, envioAgencia: null })).toEqual({
      tipo: "ok",
      ganancia: "35000.00",
      margen: "0.3500",
    });
    expect(margenRealProducto({ ...base, costo: "90000.00" })).toEqual({ tipo: "ok", ganancia: "-20000.00", margen: "-0.2000" });
  });

  it("sin costo cargado o sin datos de Mercado Libre no inventa un margen", () => {
    expect(margenRealProducto({ ...base, costo: null })).toEqual({ tipo: "sin_costo" });
    expect(margenRealProducto({ ...base, precio: null })).toEqual({ tipo: "sin_datos" });
    expect(margenRealProducto({ ...base, comisionMl: null })).toEqual({ tipo: "sin_datos" });
    expect(margenRealProducto({ ...base, envioMl: null })).toEqual({ tipo: "sin_datos" });
  });

  it("franjas a partir de la meta: verde desde la meta, amarillo desde la mitad", () => {
    expect(semaforoMargen("0.3000", "0.30")).toBe("verde");
    expect(semaforoMargen("0.2999", "0.30")).toBe("amarillo");
    expect(semaforoMargen("0.1500", "0.30")).toBe("amarillo");
    expect(semaforoMargen("0.1499", "0.30")).toBe("rojo");
    expect(semaforoMargen("-0.2000", "0.30")).toBe("rojo");
    // Otra meta: las franjas se recalculan solas.
    expect(semaforoMargen("0.2000", "0.40")).toBe("amarillo");
    expect(semaforoMargen("0.1900", "0.40")).toBe("rojo");
  });
});

describe("columna Estado de campañas (semáforo por ROAS, aunque aprenda)", () => {
  it("verde desde el 90 %, amarillo desde el 70 %, rojo abajo", async () => {
    const { semaforoCampana } = await import("@/lib/publicidad/kpis");
    expect(semaforoCampana("12.34", "12.00")).toBe("en_objetivo");
    expect(semaforoCampana("10.80", "12.00")).toBe("en_objetivo");
    expect(semaforoCampana("10.79", "12.00")).toBe("bajo_objetivo");
    expect(semaforoCampana("9.53", "12.00")).toBe("bajo_objetivo");
    expect(semaforoCampana("8.40", "12.00")).toBe("bajo_objetivo");
    expect(semaforoCampana("5.46", "13.00")).toBe("muy_bajo");
    expect(semaforoCampana(null, "12.00")).toBe("sin_datos");
    expect(semaforoCampana("5.00", null)).toBe("sin_objetivo");
  });

  it("el filtro Bajo objetivo viaja en la URL", async () => {
    const { hrefPublicidad, leerParametrosPublicidad } = await import("@/lib/publicidad/params");
    expect(hrefPublicidad({ cuenta: "abc", estado: "bajo" })).toBe("/panel/publicidad?cuenta=abc&estado=bajo");
    expect(hrefPublicidad({ cuenta: "abc", estado: "todas" })).toBe("/panel/publicidad?cuenta=abc");
    expect(leerParametrosPublicidad({ estado: "bajo" }, new Date("2026-11-15T12:00:00-05:00")).estado).toBe("bajo");
    expect(leerParametrosPublicidad({ estado: "otra" }, new Date("2026-11-15T12:00:00-05:00")).estado).toBe("todas");
  });

  it("la nota de abajo dice cuáles aprenden y a cuánto del objetivo van las demás", async () => {
    const { notaSemaforo } = await import("@/app/panel/publicidad/vista");
    type C = Parameters<typeof notaSemaforo>[0][number];
    const c = (nombre: string, dias: number | null, estado: C["semaforo"]["estado"], porcentaje: string | null) =>
      ({ nombre, diasParaEstabilizar: dias, semaforo: { estado, rotulo: "", tono: "neutro", porcentaje } }) as C;
    expect(
      notaSemaforo([
        c("agrupación", 7, "muy_bajo", "42 %"),
        c("vendidos 06-08", 4, "en_objetivo", "103 %"),
        c("ENFRIAMIENTO", null, "muy_bajo", "57 %"),
        c("suplementos", null, "bajo_objetivo", "79 %"),
        c("variados", null, "en_objetivo", "109 %"),
      ])
    ).toBe(
      "agrupación (7 días), vendidos 06-08 (4 días) están en Aprendiendo y no se tocan. ENFRIAMIENTO en 57 % del objetivo. suplementos en 79 % del objetivo. En objetivo ≥90 % del ROAS objetivo · Bajo 70–90 % · Muy bajo <70 %."
    );
  });
});
