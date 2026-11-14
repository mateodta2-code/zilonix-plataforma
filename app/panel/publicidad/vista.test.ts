import { describe, expect, it } from "vitest";
import type { CampanaCalculada } from "@/lib/publicidad/consultas";
import { NOTA_TACOS_PROMOCIONADAS, NOTA_UNIDADES, NOTA_VENTAS_ORGANICAS, NOTA_VENTAS_TOTALES } from "@/lib/publicidad/rotulos";

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
  ventasCantidad: null,
};

describe("textos del tablero de publicidad (issue #255)", () => {
  it("cada métrica sale una sola vez, con su nota y el sentido de la comparación", async () => {
    const { kpisDelResumen } = await import("./vista");
    const anterior = {
      ...vacio,
      gasto: "10.00",
      ventasPublicidad: "20.00",
      ventasOrganicas: "10.00",
      ventasTotales: "30.00",
      clicks: "2",
      impresiones: "8",
      cpc: "5.00",
      roas: "2.00",
      acos: "0.1000",
      tacos: "0.1000",
      unidadesVendidas: "1",
    };
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
          unidadesVendidas: "3",
        },
        anterior,
      },
    });
    const porClave = Object.fromEntries(kpis.map((kpi) => [kpi.clave, kpi]));
    expect(kpis.map((kpi) => kpi.titulo)).toEqual([
      "Ventas atribuidas",
      "Otras ventas",
      "ROAS",
      "Ingresos",
      "Inversión",
      "ACOS",
      "TACOS",
      "CPC promedio",
      "Clics",
      "Impresiones",
      "Unidades vendidas",
    ]);
    expect(new Set(kpis.map((kpi) => kpi.titulo)).size).toBe(kpis.length);
    expect(porClave.ingresos.detalle).toEqual([NOTA_VENTAS_TOTALES]);
    expect(porClave.otrasVentas.detalle).toEqual([NOTA_VENTAS_ORGANICAS]);
    expect(porClave.tacos.detalle).toEqual([NOTA_TACOS_PROMOCIONADAS]);
    expect(porClave.unidades.detalle).toEqual([NOTA_UNIDADES]);
    expect(porClave.ventasPublicidad).toBeUndefined();
    expect(porClave.ventasTotales).toBeUndefined();
    expect(porClave.ventasSinPublicidad).toBeUndefined();
    expect(porClave.otrasVentas.valor).toContain("15");
    expect(porClave.inversion.variacion.texto).toMatch(/^Sube .+ \(mejor\)$/);
    expect(porClave.inversion.variacion.mejor).toBe(true);
    expect(porClave.acos.variacion.texto).toMatch(/^Sube .+ \(peor\)$/);
    expect(porClave.acos.variacion.mejor).toBe(false);
    expect(porClave.tacos.variacion.mejor).toBe(false);
    expect(porClave.cpc.variacion.texto).toMatch(/^Baja .+ \(mejor\)$/);
    expect(porClave.cpc.variacion.mejor).toBe(true);
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
        ventasCantidad: "4",
      },
      totalesAnterior: {
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
        ventasCantidad: null,
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
  it("gasta sin vender se sigue viendo en ANTÁRTIDA y en aprendizaje, aunque ahí no se recomiende mover", async () => {
    const { pintarCampana } = await import("./vista");
    const anuncio = {
      id: "a1",
      adGroupId: "g1",
      itemId: "MCO1",
      titulo: "Producto",
      href: null,
      precio: null,
      estado: "active",
      sinStock: null,
      totales: { ...vacio, gasto: "10.00", ventasPublicidad: "0.00", ventasCantidad: "0" },
      semaforo: { estado: "neutro" as const, motivo: "sin_precio" as const },
    };
    const base = {
      id: "1",
      campanaIdMl: "c",
      estadoMl: "active",
      activa: true,
      roasObjetivo: "12.00",
      gasto: "10.00",
      ventasPublicidad: null,
      ventasTotales: null,
      roas: null,
      acos: null,
      tacos: null,
      cpc: null,
      clicks: null,
      impresiones: null,
      presupuestoDiario: null,
      totales: { ...vacio, gasto: "10.00" },
      totalesAnterior: vacio,
      anuncios: [anuncio],
      presupuestoAutomatico: false,
      diasAprendizaje: 7,
    };

    const normal = pintarCampana({ ...base, nombre: "Campaña 1", diagnostico: { tipo: "bajo_objetivo", dias: 0 } } as CampanaCalculada, 31);
    expect(normal.anuncios[0].sugerencia).toBe("Pasar a ENFRIAMIENTO");
    expect(normal.textoEnfriamiento).toBe("1 anuncio para pasar a ENFRIAMIENTO");

    const antartida = pintarCampana({ ...base, nombre: "Antártida", diagnostico: { tipo: "bajo_objetivo", dias: 0 } } as CampanaCalculada, 31);
    expect(antartida.anuncios[0].sugerencia).toBeNull();
    expect(antartida.anuncios[0].gastaSinVender).toBe(true);
    expect(antartida.anunciosSinVenta).toBe(1);

    const aprendiendo = pintarCampana({ ...base, nombre: "Campaña 2", diagnostico: { tipo: "aprendiendo", dias: 3 } } as CampanaCalculada, 31);
    expect(aprendiendo.recomendaciones.map((item) => item.codigo)).toEqual(["aprendizaje"]);
    expect(aprendiendo.anuncios[0].gastaSinVender).toBe(true);
    expect(aprendiendo.anunciosSinVenta).toBe(1);
  });
});
