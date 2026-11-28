import { describe, expect, it } from "vitest";
import {
  REGLAS_POR_DEFECTO,
  cantidadSugerida,
  clasificarAbc,
  clasificarEstado,
  diasDeCobertura,
  ordenarPorUrgencia,
  proyectar,
  type EntradaProyeccion,
} from "./proyeccion";

const entrada = (parcial: Partial<EntradaProyeccion> & { skuId: string }): EntradaProyeccion => ({
  codigo: parcial.skuId,
  nombre: parcial.skuId,
  stock: 100,
  vendidas: { 3: 0, 7: 0, 14: 0, 20: 0, 30: 0 },
  ruta: "plataforma",
  leadTimeDias: null,
  ...parcial,
});

describe("proyección de inventarios", () => {
  it("100 unidades a 8 por día duran 12,5 días", () => {
    expect(diasDeCobertura(100, 8)).toBe(12.5);
  });

  it("sin ventas el stock no se acaba (null, no Infinity)", () => {
    expect(diasDeCobertura(100, 0)).toBeNull();
    expect(clasificarEstado(null, 15)).toBe("sin_ventas");
  });

  it("estado: comprar ya si dura menos que lo que tarda en llegar", () => {
    expect(clasificarEstado(12.5, 15)).toBe("comprar_ya");
    expect(clasificarEstado(20, 15)).toBe("pronto");
    expect(clasificarEstado(40, 15)).toBe("saludable");
    expect(clasificarEstado(137, 15)).toBe("sobrestock");
    expect(clasificarEstado(0, 15)).toBe("comprar_ya");
  });

  it("cantidad sugerida = velocidad × (entrega + cobertura) × colchón − stock", () => {
    // 8 × (15 + 30) × 1,2 = 432; hay 100 → 332
    expect(cantidadSugerida(100, 8, 15, REGLAS_POR_DEFECTO)).toBe(332);
    // Con de sobra no se pide nada (nunca negativo).
    expect(cantidadSugerida(1000, 8, 15, REGLAS_POR_DEFECTO)).toBe(0);
    expect(cantidadSugerida(0, 0, 15, REGLAS_POR_DEFECTO)).toBe(0);
  });

  it("las reglas de la empresa cambian el resultado", () => {
    const reglas = { ...REGLAS_POR_DEFECTO, coberturaDias: 60, colchonPorcentaje: 0 };
    expect(cantidadSugerida(0, 10, 20, reglas)).toBe(800);
  });

  it("el tiempo de entrega propio del SKU manda sobre el de la ruta", () => {
    const e = entrada({ skuId: "A", vendidas: { 3: 24, 7: 56, 14: 112, 20: 160, 30: 240 }, ruta: "avion", leadTimeDias: 30 });
    const [r] = proyectar([e], REGLAS_POR_DEFECTO);
    expect(r.leadTimeDias).toBe(30);
    const [sinPropio] = proyectar([{ ...e, leadTimeDias: null }], REGLAS_POR_DEFECTO);
    expect(sinPropio.leadTimeDias).toBe(25);
  });

  it("usa la ventana elegida y calcula la tendencia 7 d vs 30 d", () => {
    // 30 d: 3/día. 7 d: 6/día → +100%. 14 d: 4/día.
    const e = entrada({ skuId: "A", stock: 40, vendidas: { 3: 18, 7: 42, 14: 56, 20: 60, 30: 90 } });
    const [r] = proyectar([e], { ...REGLAS_POR_DEFECTO, ventanaDias: 14 });
    expect(r.velocidad).toBe(4);
    expect(r.diasCobertura).toBe(10);
    expect(r.tendenciaPorcentaje).toBe(100);
    const [en7] = proyectar([e], { ...REGLAS_POR_DEFECTO, ventanaDias: 7 });
    expect(en7.velocidad).toBe(6);
  });

  it("fecha de agotamiento = hoy + días de cobertura", () => {
    const ahora = new Date("2026-11-27T12:00:00Z");
    const e = entrada({ skuId: "A", stock: 20, vendidas: { 3: 6, 7: 14, 14: 28, 20: 40, 30: 60 } });
    const [r] = proyectar([e], REGLAS_POR_DEFECTO, ahora);
    expect(r.fechaAgotamiento?.toISOString()).toBe("2026-12-07T12:00:00.000Z");
  });

  it("ABC: el que cruza el 80% sigue siendo A y los sin ventas son C", () => {
    const abc = clasificarAbc(
      new Map([
        ["a", 900],
        ["b", 60],
        ["c", 40],
        ["d", 0],
      ])
    );
    expect(abc.get("a")).toBe("A");
    expect(abc.get("b")).toBe("B");
    expect(abc.get("c")).toBe("C");
    expect(abc.get("d")).toBe("C");
  });

  it("ordena lo urgente primero y los sin ventas al final", () => {
    const filas = proyectar(
      [
        entrada({ skuId: "sano", stock: 600, vendidas: { 3: 15, 7: 35, 14: 70, 20: 100, 30: 150 } }),
        entrada({ skuId: "quieto" }),
        entrada({ skuId: "urgente", stock: 10, vendidas: { 3: 15, 7: 35, 14: 70, 20: 100, 30: 150 } }),
      ],
      REGLAS_POR_DEFECTO
    );
    expect(ordenarPorUrgencia(filas).map((f) => f.skuId)).toEqual(["urgente", "sano", "quieto"]);
  });
});
