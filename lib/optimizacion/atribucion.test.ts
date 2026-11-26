import { describe, expect, it } from "vitest";
import { aCentavos } from "@/lib/finanzas/utilidad-venta";
import { atribuir, etiquetaCambio, factorPrincipal, muestraSuficiente, shapleyTresFactores, type PeriodoAtribucion } from "./atribucion";

const suma = (a: { visitas: string; conversion: string; ticket: string }) => aCentavos(a.visitas) + aCentavos(a.conversion) + aCentavos(a.ticket);

describe("atribuir — Shapley exacto de 3 factores", () => {
  // Caso a mano: V 1000→1200, ventas 50→48 (C 5 %→4 %), ticket 20000→25000.
  // R0 = 1 000 000, R1 = 1 200 000, Δ = 200 000.
  // φV = 200·[(1000+1000)/3 + (1250+800)/6] = 201 666,67
  // φC = −0,01·[(20M+30M)/3 + (25M+24M)/6] = −248 333,33
  // φT = 5000·[(50+48)/3 + (40+60)/6] = 246 666,67
  const ant: PeriodoAtribucion = { visitas: 1000, ventas: 50, ingresos: "1000000.00" };
  const act: PeriodoAtribucion = { visitas: 1200, ventas: 48, ingresos: "1200000.00" };

  it("coincide con el caso calculado a mano y suma exacto", () => {
    const r = atribuir(ant, act)!;
    expect(r.cambio).toBe("200000.00");
    expect(Number(r.aportes.visitas)).toBeCloseTo(201666.67, 2);
    expect(Number(r.aportes.conversion)).toBeCloseTo(-248333.33, 1);
    expect(Number(r.aportes.ticket)).toBeCloseTo(246666.67, 2);
    expect(suma(r.aportes)).toBe(aCentavos(r.cambio));
    expect(r.ticket).toEqual({ antes: "20000.00", ahora: "25000.00" });
  });

  it("el resultado no depende del orden de los factores (permutaciones)", () => {
    const v: [number, number] = [1000, 1200];
    const c: [number, number] = [0.05, 0.04];
    const t: [number, number] = [20000, 25000];
    const [pv, pc, pt] = shapleyTresFactores(v, c, t);
    const porNombre = { v: pv, c: pc, t: pt };
    const factores = { v, c, t };
    const claves = ["v", "c", "t"] as const;
    const permutaciones: (typeof claves[number])[][] = [
      ["v", "c", "t"], ["v", "t", "c"], ["c", "v", "t"], ["c", "t", "v"], ["t", "v", "c"], ["t", "c", "v"],
    ];
    for (const [x, y, z] of permutaciones) {
      const [fx] = shapleyTresFactores(factores[x], factores[y], factores[z]);
      expect(fx).toBeCloseTo(porNombre[x], 6);
    }
    expect(pv + pc + pt).toBeCloseTo(1200 * 0.04 * 25000 - 1000 * 0.05 * 20000, 6);
  });

  it("suma exacta con cifras que no cuadran en centavos", () => {
    const r = atribuir({ visitas: 333, ventas: 7, ingresos: "123457.89" }, { visitas: 517, ventas: 11, ingresos: "98765.43" })!;
    expect(suma(r.aportes)).toBe(aCentavos(r.cambio));
  });

  it("período anterior sin ventas: ticket igual, efecto de ticket 0, sin reparto fijo", () => {
    const r = atribuir({ visitas: 100, ventas: 0, ingresos: "0.00" }, { visitas: 100, ventas: 5, ingresos: "50000.00" })!;
    expect(r.conversion.antes).toBe(0);
    expect(r.ticket.antes).toBe(r.ticket.ahora);
    expect(r.aportes.ticket).toBe("0.00");
    expect(r.aportes.visitas).toBe("0.00");
    expect(r.aportes.conversion).toBe("50000.00");
    expect(suma(r.aportes)).toBe(aCentavos(r.cambio));
  });

  it("período actual sin ventas: la caída es toda conversión si las visitas no cambian", () => {
    const r = atribuir({ visitas: 80, ventas: 4, ingresos: "40000.00" }, { visitas: 80, ventas: 0, ingresos: "0.00" })!;
    expect(r.aportes).toEqual({ visitas: "0.00", conversion: "-40000.00", ticket: "0.00" });
  });

  it("los dos períodos sin ventas, o ventas sin visitas: no hay atribución", () => {
    expect(atribuir({ visitas: 10, ventas: 0, ingresos: "0.00" }, { visitas: 20, ventas: 0, ingresos: "0.00" })).toBeNull();
    expect(atribuir({ visitas: 0, ventas: 2, ingresos: "10.00" }, { visitas: 10, ventas: 1, ingresos: "5.00" })).toBeNull();
  });

  it("período con 0 visitas y 0 ventas: conversión 0", () => {
    const r = atribuir({ visitas: 0, ventas: 0, ingresos: "0.00" }, { visitas: 10, ventas: 2, ingresos: "200.00" })!;
    expect(r.conversion.antes).toBe(0);
    expect(suma(r.aportes)).toBe(aCentavos(r.cambio));
  });

  it("rechaza visitas o ventas no enteras", () => {
    expect(atribuir({ visitas: 1.5, ventas: 1, ingresos: "1.00" }, act)).toBeNull();
  });
});

describe("muestraSuficiente", () => {
  const p = (visitas: number, ventas: number): PeriodoAtribucion => ({ visitas, ventas, ingresos: "0.00" });
  it("≥ 3 ventas o ≥ 50 visitas en algún período", () => {
    expect(muestraSuficiente(p(10, 2), p(10, 2))).toBe(false);
    expect(muestraSuficiente(p(10, 2), p(10, 3))).toBe(true);
    expect(muestraSuficiente(p(49, 0), p(50, 0))).toBe(true);
    expect(muestraSuficiente(p(49, 2), p(49, 2))).toBe(false);
  });
});

describe("etiquetaCambio", () => {
  const a = (visitas: string, conversion: string, ticket: string) => ({ visitas, conversion, ticket });
  it("el factor de mayor peso en la dirección del cambio", () => {
    expect(etiquetaCambio(a("-500.00", "-100.00", "50.00"), "-550.00", true)).toBe("Caída por tráfico");
    expect(etiquetaCambio(a("-100.00", "-500.00", "50.00"), "-550.00", true)).toBe("Caída por conversión");
    expect(etiquetaCambio(a("100.00", "50.00", "-500.00"), "-350.00", true)).toBe("Caída por ticket");
    expect(etiquetaCambio(a("500.00", "-100.00", "50.00"), "450.00", true)).toBe("Impulso por visibilidad");
    expect(etiquetaCambio(a("100.00", "500.00", "-50.00"), "550.00", true)).toBe("Mejora en cierre");
    expect(etiquetaCambio(a("100.00", "50.00", "500.00"), "650.00", true)).toBe("Mejora por ticket");
  });
  it("sin muestra suficiente: «Pocas ventas para concluir»", () => {
    expect(etiquetaCambio(a("-500.00", "0.00", "0.00"), "-500.00", false)).toBe("Pocas ventas para concluir");
  });
  it("sin cambio no hay factor principal", () => {
    expect(factorPrincipal(a("10.00", "-10.00", "0.00"), "0.00")).toBeNull();
    expect(etiquetaCambio(a("10.00", "-10.00", "0.00"), "0.00", true)).toBe("Sin cambio");
  });
});
