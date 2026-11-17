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
    sku: "SKU-A1",
    precio: "100000.00",
    costo: "40000.00",
    empaque: "2000.00",
    envioAgencia: "3000.00",
    full: false,
    comisionMl: "15000.00",
    envioMl: "10000.00",
    compradorPagaEnvio: false,
  };

  it("resta el costo total (costo + empaque + envío a agencia), la comisión y el envío de Mercado Libre", () => {
    expect(margenRealProducto(base)).toEqual({
      tipo: "ok",
      costoTotal: "45000.00",
      envio: "10000.00",
      ganancia: "30000.00",
      margen: "0.3000",
    });
  });

  it("el envío de Mercado Libre solo cuenta si lo paga el vendedor", () => {
    expect(margenRealProducto({ ...base, compradorPagaEnvio: true })).toMatchObject({ tipo: "ok", envio: "0.00", ganancia: "40000.00", margen: "0.4000" });
    // Si lo paga el comprador no hace falta el monto.
    expect(margenRealProducto({ ...base, compradorPagaEnvio: true, envioMl: null })).toMatchObject({ tipo: "ok", ganancia: "40000.00" });
  });

  it("en Full el envío a agencia vale $0, aunque esté cargado o vacío", () => {
    expect(margenRealProducto({ ...base, full: true })).toMatchObject({ tipo: "ok", costoTotal: "42000.00", ganancia: "33000.00", margen: "0.3300" });
    expect(margenRealProducto({ ...base, full: true, envioAgencia: null })).toMatchObject({ tipo: "ok", costoTotal: "42000.00" });
  });

  it("un dato que falta es sin dato, nunca $0", () => {
    expect(margenRealProducto({ ...base, empaque: null })).toEqual({ tipo: "sin_datos" });
    expect(margenRealProducto({ ...base, envioAgencia: null })).toEqual({ tipo: "sin_datos" });
    expect(margenRealProducto({ ...base, comisionMl: null })).toEqual({ tipo: "sin_datos" });
    expect(margenRealProducto({ ...base, envioMl: null })).toEqual({ tipo: "sin_datos" });
    expect(margenRealProducto({ ...base, precio: null })).toEqual({ tipo: "sin_datos" });
    expect(margenRealProducto({ ...base, precio: "0.00" })).toEqual({ tipo: "sin_datos" });
  });

  it("distingue Sin SKU de Sin costo", () => {
    expect(margenRealProducto({ ...base, sku: null })).toEqual({ tipo: "sin_sku" });
    expect(margenRealProducto({ ...base, costo: null })).toEqual({ tipo: "sin_costo" });
  });

  it("ganancia negativa se muestra; costo 0 es un $0 real", () => {
    expect(margenRealProducto({ ...base, costo: "90000.00" })).toMatchObject({ tipo: "ok", ganancia: "-20000.00", margen: "-0.2000" });
    expect(margenRealProducto({ ...base, costo: "0.00", empaque: "0.00", envioAgencia: "0.00" })).toMatchObject({
      tipo: "ok",
      costoTotal: "0.00",
      ganancia: "75000.00",
    });
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
