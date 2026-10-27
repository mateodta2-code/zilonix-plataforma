import { describe, expect, it } from "vitest";
import {
  antiguedadDias,
  antiguedadDiasPorId,
  facturacionMes,
  FACTOR_VENDIDOS_FULL,
  FACTOR_VENDIDOS_SIN_FULL,
  ventasMes,
  vendidosEstimados,
  type PuntoCalibracionId,
} from "./aproximados";

const UN_DIA_MS = 24 * 60 * 60 * 1000;

describe("vendidosEstimados — issue #251, punto 1", () => {
  it("dato exacto: se usa tal cual, nunca se multiplica", () => {
    expect(vendidosEstimados(537, { exacto: true, esFull: true })).toBe(537);
    expect(vendidosEstimados(537, { exacto: true, esFull: false })).toBe(537);
  });

  // Caso real de referencia (Selltrix): "+100 vendidos" Full -> 220.
  it('"+N vendidos" Full: N × 2.2 (caso real de referencia, "+100" -> 220)', () => {
    expect(vendidosEstimados(100, { exacto: false, esFull: true })).toBeCloseTo(100 * FACTOR_VENDIDOS_FULL, 9);
    expect(vendidosEstimados(100, { exacto: false, esFull: true })).toBeCloseTo(220, 9);
  });

  it('"+N vendidos" sin Full: N × 1.55', () => {
    expect(vendidosEstimados(100, { exacto: false, esFull: false })).toBeCloseTo(100 * FACTOR_VENDIDOS_SIN_FULL, 9);
    expect(vendidosEstimados(100, { exacto: false, esFull: false })).toBeCloseTo(155, 9);
  });

  it("sin dato de vendidos -> null, nunca 0 inventado", () => {
    expect(vendidosEstimados(null, { exacto: false, esFull: true })).toBeNull();
  });

  it("un vendidos negativo (dato dudoso) -> null, nunca se multiplica igual", () => {
    expect(vendidosEstimados(-5, { exacto: false, esFull: true })).toBeNull();
  });
});

describe("antiguedadDiasPorId — issue #251, punto 2 (respaldo sin date_created)", () => {
  const puntos: PuntoCalibracionId[] = [
    { id: "MCO1000000000", tipo: "item", fecha: new Date("2024-01-01T05:00:00.000Z") },
    { id: "MCO1100000000", tipo: "item", fecha: new Date("2025-01-01T05:00:00.000Z") },
  ];

  it("interpola linealmente un id que cae ENTRE dos puntos calibrados", () => {
    const ahora = new Date("2025-01-01T05:00:00.000Z");
    // Punto medio exacto entre los dos ids -> fecha interpolada exacta
    // a medio camino entre las dos fechas (2024-07-02 aprox) -> ~183
    // días antes de "ahora".
    const idMedio = "MCO1050000000";
    const dias = antiguedadDiasPorId(idMedio, "item", ahora, puntos);
    expect(dias).not.toBeNull();
    expect(dias!).toBeGreaterThan(180);
    expect(dias!).toBeLessThan(186);
  });

  it("extrapola con la pendiente de los 2 puntos más cercanos cuando el id cae FUERA del rango calibrado", () => {
    // 100M más que el punto más alto -> misma distancia que entre los 2
    // puntos calibrados -> la fecha interpolada cae ~1 año después del
    // punto más alto (2025-01-01), aprox. 2026-01-01/02 (el salto real
    // en ms es el mismo que 2024->2025, que incluye el 29 de febrero).
    // "ahora" bien más adelante (2027) para no depender de ese ajuste
    // fino de un día por el año bisiesto.
    const ahora = new Date("2027-01-01T05:00:00.000Z");
    const idMasNuevo = "MCO1200000000";
    const dias = antiguedadDiasPorId(idMasNuevo, "item", ahora, puntos);
    expect(dias).not.toBeNull();
    expect(dias!).toBeGreaterThan(300);
    expect(dias!).toBeLessThan(370);
  });

  it("nunca mezcla ids de países distintos (MLA no calibra con puntos MCO)", () => {
    const ahora = new Date("2025-06-01T05:00:00.000Z");
    expect(antiguedadDiasPorId("MLA1050000000", "item", ahora, puntos)).toBeNull();
  });

  // Corrección de Pablo (revisión sobre 0e22594) — un id de item
  // (MCOxxxxxxxxx, una publicación puntual) y uno de product
  // (catálogo, /p/MCOxxxxxxxxx) son dos numeraciones INDEPENDIENTES de
  // Mercado Libre, aunque compartan el mismo prefijo de país y hasta
  // rangos de números parecidos — nunca interpolar uno contra puntos
  // calibrados del otro tipo.
  it('un "product" NUNCA usa puntos calibrados de "item", y viceversa, aunque el id numérico coincida', () => {
    const ahora = new Date("2025-06-01T05:00:00.000Z");
    // Los mismos ids/números que `puntos` (tipo "item"), pero pidiendo
    // tipo "product" — ningún punto calibrado coincide en tipo, así
    // que nunca interpola, aunque el país y el rango numérico sean
    // idénticos.
    expect(antiguedadDiasPorId("MCO1050000000", "product", ahora, puntos)).toBeNull();

    const puntosProduct: PuntoCalibracionId[] = [
      { id: "MCO2000000000", tipo: "product", fecha: new Date("2024-01-01T05:00:00.000Z") },
      { id: "MCO2100000000", tipo: "product", fecha: new Date("2025-01-01T05:00:00.000Z") },
    ];
    // Mismos puntos de "item" que arriba SUMADOS a los de "product" —
    // pedir tipo "item" sigue interpolando solo con los de "item",
    // nunca con los de "product" aunque estén en la misma lista.
    const mezclados = [...puntos, ...puntosProduct];
    expect(antiguedadDiasPorId("MCO1050000000", "item", ahora, mezclados)).not.toBeNull();
    expect(antiguedadDiasPorId("MCO2050000000", "product", ahora, mezclados)).not.toBeNull();
    // El id de product (2050000000) cae fuera del rango de "item"
    // (1000000000-1100000000) y nunca matchea esos puntos por tipo —
    // sigue sin servir para interpolar como "item".
    expect(antiguedadDiasPorId("MCO2050000000", "item", ahora, mezclados)).toBeNull();
  });

  it("con menos de 2 puntos calibrados del mismo tipo -> null, nunca inventa una fecha", () => {
    const ahora = new Date("2025-06-01T05:00:00.000Z");
    expect(antiguedadDiasPorId("MCO1050000000", "item", ahora, [puntos[0]])).toBeNull();
    expect(antiguedadDiasPorId("MCO1050000000", "item", ahora, [])).toBeNull();
  });

  it("un id sin el patrón prefijo+dígitos (nunca confirmado por extraerIdDeUrl) -> null", () => {
    const ahora = new Date("2025-06-01T05:00:00.000Z");
    expect(antiguedadDiasPorId("no-es-un-id-real", "item", ahora, puntos)).toBeNull();
  });
});

describe("antiguedadDias — issue #251, date_created real gana siempre que esté", () => {
  const puntos: PuntoCalibracionId[] = [
    { id: "MCO1000000000", tipo: "item", fecha: new Date("2024-01-01T05:00:00.000Z") },
    { id: "MCO1100000000", tipo: "item", fecha: new Date("2025-01-01T05:00:00.000Z") },
  ];

  it("con date_created real (string u objeto Date) -> días reales, nunca interpola por id", () => {
    const ahora = new Date("2026-01-01T00:00:00.000Z");
    const haceUnMes = new Date(ahora.getTime() - 30 * UN_DIA_MS);
    expect(antiguedadDias({ dateCreated: haceUnMes.toISOString(), mlId: "MCO9999999999", recursoMl: "item", ahora, puntos })).toBeCloseTo(30, 6);
    expect(antiguedadDias({ dateCreated: haceUnMes, mlId: null, recursoMl: null, ahora })).toBeCloseTo(30, 6);
  });

  it("sin date_created, con mlId y recursoMl -> cae a la interpolación por id del mismo tipo", () => {
    const ahora = new Date("2025-01-01T05:00:00.000Z");
    const dias = antiguedadDias({ dateCreated: null, mlId: "MCO1050000000", recursoMl: "item", ahora, puntos });
    expect(dias).not.toBeNull();
  });

  it('recursoMl "product" nunca interpola con puntos calibrados de tipo "item"', () => {
    const ahora = new Date("2025-01-01T05:00:00.000Z");
    expect(antiguedadDias({ dateCreated: null, mlId: "MCO1050000000", recursoMl: "product", ahora, puntos })).toBeNull();
  });

  it('recursoMl "seller" (tienda, nunca producto) o null -> siempre null, ni siquiera lo intenta', () => {
    const ahora = new Date("2025-01-01T05:00:00.000Z");
    expect(antiguedadDias({ dateCreated: null, mlId: "123456789", recursoMl: "seller", ahora, puntos })).toBeNull();
    expect(antiguedadDias({ dateCreated: null, mlId: "MCO1050000000", recursoMl: null, ahora, puntos })).toBeNull();
  });

  it("sin date_created y sin mlId (o sin puntos suficientes) -> null, nunca inventa", () => {
    const ahora = new Date("2025-01-01T05:00:00.000Z");
    expect(antiguedadDias({ dateCreated: null, mlId: null, recursoMl: "item", ahora })).toBeNull();
    expect(antiguedadDias({ dateCreated: null, mlId: "MCO1050000000", recursoMl: "item", ahora, puntos: [] })).toBeNull();
  });

  it("un date_created inválido (string no parseable) cae al respaldo por id, nunca revienta", () => {
    const ahora = new Date("2025-01-01T05:00:00.000Z");
    const dias = antiguedadDias({ dateCreated: "fecha-invalida", mlId: "MCO1050000000", recursoMl: "item", ahora, puntos });
    expect(dias).not.toBeNull();
  });
});

describe("ventasMes — issue #251, punto 3 (vendidos estimados × min(30, días) / días)", () => {
  it("publicación de 30+ días: misma cuenta de siempre (× 30 / días)", () => {
    expect(ventasMes(300, 90)).toBeCloseTo(100, 6); // 300 * 30 / 90 = 100
  });

  it("publicación de MENOS de 30 días: min(30, días) evita inflar sobre poco historial", () => {
    // Sin el tope, 3 * 30 / 5 = 18 (ritmo exagerado para solo 5 días de
    // historial real). Con el tope, min(30,5)=5 -> 3 * 5 / 5 = 3 (el
    // ritmo real tal cual, sin extrapolar de más).
    expect(ventasMes(3, 5)).toBe(3);
  });

  it("sin vendidos o sin días válidos -> null, nunca inventa", () => {
    expect(ventasMes(null, 90)).toBeNull();
    expect(ventasMes(100, null)).toBeNull();
    expect(ventasMes(100, 0)).toBeNull();
    expect(ventasMes(100, -5)).toBeNull();
  });
});

describe("facturacionMes — issue #251, punto 4 (ventas/mes × precio actual)", () => {
  it("multiplica ventas/mes por el precio actual", () => {
    expect(facturacionMes(10, 50000)).toBe(500000);
  });

  it("sin ventas/mes o sin precio -> null", () => {
    expect(facturacionMes(null, 50000)).toBeNull();
    expect(facturacionMes(10, null)).toBeNull();
    expect(facturacionMes(10, -1)).toBeNull();
  });
});

// Caso real de referencia completo (Selltrix, verificado por el
// pedido de la tarea): "+100 vendidos" Full con precio $939.900 y una
// publicación de ~14 meses -> 220 vendidos estimados, ~16 ventas/mes,
// $14.662.440 de facturación/mes. "14 meses"/"16 ventas/mes" son las
// cifras REDONDEADAS que muestra la pantalla de referencia — acá se
// reconstruyen los números SIN redondear (15.6, no 16) despejando los
// días exactos que hacen que facturación/mes dé exactamente
// $14.662.440 con precio $939.900 (14.662.440 / 939.900 = 15.6 ventas/mes
// exactas; 15.6 = 220 × 30 / días -> días = 6600/15.6 = 5500/13 ≈
// 423.08, consistente con "~14 meses" de antigüedad) — nunca se tuvo
// la fecha real exacta de esa publicación de referencia, así que se
// reconstruye hacia atrás a partir de las 3 cifras que sí dio la
// tarea, no se inventa un date_created suelto.
describe("caso real de referencia completo (Selltrix) — los 4 cálculos encadenados", () => {
  it("+100 vendidos Full, precio $939.900, ~423 días de antigüedad -> 220 / 15.6 / $14.662.440", () => {
    const diasExactos = 5500 / 13; // despejado de 220 × 30 / días = 15.6
    const ahora = new Date("2026-10-27T00:00:00.000Z");
    const dateCreated = new Date(ahora.getTime() - diasExactos * UN_DIA_MS);

    const vendidos = vendidosEstimados(100, { exacto: false, esFull: true });
    expect(vendidos).toBeCloseTo(220, 9);

    const dias = antiguedadDias({ dateCreated, mlId: null, recursoMl: null, ahora });
    expect(dias).toBeCloseTo(diasExactos, 6);

    const ventasMesValor = ventasMes(vendidos, dias);
    expect(ventasMesValor).toBeCloseTo(15.6, 6);
    expect(Math.round(ventasMesValor!)).toBe(16); // la cifra redondeada que muestra la pantalla de referencia

    const facturacion = facturacionMes(ventasMesValor, 939900);
    expect(facturacion).toBeCloseTo(14662440, 2);
  });
});
