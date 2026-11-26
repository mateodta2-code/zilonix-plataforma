import { describe, expect, it } from "vitest";
import {
  clasificarPareto,
  ctr,
  cvr,
  leerGrupo,
  medianaDe,
  medianasPorCategoria,
  mediana,
  semaforo,
  semaforoPublicacion,
  traficoAds,
  type EntradaMediana,
} from "./rendimiento";

const f = (id: string, ingresos: number) => ({ id, ingresos });
const grupos = (r: ReturnType<typeof clasificarPareto<{ id: string; ingresos: number }>>) => Object.fromEntries(r.filas.map((x) => [x.id, x.grupo]));

describe("clasificarPareto", () => {
  it("ordena por ingresos y reparte Killer / Potencial / Cola", () => {
    const r = clasificarPareto([f("c", 5), f("a", 50), f("b", 30), f("d", 10), f("e", 5)]);
    expect(r.filas.map((x) => x.id)).toEqual(["a", "b", "d", "c", "e"]);
    expect(grupos(r)).toEqual({ a: "killer", b: "killer", d: "potencial", c: "potencial", e: "cola" });
    expect(r.total).toBe(100);
    expect(r.grupos.killer).toEqual({ cantidad: 2, ingresos: 80, porcentaje: 80 });
    expect(r.grupos.potencial).toMatchObject({ cantidad: 2, porcentaje: 15 });
    expect(r.grupos.cola).toMatchObject({ cantidad: 1, porcentaje: 5 });
  });

  it("bordes: 80 % exacto es Killer, 95 % exacto es Potencial, un centavo más pasa de grupo", () => {
    const exacto = clasificarPareto([f("a", 80), f("b", 15), f("c", 5)]);
    expect(grupos(exacto)).toEqual({ a: "killer", b: "potencial", c: "cola" });
    expect(exacto.filas[1].acumulado).toBe(95);
    const pasa = clasificarPareto([f("a", 40.01), f("b", 40.01), f("c", 19.98)]);
    expect(grupos(pasa)).toEqual({ a: "killer", b: "potencial", c: "cola" });
  });

  it("la primera siempre es Killer aunque sola pase el 80 %", () => {
    const r = clasificarPareto([f("a", 90), f("b", 6), f("c", 4)]);
    expect(grupos(r)).toEqual({ a: "killer", b: "cola", c: "cola" });
    expect(r.filas[0].acumulado).toBe(90);
    expect(clasificarPareto([f("a", 10)]).filas[0].grupo).toBe("killer");
  });

  it("0 ingresos queda «Sin ventas», fuera del Pareto", () => {
    const r = clasificarPareto([f("z", 0), f("a", 100), f("y", 0)]);
    expect(r.grupos.sin_ventas.cantidad).toBe(2);
    expect(r.filas.find((x) => x.id === "z")).toMatchObject({ grupo: "sin_ventas", porcentaje: 0, acumulado: null });
    expect(r.total).toBe(100);
  });

  it("todo en cero: sin división por cero", () => {
    const r = clasificarPareto([f("a", 0), f("b", 0)]);
    expect(r.total).toBe(0);
    expect(r.grupos.sin_ventas.cantidad).toBe(2);
    expect(r.grupos.killer.porcentaje).toBe(0);
    expect(clasificarPareto([]).filas).toEqual([]);
  });
});

describe("leerGrupo", () => {
  it("lista blanca", () => {
    expect(leerGrupo("killer")).toBe("killer");
    expect(leerGrupo("sin_ventas")).toBe("sin_ventas");
    expect(leerGrupo("'; drop")).toBeNull();
    expect(leerGrupo(undefined)).toBeNull();
  });
});

describe("traficoAds", () => {
  it("clics ÷ visitas y semáforo 40 / 70", () => {
    expect(traficoAds(10, 100)).toEqual({ porcentaje: 10, concilia: true, tono: "exito" });
    expect(traficoAds(40, 100)?.tono).toBe("advertencia");
    expect(traficoAds(70, 100)?.tono).toBe("advertencia");
    expect(traficoAds(71, 100)?.tono).toBe("peligro");
    expect(traficoAds(100, 100)).toMatchObject({ porcentaje: 100, concilia: true });
  });
  it("tope de 100 % y no concilia cuando hay más clics que visitas", () => {
    expect(traficoAds(250, 100)).toEqual({ porcentaje: 100, concilia: false, tono: "peligro" });
  });
  it("sin visitas → null", () => {
    expect(traficoAds(5, 0)).toBeNull();
    expect(traficoAds(5, null)).toBeNull();
    expect(traficoAds(null, 50)).toBeNull();
  });
});

describe("ctr y cvr", () => {
  it("ctr solo con impresiones", () => {
    expect(ctr(5, 1000)).toBe(0.5);
    expect(ctr(5, 0)).toBeNull();
    expect(ctr(null, 100)).toBeNull();
  });
  it("cvr incluye 0 ventas y pide visitas", () => {
    expect(cvr(0, 80)).toBe(0);
    expect(cvr(2, 80)).toBe(2.5);
    expect(cvr(2, 0)).toBeNull();
    expect(cvr(2, null)).toBeNull();
  });
});

describe("medianas", () => {
  const e = (categoria: string | null, impresiones: number, clics: number, visitas: number, ventas: number): EntradaMediana => ({ categoria, impresiones, clics, visitas, ventas });

  it("mediana par e impar", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
    expect(mediana([])).toBeNull();
  });

  it("por categoría con ≥ 3 publicaciones con muestra", () => {
    const m = medianasPorCategoria([
      e("A", 1000, 10, 100, 1), // ctr 1, cvr 1
      e("A", 2000, 40, 100, 3), // ctr 2, cvr 3
      e("A", 1000, 30, 50, 2), // ctr 3, cvr 4
      e("B", 5000, 5, 500, 5),
    ]);
    expect(medianaDe(m, "A", "ctr")).toEqual({ valor: 2, deCuenta: false });
    expect(medianaDe(m, "A", "cvr")).toEqual({ valor: 3, deCuenta: false });
  });

  it("respaldo de la cuenta cuando la categoría tiene menos de 3 con muestra", () => {
    const m = medianasPorCategoria([
      e("A", 1000, 10, 100, 1),
      e("A", 2000, 40, 100, 3),
      e("A", 1000, 30, 50, 2),
      e("B", 5000, 5, 500, 5),
      e("B", 999, 99, 49, 9), // sin muestra: no cuenta
    ]);
    const r = medianaDe(m, "B", "ctr");
    expect(r.deCuenta).toBe(true);
    expect(r.valor).toBe(mediana([1, 2, 3, 0.1]));
    expect(medianaDe(m, null, "ctr").deCuenta).toBe(true);
  });

  it("poca muestra: sin 3 publicaciones en la cuenta no hay mediana y el semáforo es neutro", () => {
    const m = medianasPorCategoria([e("A", 1000, 10, 100, 1), e("A", 10, 1, 5, 0)]);
    expect(medianaDe(m, "A", "ctr")).toEqual({ valor: null, deCuenta: false });
    expect(semaforoPublicacion(e("A", 1000, 10, 100, 1), m, "ctr").tono).toBe("neutro");
  });

  it("la publicación misma necesita muestra para tener semáforo", () => {
    const base = [e("A", 1000, 10, 100, 1), e("A", 1000, 10, 100, 1), e("A", 1000, 10, 100, 1)];
    const m = medianasPorCategoria(base);
    expect(semaforoPublicacion(e("A", 500, 0, 100, 1), m, "ctr").tono).toBe("neutro");
    expect(semaforoPublicacion(e("A", 1000, 0, 100, 1), m, "ctr").tono).toBe("peligro");
    expect(semaforoPublicacion(e("A", 1000, 10, 40, 0), m, "cvr").tono).toBe("neutro");
    expect(semaforoPublicacion(e("A", 1000, 10, 100, 0), m, "cvr").tono).toBe("peligro");
  });
});

describe("semaforo", () => {
  it("≥ mediana éxito, ≥ 60 % advertencia, menos peligro", () => {
    expect(semaforo(2, 2)).toBe("exito");
    expect(semaforo(3, 2)).toBe("exito");
    expect(semaforo(1.2, 2)).toBe("advertencia");
    expect(semaforo(1.19, 2)).toBe("peligro");
    expect(semaforo(0, 2)).toBe("peligro");
  });
  it("sin valor o sin mediana → neutro", () => {
    expect(semaforo(null, 2)).toBe("neutro");
    expect(semaforo(2, null)).toBe("neutro");
  });
  it("no usa umbrales fijos: 0,3 % es éxito si la mediana es 0,2 %", () => {
    expect(semaforo(0.3, 0.2)).toBe("exito");
    expect(semaforo(5, 10)).toBe("peligro");
  });
});
