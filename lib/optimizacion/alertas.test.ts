import { describe, expect, it } from "vitest";
import { armarAlertas, esPrecioAlto, leerFiltroAlerta, pierdeCompetencia } from "./alertas";

describe("armarAlertas", () => {
  it("usa los textos de Mercado Libre y el orden moderadas, competencia, precio alto", () => {
    const a = armarAlertas({ moderadas: { cantidad: 2 }, competencia: { cantidad: 0 }, precio_alto: { cantidad: 5 } });
    expect(a.map((x) => x.clave)).toEqual(["moderadas", "competencia", "precio_alto"]);
    expect(a[0].titulo).toBe("Inactivas por incumplir políticas");
    expect(a[0].texto).toBe("Conoce qué pasó para evitar nuevas infracciones.");
    expect(a[1].titulo).toBe("Para ganar la competencia en Mercado Libre");
    expect(a[2].texto).toBe("Ajusta las publicaciones donde tu precio es más caro que el de tu competencia.");
    expect(a.map((x) => x.cantidad)).toEqual([2, 0, 5]);
  });
  it("null se conserva (no se convierte en 0)", () => {
    const a = armarAlertas({ moderadas: { cantidad: null }, competencia: { cantidad: 1 }, precio_alto: { cantidad: null } });
    expect(a[0].cantidad).toBeNull();
    expect(a[2].cantidad).toBeNull();
  });
  it("revisadas solo si se revisó una parte", () => {
    const a = armarAlertas({
      moderadas: { cantidad: 1 },
      competencia: { cantidad: 1, revisadas: { hechas: 50, total: 50 } },
      precio_alto: { cantidad: 3, revisadas: { hechas: 50, total: 120 } },
    });
    expect(a[0].revisadas).toBeUndefined();
    expect(a[1].revisadas).toBeUndefined();
    expect(a[2].revisadas).toEqual({ hechas: 50, total: 120 });
  });
});

describe("leerFiltroAlerta", () => {
  it("lista blanca", () => {
    expect(leerFiltroAlerta("precio_alto")).toBe("precio_alto");
    expect(leerFiltroAlerta("moderadas")).toBe("moderadas");
    expect(leerFiltroAlerta("competencia")).toBe("competencia");
    expect(leerFiltroAlerta("otra")).toBeNull();
    expect(leerFiltroAlerta(undefined)).toBeNull();
    expect(leerFiltroAlerta(["moderadas"])).toBeNull();
  });
});

describe("estados", () => {
  it("esPrecioAlto", () => {
    expect(esPrecioAlto("with_benchmark_highest")).toBe(true);
    expect(esPrecioAlto("with_benchmark_high")).toBe(true);
    expect(esPrecioAlto("no_benchmark_ok")).toBe(false);
    expect(esPrecioAlto(null)).toBe(false);
  });
  it("pierdeCompetencia", () => {
    for (const e of ["competing", "sharing_first_place", "listed"]) expect(pierdeCompetencia(e)).toBe(true);
    expect(pierdeCompetencia("winning")).toBe(false);
    expect(pierdeCompetencia(null)).toBe(false);
  });
});
