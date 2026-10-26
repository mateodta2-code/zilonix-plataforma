import { describe, expect, it } from "vitest";
import { acosDesdeRoas, filasDiariasDeCuenta, metricasDesdeApi } from "./metricas";

describe("métricas de Product Ads (issue #254)", () => {
  it("lee el ejemplo de F1 (métricas anidadas y números JSON) sin float", () => {
    const fila = metricasDesdeApi({
      metrics: {
        clicks: 3,
        prints: 11,
        cost: 1.005,
        cpc: 8.52,
        total_amount: 3992.0,
        direct_amount: 3992.0,
        indirect_amount: 0,
        acos: 12.345,
        roas: 156.06,
        tacos: 1.2,
      },
    });
    expect(fila.clicks).toBe(3);
    expect(fila.impresiones).toBe(11);
    expect(fila.costo).toBe("1.01");
    expect(fila.acos).toBe("12.3450");
    expect(fila.montoTotal).toBe("3992.00");
    expect(fila.cpc).toBe("8.52");
    expect(fila.tacos).toBe("1.2000");
  });

  it("acepta los nombres en mayúsculas del ejemplo de ad groups", () => {
    const fila = metricasDesdeApi({ metrics: { CLICKS: 1, PRINTS: 2, COST: 3, TACOS: 4 } });
    expect(fila.clicks).toBe(1);
    expect(fila.impresiones).toBe(2);
    expect(fila.costo).toBe("3.00");
    expect(fila.tacos).toBe("4.0000");
  });

  it("calcula acos = 100 / roas cuando la API ya no manda acos_target", () => {
    expect(acosDesdeRoas("4.00")).toBe("25.0000");
    expect(acosDesdeRoas("2")).toBe("50.0000");
    expect(acosDesdeRoas("0")).toBeNull();
  });

  it("no guarda el total de cuenta si DAILY repite la fecha sin id", () => {
    const { filas, ambiguo } = filasDiariasDeCuenta([
      { date: "2024-01-01", clicks: 1, cost: 0.01 },
      { date: "2024-01-01", clicks: 2, cost: 0.02 },
    ]);
    expect(ambiguo).toBe(true);
    expect(filas).toEqual([]);
  });

  it("una fila por fecha sin id sí es el total de cuenta", () => {
    const { filas, ambiguo } = filasDiariasDeCuenta([{ date: "2024-01-01", clicks: 4, cost: 1 }]);
    expect(ambiguo).toBe(false);
    expect(filas).toHaveLength(1);
    expect(filas[0].fecha).toBe("2024-01-01");
    expect(filas[0].entidadIdMl).toBeNull();
    expect(filas[0].metricas.clicks).toBe(4);
  });
});
