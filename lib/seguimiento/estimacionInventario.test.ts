import { describe, expect, it } from "vitest";
import {
  compararProductoDiaADia,
  necesitaLecturaDePagina,
  resumenPeriodoConteo,
  resumenPeriodoVentas,
  type LecturaConteo,
  type LecturaProducto,
} from "./estimacionInventario";

// Issue #251 (revisión de Pablo) — un "YYYY-MM-DD" sin hora se arma a
// las 05:00 UTC (medianoche de Bogotá, UTC-5 fijo) para que coincida
// con lo que de verdad va a guardar seguimiento_fotos.fecha — un
// string CON hora (los `AHORA` de cada describe, con horario real)
// pasa tal cual.
const fecha = (iso: string): Date => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T05:00:00.000Z`) : new Date(iso));

describe("compararProductoDiaADia (issue #251, punto 8)", () => {
  it("caída de inventario normal -> ventas estimadas = la caída, nunca reposición", () => {
    const anterior: LecturaProducto = { fecha: fecha("2026-10-24"), inventario: 27, vendidosTexto: null };
    const actual: LecturaProducto = { fecha: fecha("2026-10-25"), inventario: 24, vendidosTexto: null };
    expect(compararProductoDiaADia(anterior, actual)).toEqual({
      ventasEstimadas: 3,
      reposicion: false,
      fechaAnterior: anterior.fecha,
      fechaActual: actual.fecha,
      etiqueta: "estimado",
    });
  });

  it("el inventario sube -> reposición, ventas estimadas en 0 (nunca una venta negativa)", () => {
    const anterior: LecturaProducto = { fecha: fecha("2026-10-24"), inventario: 10, vendidosTexto: null };
    const actual: LecturaProducto = { fecha: fecha("2026-10-25"), inventario: 40, vendidosTexto: null };
    const resultado = compararProductoDiaADia(anterior, actual);
    expect(resultado.reposicion).toBe(true);
    expect(resultado.ventasEstimadas).toBe(0);
  });

  it("sin inventario en ninguna de las dos puntas, usa '+N vendidos' como respaldo", () => {
    const anterior: LecturaProducto = { fecha: fecha("2026-10-24"), inventario: null, vendidosTexto: 50 };
    const actual: LecturaProducto = { fecha: fecha("2026-10-25"), inventario: null, vendidosTexto: 55 };
    const resultado = compararProductoDiaADia(anterior, actual);
    expect(resultado.ventasEstimadas).toBe(5);
    expect(resultado.reposicion).toBe(false);
  });

  it("el inventario gana siempre que esté en las dos puntas, nunca se mezcla con el texto de respaldo", () => {
    const anterior: LecturaProducto = { fecha: fecha("2026-10-24"), inventario: 20, vendidosTexto: 999 };
    const actual: LecturaProducto = { fecha: fecha("2026-10-25"), inventario: 18, vendidosTexto: 999 };
    expect(compararProductoDiaADia(anterior, actual).ventasEstimadas).toBe(2);
  });

  it("'+N vendidos' que baja (contador que nunca debería bajar) -> null, nunca una venta negativa inventada", () => {
    const anterior: LecturaProducto = { fecha: fecha("2026-10-24"), inventario: null, vendidosTexto: 60 };
    const actual: LecturaProducto = { fecha: fecha("2026-10-25"), inventario: null, vendidosTexto: 50 };
    const resultado = compararProductoDiaADia(anterior, actual);
    expect(resultado.ventasEstimadas).toBeNull();
    expect(resultado.reposicion).toBe(false);
  });

  it("sin ninguna señal usable en alguna de las dos puntas -> null", () => {
    const anterior: LecturaProducto = { fecha: fecha("2026-10-24"), inventario: null, vendidosTexto: null };
    const actual: LecturaProducto = { fecha: fecha("2026-10-25"), inventario: 10, vendidosTexto: null };
    expect(compararProductoDiaADia(anterior, actual).ventasEstimadas).toBeNull();
  });
});

describe("resumenPeriodoVentas (issue #251, puntos 12/14)", () => {
  const AHORA = fecha("2026-10-25T12:00:00.000Z");

  it("una sola lectura en la ventana -> null ('falta otra lectura para comparar')", () => {
    const lecturas: LecturaProducto[] = [{ fecha: fecha("2026-10-25"), inventario: 10, vendidosTexto: null }];
    expect(resumenPeriodoVentas(lecturas, 7, AHORA)).toBeNull();
  });

  it("sin ninguna lectura -> null", () => {
    expect(resumenPeriodoVentas([], 7, AHORA)).toBeNull();
  });

  it("7 días con lectura todos los días, sin reposición -> suma exacta y promedio sobre 7, cobertura 7/7", () => {
    // Caída de 2 por día, 7 lecturas (hoy + 6 atrás) -> 6 comparaciones, cada una de 2 = 12.
    const lecturas: LecturaProducto[] = [];
    for (let i = 6; i >= 0; i--) {
      lecturas.push({ fecha: fecha(`2026-10-${25 - i}`), inventario: 30 - (6 - i) * 2, vendidosTexto: null });
    }
    const resumen = resumenPeriodoVentas(lecturas, 7, AHORA);
    expect(resumen).not.toBeNull();
    expect(resumen?.ventasEstimadas).toBe(12);
    expect(resumen?.diasConLectura).toBe(7);
    expect(resumen?.diasPeriodo).toBe(7);
    expect(resumen?.promedioPorDia).toBeCloseTo(12 / 7, 1);
    expect(resumen?.etiqueta).toBe("estimado");
  });

  it("días faltantes (huecos sin lectura): compara solo entre las lecturas que SÍ existen, cobertura menor a diasPeriodo", () => {
    // Solo 3 lecturas reales dentro de una ventana de 7 días (faltan 4).
    const lecturas: LecturaProducto[] = [
      { fecha: fecha("2026-10-19"), inventario: 30, vendidosTexto: null },
      { fecha: fecha("2026-10-22"), inventario: 25, vendidosTexto: null },
      { fecha: fecha("2026-10-25"), inventario: 20, vendidosTexto: null },
    ];
    const resumen = resumenPeriodoVentas(lecturas, 7, AHORA);
    expect(resumen).not.toBeNull();
    expect(resumen?.ventasEstimadas).toBe(10); // (30-25) + (25-20)
    expect(resumen?.diasConLectura).toBe(3); // "3 de 7 días con lectura"
    expect(resumen?.diasPeriodo).toBe(7);
  });

  it("una reposición a mitad de la ventana no resta de las ventas reales (nunca cuenta como venta negativa)", () => {
    const lecturas: LecturaProducto[] = [
      { fecha: fecha("2026-10-23"), inventario: 10, vendidosTexto: null }, // vendió 5 desde el anterior implícito, no hay anterior así que arranca acá
      { fecha: fecha("2026-10-24"), inventario: 40, vendidosTexto: null }, // reposición, 0 ventas
      { fecha: fecha("2026-10-25"), inventario: 35, vendidosTexto: null }, // vendió 5
    ];
    const resumen = resumenPeriodoVentas(lecturas, 7, AHORA);
    expect(resumen?.ventasEstimadas).toBe(5); // 0 (reposición) + 5, nunca 10-35=-25 ni se descuenta la reposición
  });

  it("lecturas fuera de la ventana del período no entran en la cuenta", () => {
    const lecturas: LecturaProducto[] = [
      { fecha: fecha("2026-09-01"), inventario: 100, vendidosTexto: null }, // muy vieja, fuera de la ventana de 7 días
      { fecha: fecha("2026-10-24"), inventario: 20, vendidosTexto: null },
      { fecha: fecha("2026-10-25"), inventario: 18, vendidosTexto: null },
    ];
    const resumen = resumenPeriodoVentas(lecturas, 7, AHORA);
    expect(resumen?.ventasEstimadas).toBe(2);
    expect(resumen?.diasConLectura).toBe(2);
  });

  it("ayer contra hoy es el mismo mecanismo con diasPeriodo=1", () => {
    const lecturas: LecturaProducto[] = [
      { fecha: fecha("2026-10-24"), inventario: 27, vendidosTexto: null },
      { fecha: fecha("2026-10-25"), inventario: 24, vendidosTexto: null },
    ];
    const resumen = resumenPeriodoVentas(lecturas, 1, AHORA);
    expect(resumen?.ventasEstimadas).toBe(3);
    expect(resumen?.promedioPorDia).toBe(3);
  });
});

describe("resumenPeriodoConteo (issue #251, punto 13 — publicaciones de tienda)", () => {
  const AHORA = fecha("2026-10-25T12:00:00.000Z");

  it("una sola lectura -> null", () => {
    expect(resumenPeriodoConteo([{ fecha: fecha("2026-10-25"), valor: 50 }], 7, AHORA)).toBeNull();
  });

  it("el total de publicaciones subió -> diferencia positiva (nunca tratada como 'reposición')", () => {
    const lecturas: LecturaConteo[] = [
      { fecha: fecha("2026-10-20"), valor: 50 },
      { fecha: fecha("2026-10-25"), valor: 58 },
    ];
    const resumen = resumenPeriodoConteo(lecturas, 7, AHORA);
    expect(resumen?.diferencia).toBe(8);
    expect(resumen?.diasConLectura).toBe(2);
  });

  it("el total de publicaciones bajó -> diferencia negativa, nunca forzada a 0", () => {
    const lecturas: LecturaConteo[] = [
      { fecha: fecha("2026-10-20"), valor: 60 },
      { fecha: fecha("2026-10-25"), valor: 55 },
    ];
    expect(resumenPeriodoConteo(lecturas, 7, AHORA)?.diferencia).toBe(-5);
  });

  it("con lecturas intermedias, usa la más vieja y la más nueva de la ventana (telescopa, nunca suma de más)", () => {
    const lecturas: LecturaConteo[] = [
      { fecha: fecha("2026-10-20"), valor: 50 },
      { fecha: fecha("2026-10-22"), valor: 70 },
      { fecha: fecha("2026-10-23"), valor: 40 },
      { fecha: fecha("2026-10-25"), valor: 45 },
    ];
    expect(resumenPeriodoConteo(lecturas, 7, AHORA)?.diferencia).toBe(-5); // 45 - 50, nunca (70-50)+(40-70)+(45-40) sumado aparte (da lo mismo, pero no por casualidad)
  });
});

describe("necesitaLecturaDePagina (issue #251, punto 10 — aviso de actualización)", () => {
  const AHORA = fecha("2026-10-25T15:00:00.000Z");
  const HOY = fecha("2026-10-25");
  const AYER = fecha("2026-10-24");

  it("nunca aplica a un seguimiento propio (esCompetidor=false), aunque falte todo el dato", () => {
    expect(
      necesitaLecturaDePagina({ esCompetidor: false, tipo: "producto", ultimaFoto: null, ahora: AHORA })
    ).toBe(false);
  });

  it("sin ninguna foto todavía -> necesita lectura", () => {
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "producto", ultimaFoto: null, ahora: AHORA })).toBe(true);
  });

  it("la foto más reciente es de ayer, no de hoy -> necesita lectura", () => {
    const ultimaFoto = { fecha: AYER, inventarioDisponible: 10, vendidos: 50, publicaciones: null };
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "producto", ultimaFoto, ahora: AHORA })).toBe(true);
  });

  it("producto competidor con foto de hoy pero sin inventario ni vendidos -> necesita lectura", () => {
    const ultimaFoto = { fecha: HOY, inventarioDisponible: null, vendidos: null, publicaciones: null };
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "producto", ultimaFoto, ahora: AHORA })).toBe(true);
  });

  it("producto competidor con foto de hoy y AL MENOS uno de los dos (inventario o vendidos) -> ya no necesita lectura", () => {
    const soloInventario = { fecha: HOY, inventarioDisponible: 10, vendidos: null, publicaciones: null };
    const soloVendidos = { fecha: HOY, inventarioDisponible: null, vendidos: 50, publicaciones: null };
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "producto", ultimaFoto: soloInventario, ahora: AHORA })).toBe(false);
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "producto", ultimaFoto: soloVendidos, ahora: AHORA })).toBe(false);
  });

  it("tienda competidora con foto de hoy pero sin total real (null, o visibles sin total) -> necesita lectura", () => {
    const sinDato = { fecha: HOY, inventarioDisponible: null, vendidos: null, publicaciones: null };
    const sinTotal = { fecha: HOY, inventarioDisponible: null, vendidos: null, publicaciones: { total: null, visibles: [] } };
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "tienda", ultimaFoto: sinDato, ahora: AHORA })).toBe(true);
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "tienda", ultimaFoto: sinTotal, ahora: AHORA })).toBe(true);
  });

  it("tienda competidora con foto de hoy y el total real -> ya no necesita lectura", () => {
    const conDato = {
      fecha: HOY,
      inventarioDisponible: null,
      vendidos: null,
      publicaciones: { total: 752, visibles: [{ itemId: "MCO1", titulo: "x", precio: null }] },
    };
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "tienda", ultimaFoto: conDato, ahora: AHORA })).toBe(false);
  });
});
