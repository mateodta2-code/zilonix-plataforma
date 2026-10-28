import { describe, expect, it } from "vitest";
import {
  calcularComparativaAyerHoy,
  compararProductoDiaADia,
  necesitaLecturaDePagina,
  resumenPeriodoConteo,
  resumenPeriodoVentas,
  type LecturaConteo,
  type LecturaProducto,
} from "./estimacionInventario";

// Corrección de Pablo (sobre la revisión anterior) — un "YYYY-MM-DD"
// sin hora se arma a las 00:00 UTC (NO 05:00 UTC): `fechaDiaBogota`
// (lib/filtros-listado.ts) resuelve el día calendario real de Bogotá,
// pero lo representa como medianoche UTC de ESE día — la misma
// convención que ya usan las filas existentes de seguimiento_fotos.fecha
// desde antes de que existiera esta cuenta de huso horario. Un string
// CON hora (los `AHORA` de cada describe, con horario real) pasa tal
// cual.
const fecha = (iso: string): Date => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00.000Z`) : new Date(iso));

// Issue #251 (corrección de Pablo, punto 9) — `aproximado` ahora es
// obligatorio en LecturaProducto; este helper evita repetir
// `aproximado: false` en cada lectura de los tests que no están
// probando específicamente ese campo.
function lectura(parcial: Partial<LecturaProducto> & { fecha: Date }): LecturaProducto {
  return { inventario: null, aproximado: false, vendidosTexto: null, vendidosTextoAproximado: false, ...parcial };
}

describe("compararProductoDiaADia (issue #251, punto 8)", () => {
  it("caída de inventario normal -> ventas estimadas = la caída, nunca reposición", () => {
    const anterior = lectura({ fecha: fecha("2026-10-24"), inventario: 27 });
    const actual = lectura({ fecha: fecha("2026-10-25"), inventario: 24 });
    expect(compararProductoDiaADia(anterior, actual)).toEqual({
      ventasEstimadas: 3,
      reposicion: false,
      fechaAnterior: anterior.fecha,
      fechaActual: actual.fecha,
      etiqueta: "estimado",
    });
  });

  it("el inventario sube -> reposición, ventas estimadas en 0 (nunca una venta negativa)", () => {
    const anterior = lectura({ fecha: fecha("2026-10-24"), inventario: 10 });
    const actual = lectura({ fecha: fecha("2026-10-25"), inventario: 40 });
    const resultado = compararProductoDiaADia(anterior, actual);
    expect(resultado.reposicion).toBe(true);
    expect(resultado.ventasEstimadas).toBe(0);
  });

  it("sin inventario en ninguna de las dos puntas, usa '+N vendidos' aproximado como respaldo (las dos puntas aproximadas)", () => {
    const anterior = lectura({ fecha: fecha("2026-10-24"), vendidosTexto: 50, vendidosTextoAproximado: true });
    const actual = lectura({ fecha: fecha("2026-10-25"), vendidosTexto: 55, vendidosTextoAproximado: true });
    const resultado = compararProductoDiaADia(anterior, actual);
    expect(resultado.ventasEstimadas).toBe(5);
    expect(resultado.reposicion).toBe(false);
  });

  it("sin inventario en ninguna de las dos puntas, pero las dos con el número EXACTO de vendidos: también se restan", () => {
    const anterior = lectura({ fecha: fecha("2026-10-24"), vendidosTexto: 500 });
    const actual = lectura({ fecha: fecha("2026-10-25"), vendidosTexto: 523 });
    expect(compararProductoDiaADia(anterior, actual).ventasEstimadas).toBe(23);
  });

  // Issue #252 (revisión de Pablo, punto 7) — bug real: un "+520"
  // aproximado de hoy contra un 500 EXACTO de ayer se restaba igual,
  // como si las dos puntas fueran igual de confiables.
  it("una punta con el número exacto y la otra con el piso '+N' aproximado: null, nunca se mezclan", () => {
    const anteriorExacta = lectura({ fecha: fecha("2026-10-24"), vendidosTexto: 500 });
    const actualAproximada = lectura({ fecha: fecha("2026-10-25"), vendidosTexto: 520, vendidosTextoAproximado: true });
    expect(compararProductoDiaADia(anteriorExacta, actualAproximada).ventasEstimadas).toBeNull();

    const anteriorAproximada = lectura({ fecha: fecha("2026-10-24"), vendidosTexto: 500, vendidosTextoAproximado: true });
    const actualExacta = lectura({ fecha: fecha("2026-10-25"), vendidosTexto: 523 });
    expect(compararProductoDiaADia(anteriorAproximada, actualExacta).ventasEstimadas).toBeNull();
  });

  it("el inventario gana siempre que esté en las dos puntas, nunca se mezcla con el texto de respaldo", () => {
    const anterior = lectura({ fecha: fecha("2026-10-24"), inventario: 20, vendidosTexto: 999 });
    const actual = lectura({ fecha: fecha("2026-10-25"), inventario: 18, vendidosTexto: 999 });
    expect(compararProductoDiaADia(anterior, actual).ventasEstimadas).toBe(2);
  });

  it("'+N vendidos' que baja (contador que nunca debería bajar) -> null, nunca una venta negativa inventada", () => {
    const anterior = lectura({ fecha: fecha("2026-10-24"), vendidosTexto: 60, vendidosTextoAproximado: true });
    const actual = lectura({ fecha: fecha("2026-10-25"), vendidosTexto: 50, vendidosTextoAproximado: true });
    const resultado = compararProductoDiaADia(anterior, actual);
    expect(resultado.ventasEstimadas).toBeNull();
    expect(resultado.reposicion).toBe(false);
  });

  it("sin ninguna señal usable en alguna de las dos puntas -> null", () => {
    const anterior = lectura({ fecha: fecha("2026-10-24") });
    const actual = lectura({ fecha: fecha("2026-10-25"), inventario: 10 });
    expect(compararProductoDiaADia(anterior, actual).ventasEstimadas).toBeNull();
  });

  // Issue #251 (corrección de Pablo, punto 9) — bug real: un "+10
  // disponibles" (inventarioAproximado) no es un número exacto, restar
  // dos aproximados (o uno aproximado contra uno exacto) podía inventar
  // una caída que nunca pasó.
  it("inventario aproximado en CUALQUIERA de las dos puntas: nunca resta inventario, cae al respaldo de texto si existe", () => {
    const anteriorAprox = lectura({ fecha: fecha("2026-10-24"), inventario: 27, aproximado: true, vendidosTexto: 100 });
    const actualExacto = lectura({ fecha: fecha("2026-10-25"), inventario: 24, vendidosTexto: 105 });
    expect(compararProductoDiaADia(anteriorAprox, actualExacto).ventasEstimadas).toBe(5); // 105-100, nunca 27-24=3

    const actualAprox = lectura({ fecha: fecha("2026-10-25"), inventario: 24, aproximado: true });
    expect(compararProductoDiaADia(lectura({ fecha: fecha("2026-10-24"), inventario: 27 }), actualAprox).ventasEstimadas).toBeNull(); // sin respaldo de texto -> null, nunca 3
  });
});

describe("resumenPeriodoVentas (issue #251, puntos 12/14)", () => {
  const AHORA = fecha("2026-10-25T12:00:00.000Z");

  it("una sola lectura en la ventana -> null ('falta otra lectura para comparar')", () => {
    const lecturas: LecturaProducto[] = [lectura({ fecha: fecha("2026-10-25"), inventario: 10 })];
    expect(resumenPeriodoVentas(lecturas, 7, AHORA)).toBeNull();
  });

  it("sin ninguna lectura -> null", () => {
    expect(resumenPeriodoVentas([], 7, AHORA)).toBeNull();
  });

  it("7 días con lectura todos los días, sin reposición -> suma exacta y promedio sobre 7, cobertura 7/7", () => {
    // Caída de 2 por día, 7 lecturas (hoy + 6 atrás) -> 6 comparaciones, cada una de 2 = 12.
    const lecturas: LecturaProducto[] = [];
    for (let i = 6; i >= 0; i--) {
      lecturas.push(lectura({ fecha: fecha(`2026-10-${25 - i}`), inventario: 30 - (6 - i) * 2 }));
    }
    const resumen = resumenPeriodoVentas(lecturas, 7, AHORA);
    expect(resumen).not.toBeNull();
    expect(resumen?.ventasEstimadas).toBe(12);
    expect(resumen?.diasConLectura).toBe(7);
    expect(resumen?.diasPeriodo).toBe(7);
    expect(resumen?.promedioPorDia).toBeCloseTo(12 / 7, 1);
    expect(resumen?.etiqueta).toBe("estimado");
  });

  // Issue #251 (corrección de Pablo, punto 9) — bug real: antes la
  // ventana de "últimos 7 días" en realidad abarcaba 8 días calendario
  // (hoy hasta hoy-7, inclusive en las dos puntas) — un día de más que
  // nadie pidió. Ahora [hoy-6, hoy] son exactamente 7 días. Oct-18 cae
  // JUSTO en el día que la ventana vieja incluía de más.
  it("ventana de 7 días es EXACTAMENTE 7 días calendario contando hoy — una lectura de hace 8 días (antes incluida) ya no entra", () => {
    const lecturas: LecturaProducto[] = [
      lectura({ fecha: fecha("2026-10-18"), inventario: 100 }), // hoy(2026-10-25) - 7 días: fuera de [hoy-6, hoy]
      lectura({ fecha: fecha("2026-10-19"), inventario: 30 }), // hoy - 6: el borde real de la ventana nueva
      lectura({ fecha: fecha("2026-10-25"), inventario: 24 }),
    ];
    const resumen = resumenPeriodoVentas(lecturas, 7, AHORA);
    expect(resumen?.diasConLectura).toBe(2); // solo Oct-19 y Oct-25 — Oct-18 queda afuera
    expect(resumen?.ventasEstimadas).toBe(6); // 30 - 24, nunca 100 - 24 = 76
  });

  it("días faltantes (huecos sin lectura): compara solo entre las lecturas que SÍ existen, cobertura menor a diasPeriodo", () => {
    // Solo 3 lecturas reales dentro de una ventana de 7 días (faltan 4).
    const lecturas: LecturaProducto[] = [
      lectura({ fecha: fecha("2026-10-19"), inventario: 30 }),
      lectura({ fecha: fecha("2026-10-22"), inventario: 25 }),
      lectura({ fecha: fecha("2026-10-25"), inventario: 20 }),
    ];
    const resumen = resumenPeriodoVentas(lecturas, 7, AHORA);
    expect(resumen).not.toBeNull();
    expect(resumen?.ventasEstimadas).toBe(10); // (30-25) + (25-20)
    expect(resumen?.diasConLectura).toBe(3); // "3 de 7 días con lectura"
    expect(resumen?.diasPeriodo).toBe(7);
  });

  it("una reposición a mitad de la ventana no resta de las ventas reales (nunca cuenta como venta negativa)", () => {
    const lecturas: LecturaProducto[] = [
      lectura({ fecha: fecha("2026-10-23"), inventario: 10 }), // vendió 5 desde el anterior implícito, no hay anterior así que arranca acá
      lectura({ fecha: fecha("2026-10-24"), inventario: 40 }), // reposición, 0 ventas
      lectura({ fecha: fecha("2026-10-25"), inventario: 35 }), // vendió 5
    ];
    const resumen = resumenPeriodoVentas(lecturas, 7, AHORA);
    expect(resumen?.ventasEstimadas).toBe(5); // 0 (reposición) + 5, nunca 10-35=-25 ni se descuenta la reposición
  });

  it("lecturas fuera de la ventana del período no entran en la cuenta", () => {
    const lecturas: LecturaProducto[] = [
      lectura({ fecha: fecha("2026-09-01"), inventario: 100 }), // muy vieja, fuera de la ventana de 7 días
      lectura({ fecha: fecha("2026-10-24"), inventario: 20 }),
      lectura({ fecha: fecha("2026-10-25"), inventario: 18 }),
    ];
    const resumen = resumenPeriodoVentas(lecturas, 7, AHORA);
    expect(resumen?.ventasEstimadas).toBe(2);
    expect(resumen?.diasConLectura).toBe(2);
  });
});

// Issue #251 (corrección de Pablo, punto 9) — "Ayer vs hoy" dejó de
// usar resumenPeriodoVentas(lecturas, 1, ahora) (con la ventana ya
// corregida arriba, diasPeriodo=1 da una ventana de UN solo día — ya
// no sirve para comparar dos) — ahora es calcularComparativaAyerHoy,
// con su propio chequeo estricto de "existe foto de HOY y de AYER,
// las dos con inventario".
describe("calcularComparativaAyerHoy (issue #251, punto 9 — corrección de Pablo)", () => {
  const AHORA = fecha("2026-10-25T12:00:00.000Z");

  it("hay foto de hoy y de ayer, las dos con inventario: compara normal", () => {
    const lecturas: LecturaProducto[] = [lectura({ fecha: fecha("2026-10-24"), inventario: 27 }), lectura({ fecha: fecha("2026-10-25"), inventario: 24 })];
    const resultado = calcularComparativaAyerHoy(lecturas, AHORA);
    expect(resultado?.ventasEstimadas).toBe(3);
  });

  it("falta la foto de HOY -> null ('Falta lectura de hoy o de ayer')", () => {
    const lecturas: LecturaProducto[] = [lectura({ fecha: fecha("2026-10-23"), inventario: 27 }), lectura({ fecha: fecha("2026-10-24"), inventario: 24 })];
    expect(calcularComparativaAyerHoy(lecturas, AHORA)).toBeNull();
  });

  it("falta la foto de AYER (hay un hueco) -> null, nunca usa una lectura más vieja en su lugar", () => {
    const lecturas: LecturaProducto[] = [lectura({ fecha: fecha("2026-10-20"), inventario: 27 }), lectura({ fecha: fecha("2026-10-25"), inventario: 24 })];
    expect(calcularComparativaAyerHoy(lecturas, AHORA)).toBeNull();
  });

  it("hoy y ayer existen pero sin inventario en alguna de las dos -> null, nunca cae al respaldo de '+N vendidos' para esta tarjeta", () => {
    const lecturas: LecturaProducto[] = [
      lectura({ fecha: fecha("2026-10-24"), vendidosTexto: 50 }), // sin inventario
      lectura({ fecha: fecha("2026-10-25"), inventario: 24, vendidosTexto: 55 }),
    ];
    expect(calcularComparativaAyerHoy(lecturas, AHORA)).toBeNull();
  });

  it("sin ninguna lectura -> null", () => {
    expect(calcularComparativaAyerHoy([], AHORA)).toBeNull();
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

  // Issue #251 (corrección de Pablo, punto 9) — mismo ajuste de
  // ventana que resumenPeriodoVentas: [hoy-6, hoy] son 7 días reales,
  // nunca 8.
  it("ventana de 7 días es EXACTAMENTE 7 días calendario — una lectura de hace 8 días (antes incluida) ya no entra", () => {
    const lecturas: LecturaConteo[] = [
      { fecha: fecha("2026-10-18"), valor: 100 }, // hoy - 7: fuera de [hoy-6, hoy]
      { fecha: fecha("2026-10-19"), valor: 50 }, // hoy - 6: el borde real de la ventana nueva
      { fecha: fecha("2026-10-25"), valor: 58 },
    ];
    expect(resumenPeriodoConteo(lecturas, 7, AHORA)?.diferencia).toBe(8); // 58 - 50, nunca 58 - 100 = -42
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

  // Issue #252 (revisión de Pablo, punto 6) — bug real: con SOLO el
  // piso "+N (aproximado)" guardado hoy, esto decía "necesita lectura"
  // igual — el aviso "Actualiza hoy para ver cuánto vendieron"
  // aparecía al lado del "+N (aproximado)" que ya se estaba mostrando.
  it("producto competidor con foto de hoy, sin inventario ni vendidos exacto, pero CON el piso '+N' aproximado -> ya no necesita lectura", () => {
    const ultimaFoto = { fecha: HOY, inventarioDisponible: null, vendidos: null, publicaciones: null, vendidosAproximado: 520 };
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "producto", ultimaFoto, ahora: AHORA })).toBe(false);
  });

  it("vendidosAproximado en null (o sin mandarlo, un llamador viejo) se trata igual que 'sin dato' -> sigue necesitando lectura", () => {
    const sinAproximado = { fecha: HOY, inventarioDisponible: null, vendidos: null, publicaciones: null, vendidosAproximado: null };
    const sinElCampo = { fecha: HOY, inventarioDisponible: null, vendidos: null, publicaciones: null };
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "producto", ultimaFoto: sinAproximado, ahora: AHORA })).toBe(true);
    expect(necesitaLecturaDePagina({ esCompetidor: true, tipo: "producto", ultimaFoto: sinElCampo, ahora: AHORA })).toBe(true);
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
