import { describe, expect, it } from "vitest";
import { obtenerConfigPublicidad } from "@/lib/publicidad/config";
import {
  mostrarDineroTarjeta,
  mostrarEntero,
  mostrarFraccion,
  mostrarRoas,
} from "@/lib/publicidad/formato";
import {
  compararOrden,
  diagnosticarCampana,
  resolverDireccion,
  resolverOrden,
  resolverPeriodo,
  semaforoAnuncio,
  sumarEnteros,
  sumarMontos,
  tacosDeLaTienda,
  totalesDeDias,
  variacionPorcentual,
  type DiaMetrica,
  type FilaOrdenable,
} from "@/lib/publicidad/kpis";
import { hrefPublicidad, leerParametrosPublicidad } from "@/lib/publicidad/params";
import { NOTA_DIAGNOSTICO, rotuloDiagnostico, textoVariacion, tituloSemaforo } from "@/lib/publicidad/rotulos";

const DIA: DiaMetrica = {
  costo: null,
  montoTotal: null,
  ventasOrganicasMonto: null,
  clicks: null,
  impresiones: null,
};

function dia(parcial: Partial<DiaMetrica>): DiaMetrica {
  return { ...DIA, ...parcial };
}

const config = obtenerConfigPublicidad("empresa-de-prueba");

describe("sumas y ratios del rango", () => {
  it("suma montos y enteros, y un rango todo null no se vuelve 0", () => {
    expect(sumarMontos(["10.00", "2.50", null])).toBe("12.50");
    expect(sumarMontos([null, null])).toBeNull();
    expect(sumarMontos([])).toBeNull();
    expect(sumarEnteros([null, null])).toBeNull();
    expect(sumarEnteros([4, "6", null])).toBe("10");
    const vacio = totalesDeDias([dia({}), dia({})]);
    expect(vacio.gasto).toBeNull();
    expect(vacio.ventasPublicidad).toBeNull();
    expect(vacio.ventasTotales).toBeNull();
    expect(vacio.clicks).toBeNull();
    expect(vacio.roas).toBeNull();
  });

  it("CPC, ROAS, ACOS y TACOS salen de las sumas, y un denominador 0 es null", () => {
    const totales = totalesDeDias([
      dia({ costo: "10.00", montoTotal: "40.00", ventasOrganicasMonto: "10.00", clicks: 4, impresiones: 100 }),
    ]);
    expect(totales.cpc).toBe("2.50");
    expect(totales.roas).toBe("4.00");
    expect(totales.acos).toBe("0.2500");
    expect(totales.ventasOrganicas).toBe("10.00");
    expect(totales.ventasTotales).toBe("50.00");
    expect(totales.tacos).toBe("0.2000");
    expect(totales.ventasOrganicas).toBe(sumarMontos([totales.ventasTotales, `-${totales.ventasPublicidad}`]));

    const cero = totalesDeDias([dia({ costo: "0.00", montoTotal: "10.00", ventasOrganicasMonto: "0.00", clicks: 0, impresiones: 1 })]);
    expect(cero.roas).toBeNull();
    expect(cero.cpc).toBeNull();
    expect(cero.acos).toBe("0.0000");

    const sinVentas = totalesDeDias([dia({ costo: "10.00", montoTotal: "0.00", ventasOrganicasMonto: "0.00", clicks: 2, impresiones: 3 })]);
    expect(sinVentas.acos).toBeNull();
    expect(sinVentas.roas).toBe("0.00");
    expect(sinVentas.tacos).toBeNull();
  });

  it("no promedia los ratios diarios", () => {
    const dias = [
      dia({ costo: "10.00", montoTotal: "100.00", ventasOrganicasMonto: "0.00", clicks: 1, impresiones: 1 }),
      dia({ costo: "90.00", montoTotal: "90.00", ventasOrganicasMonto: "0.00", clicks: 1, impresiones: 1 }),
    ];
    const totales = totalesDeDias(dias);
    expect(totales.gasto).toBe("100.00");
    expect(totales.ventasPublicidad).toBe("190.00");
    expect(totales.roas).toBe("1.90");
    expect(totales.acos).toBe("0.5263");
  });

  it("el TACOS del rango no es el promedio del tacos de cada día", () => {
    const totales = totalesDeDias([
      dia({ costo: "10.00", montoTotal: "40.00", ventasOrganicasMonto: "60.00", clicks: 1, impresiones: 1 }),
      dia({ costo: "90.00", montoTotal: "10.00", ventasOrganicasMonto: "0.00", clicks: 1, impresiones: 1 }),
    ]);
    expect(totales.tacos).toBe("0.9091");
    expect(totales.tacos).not.toBe("4.5500");
  });

  it("la variación es null si el tramo anterior es 0 o no existe", () => {
    expect(variacionPorcentual("120.00", "100.00")).toBe("20.0");
    expect(variacionPorcentual("80.00", "100.00")).toBe("-20.0");
    expect(variacionPorcentual("10.00", "0.00")).toBeNull();
    expect(variacionPorcentual(null, "10.00")).toBeNull();
    expect(variacionPorcentual("10.00", null)).toBeNull();
    expect(textoVariacion(null)).toBe("Sin datos para comparar");
    expect(textoVariacion("12.3")).toBe("Sube 12,3 % frente al mismo tramo del mes anterior");
  });
});

describe("semáforo por anuncio", () => {
  it("con ventas, verde hasta 20 % de ACOS y rojo si lo pasa", () => {
    const bajo = semaforoAnuncio({ gasto: "10.00", ventasPublicidad: "100.00", precio: "50000.00", config });
    expect(bajo.estado).toBe("exito");
    expect(tituloSemaforo(bajo)).toBe("ACOS 10,0% ≤ tope 20%");

    const alto = semaforoAnuncio({ gasto: "274.00", ventasPublicidad: "1000.00", precio: "50000.00", config });
    expect(alto.estado).toBe("peligro");
    expect(tituloSemaforo(alto)).toBe("ACOS 27,4% > tope 20%");
  });

  it("sin ventas, compara el gasto contra el 5 % del precio", () => {
    const dentro = semaforoAnuncio({ gasto: "4000.00", ventasPublicidad: "0.00", precio: "100000.00", config });
    expect(dentro.estado).toBe("exito");
    expect(tituloSemaforo(dentro)).toBe("Gasto $ 4.000 ≤ 5% del precio ($ 100.000)");

    const fuera = semaforoAnuncio({ gasto: "6000.00", ventasPublicidad: null, precio: "100000.00", config });
    expect(fuera.estado).toBe("peligro");
    expect(tituloSemaforo(fuera)).toBe("Gasto $ 6.000 > 5% del precio ($ 100.000)");
  });

  it("sin precio o sin gasto queda en neutro", () => {
    const sinPrecio = semaforoAnuncio({ gasto: "1000.00", ventasPublicidad: "0.00", precio: null, config });
    expect(sinPrecio).toEqual({ estado: "neutro", motivo: "sin_precio" });
    expect(tituloSemaforo(sinPrecio)).toBe("Sin precio vigente");

    const sinGasto = semaforoAnuncio({ gasto: null, ventasPublicidad: null, precio: "100000.00", config });
    expect(sinGasto).toEqual({ estado: "neutro", motivo: "sin_gasto" });
    expect(tituloSemaforo(sinGasto)).toBe("Sin gasto en el rango");
  });
});

describe("diagnóstico de campaña", () => {
  const ahora = new Date("2026-10-29T15:00:00-05:00");
  const conGasto = totalesDeDias([
    dia({ costo: "100.00", montoTotal: "420.00", ventasOrganicasMonto: "0.00", clicks: 10, impresiones: 100 }),
  ]);

  it("a los 7 días justos ya no está aprendiendo", () => {
    const enElDia7 = diagnosticarCampana({
      ahora,
      creadaMlTs: new Date("2026-10-01T12:00:00-05:00"),
      actualizadaMlTs: new Date("2026-10-22T15:00:00-05:00"),
      roasObjetivo: "2.00",
      totales: conGasto,
      config,
    });
    expect(enElDia7.tipo).not.toBe("aprendiendo");
    expect(enElDia7.tipo).toBe("excelente");

    const todavia = diagnosticarCampana({
      ahora,
      creadaMlTs: new Date("2026-10-01T12:00:00-05:00"),
      actualizadaMlTs: new Date("2026-10-23T15:00:00-05:00"),
      roasObjetivo: "2.00",
      totales: conGasto,
      config,
    });
    expect(todavia).toEqual({ tipo: "aprendiendo", dias: 6 });
    expect(rotuloDiagnostico(todavia)).toBe("Aprendiendo · 6 días");
    expect(NOTA_DIAGNOSTICO.aprendiendo).toBe("No tocar, en aprendizaje");
    expect(NOTA_DIAGNOSTICO.excelente).toBe("No tocar, en revisión");
  });

  it("excelente, en objetivo y bajo objetivo comparan el ROAS real contra el objetivo", () => {
    const base = {
      ahora,
      creadaMlTs: new Date("2026-09-01T12:00:00-05:00"),
      actualizadaMlTs: new Date("2026-09-01T12:00:00-05:00"),
      config,
    };
    expect(
      diagnosticarCampana({ ...base, roasObjetivo: "2.00", totales: conGasto }).tipo
    ).toBe("excelente");
    const justo = totalesDeDias([
      dia({ costo: "100.00", montoTotal: "200.00", ventasOrganicasMonto: "0.00", clicks: 1, impresiones: 1 }),
    ]);
    expect(diagnosticarCampana({ ...base, roasObjetivo: "2.00", totales: justo }).tipo).toBe("en_objetivo");
    const bajo = totalesDeDias([
      dia({ costo: "100.00", montoTotal: "199.00", ventasOrganicasMonto: "0.00", clicks: 1, impresiones: 1 }),
    ]);
    expect(diagnosticarCampana({ ...base, roasObjetivo: "2.00", totales: bajo }).tipo).toBe("bajo_objetivo");
    expect(diagnosticarCampana({ ...base, roasObjetivo: null, totales: conGasto }).tipo).toBe("sin_objetivo");
  });

  it("sin gasto en el rango es sin datos, aunque haya objetivo", () => {
    const vacio = diagnosticarCampana({
      ahora,
      creadaMlTs: new Date("2026-09-01T12:00:00-05:00"),
      actualizadaMlTs: new Date("2026-09-01T12:00:00-05:00"),
      roasObjetivo: "4.00",
      totales: totalesDeDias([dia({ costo: "0.00", montoTotal: "0.00", ventasOrganicasMonto: "0.00", clicks: 0, impresiones: 0 })]),
      config,
    });
    expect(vacio.tipo).toBe("sin_datos");
    expect(rotuloDiagnostico(vacio)).toBe("Sin datos");
  });
});

describe("periodo en Bogotá", () => {
  it("el mes en curso va del día 1 a hoy y se compara con el mismo tramo", () => {
    const periodo = resolverPeriodo(null, new Date("2026-10-29T15:00:00-05:00"));
    expect(periodo).toMatchObject({
      mes: "2026-10",
      desde: "2026-10-01",
      hasta: "2026-10-29",
      comparacionDesde: "2026-09-01",
      comparacionHasta: "2026-09-29",
      incluyeHoy: true,
      esMesEnCurso: true,
    });
    expect(resolverPeriodo("2026-10", new Date("2026-10-01T08:00:00-05:00"))).toMatchObject({
      desde: "2026-10-01",
      hasta: "2026-10-01",
      comparacionDesde: "2026-09-01",
      comparacionHasta: "2026-09-01",
    });
  });

  it("un mes más corto corta la comparación en su último día, también al cruzar el año", () => {
    expect(resolverPeriodo(null, new Date("2026-03-31T12:00:00-05:00"))).toMatchObject({
      desde: "2026-03-01",
      hasta: "2026-03-31",
      comparacionDesde: "2026-02-01",
      comparacionHasta: "2026-02-28",
    });
    expect(resolverPeriodo(null, new Date("2024-03-31T12:00:00-05:00")).comparacionHasta).toBe("2024-02-29");
    expect(resolverPeriodo(null, new Date("2026-05-31T12:00:00-05:00")).comparacionHasta).toBe("2026-04-30");
    expect(resolverPeriodo(null, new Date("2026-01-15T12:00:00-05:00"))).toMatchObject({
      desde: "2026-01-01",
      hasta: "2026-01-15",
      comparacionDesde: "2025-12-01",
      comparacionHasta: "2025-12-15",
    });
  });

  it("el corte del día es el calendario de Bogotá, no el UTC del servidor", () => {
    expect(resolverPeriodo(null, new Date("2026-10-29T04:30:00Z")).hasta).toBe("2026-10-28");
    expect(resolverPeriodo(null, new Date("2026-10-29T05:00:00Z")).hasta).toBe("2026-10-29");
  });

  it("un mes ya cerrado se mira entero, y un valor inválido cae al mes en curso", () => {
    expect(resolverPeriodo("2026-09", new Date("2026-10-29T15:00:00-05:00"))).toMatchObject({
      mes: "2026-09",
      desde: "2026-09-01",
      hasta: "2026-09-30",
      comparacionDesde: "2026-08-01",
      comparacionHasta: "2026-08-30",
      incluyeHoy: false,
    });
    const ahora = new Date("2026-10-29T15:00:00-05:00");
    for (const invalido of ["no", "2026-13", "2026-00", "2026-10-01", "2026-12", "1999-01", ""]) {
      expect(resolverPeriodo(invalido, ahora).mes).toBe("2026-10");
    }
    expect(resolverPeriodo(undefined, ahora).esMesEnCurso).toBe(true);
  });
});

describe("orden y configuración", () => {
  it("la columna de la URL solo vale si está en la lista blanca", () => {
    expect(resolverOrden("roas")).toBe("roas");
    expect(resolverOrden("costo; drop table")).toBe("inversion");
    expect(resolverOrden(null)).toBe("inversion");
    expect(resolverDireccion(null, "inversion")).toBe("desc");
    expect(resolverDireccion("asc", "inversion")).toBe("asc");
    expect(resolverDireccion("lado", "campana")).toBe("asc");
    const leidos = leerParametrosPublicidad({ mes: "basura", orden: "acos", dir: "asc", pausadas: "1" }, new Date("2026-10-29T15:00:00-05:00"));
    expect(leidos.periodo.mes).toBe("2026-10");
    expect(leidos.orden).toBe("acos");
    expect(leidos.dir).toBe("asc");
    expect(leidos.incluirPausadas).toBe(true);
    expect(hrefPublicidad({ cuenta: "abc", orden: "inversion", dir: "desc" })).toBe("/panel/publicidad?cuenta=abc");
  });

  it("los vacíos van al final aunque el orden sea descendente", () => {
    const fila = (nombre: string, gasto: string | null): FilaOrdenable => ({
      nombre,
      gasto,
      ventasPublicidad: null,
      ventasTotales: null,
      roas: null,
      acos: null,
      tacos: null,
      cpc: null,
      clicks: null,
      impresiones: null,
      presupuestoDiario: null,
    });
    const filas = [fila("B", null), fila("A", "10.00"), fila("C", "30.00")];
    const ordenadas = [...filas].sort((a, b) => compararOrden(a, b, "inversion", "desc"));
    expect(ordenadas.map((f) => f.nombre)).toEqual(["C", "A", "B"]);
  });

  it("los overrides por empresa pisan el defecto y el TACOS de la tienda no se calcula", () => {
    expect(config.acosMaximo).toBe("0.20");
    expect(config.diasAprendizaje).toBe(7);
    expect(config.factorExcelente).toBe("1.2");
    const propia = obtenerConfigPublicidad("otra", { acosMaximo: "0.15" });
    expect(propia.acosMaximo).toBe("0.15");
    expect(propia.topeGastoSinVentas).toBe("0.05");
    expect(tacosDeLaTienda()).toBeNull();
  });
});

describe("formato es-CO", () => {
  it("dinero sin decimales en tarjeta, ROAS con x, porcentaje con 1 decimal y miles", () => {
    expect(mostrarDineroTarjeta("1234567.40")).toBe("$ 1.234.567");
    expect(mostrarDineroTarjeta(null)).toBe("—");
    expect(mostrarRoas("4.25")).toBe("4,25x");
    expect(mostrarRoas(null)).toBe("—");
    expect(mostrarFraccion("0.1840")).toBe("18,4 %");
    expect(mostrarEntero("1234567")).toBe("1.234.567");
    expect(mostrarEntero(null)).toBe("—");
  });
});
