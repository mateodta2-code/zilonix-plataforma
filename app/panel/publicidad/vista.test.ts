import { describe, expect, it } from "vitest";
import type { CampanaCalculada } from "@/lib/publicidad/consultas";
import { NOTA_VENTAS_ORGANICAS, NOTA_VENTAS_TOTALES } from "@/lib/publicidad/rotulos";

// vista.ts importa consultas, y consultas importa la conexión. El
// cliente no abre el socket hasta la primera consulta; esta URL no se
// usa. Hace falta que exista antes del import dinámico.
process.env.DATABASE_URL_APP ??= "postgresql://app_user:no-es-real@127.0.0.1:1/no";

const vacio = {
  gasto: null,
  ventasPublicidad: null,
  ventasOrganicas: null,
  ventasTotales: null,
  clicks: null,
  impresiones: null,
  cpc: null,
  roas: null,
  acos: null,
  tacos: null,
  unidadesVendidas: null,
};

describe("textos del tablero de publicidad (issue #255)", () => {
  it("ventas totales describe la suma, y ventas sin publicidad es una tarjeta", async () => {
    const { kpisDelResumen } = await import("./vista");
    const kpis = kpisDelResumen({
      resumen: {
        actual: {
          ...vacio,
          gasto: "10.50",
          ventasPublicidad: "40.20",
          ventasOrganicas: "15.40",
          ventasTotales: "55.60",
          clicks: "4",
          impresiones: "10",
          cpc: "2.63",
          roas: "3.83",
          acos: "0.2612",
          tacos: "0.1888",
        },
        anterior: vacio,
      },
    });
    const porClave = Object.fromEntries(kpis.map((kpi) => [kpi.clave, kpi]));
    expect(porClave.ventasTotales.detalle).toEqual([NOTA_VENTAS_TOTALES]);
    expect(porClave.ventasSinPublicidad.detalle).toEqual([NOTA_VENTAS_ORGANICAS]);
    expect(porClave.ventasSinPublicidad.titulo).toBe("Ventas sin publicidad");
    expect(porClave.ventasSinPublicidad.valor).toBe("$ 15");
    expect(NOTA_VENTAS_TOTALES).toMatch(/clic más las que no/);
    expect(NOTA_VENTAS_TOTALES).not.toMatch(/no vinieron de un clic/);
  });

  it("la fila de campaña redondea la plata sin decimales y baja el objetivo de ROAS", async () => {
    const { pintarCampana } = await import("./vista");
    const campana: CampanaCalculada = {
      id: "1",
      campanaIdMl: "c",
      nombre: "vendidos 06-08",
      estadoMl: "active",
      activa: true,
      roasObjetivo: "12.00",
      diagnostico: { tipo: "bajo_objetivo", dias: 0 },
      gasto: "447108.61",
      ventasPublicidad: "4403659.40",
      ventasTotales: "5127743.20",
      roas: "9.85",
      acos: "0.1020",
      tacos: "0.0870",
      cpc: "338.98",
      clicks: "1319",
      impresiones: "400756",
      presupuestoDiario: "50000.40",
      totales: {
        gasto: "447108.61",
        ventasPublicidad: "4403659.40",
        ventasOrganicas: "724083.80",
        ventasTotales: "5127743.20",
        clicks: "1319",
        impresiones: "400756",
        cpc: "338.98",
        roas: "9.85",
        acos: "0.1020",
        tacos: "0.0870",
        unidadesVendidas: "12",
      },
      anuncios: [],
      presupuestoAutomatico: false,
      diasAprendizaje: 7,
    };
    const pintada = pintarCampana(campana, 31);
    expect(pintada.inversion).toBe("$447.109");
    expect(pintada.cpc).toBe("$339");
    expect(pintada.roas).toBe("9,85x");
    expect(pintada.roasObjetivo).toBe("objetivo 12,00x");
    expect(pintada.estadoFrase).toBe("Debajo del objetivo, falta 18 %");
    expect(pintada.ventasSinPublicidad).toBe("$724.084");
    expect(pintada.unidades).toBe("12");
  });
});
