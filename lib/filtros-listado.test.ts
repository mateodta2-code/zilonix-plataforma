import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_BUSQUEDA,
  PAGINA_MAXIMA,
  acotarPagina,
  escaparComodinesLike,
  limitesDiaBogota,
  normalizarParametro,
  normalizarTextoBusqueda,
  parsearPagina,
  patronBusquedaLike,
  rangoDiaBogota,
} from "./filtros-listado";

describe("parsearPagina", () => {
  it("acepta un entero seguro entre 1 y 10000", () => {
    expect(parsearPagina(1)).toBe(1);
    expect(parsearPagina(99)).toBe(99);
    expect(parsearPagina(PAGINA_MAXIMA)).toBe(PAGINA_MAXIMA);
    expect(parsearPagina("99")).toBe(99);
    expect(parsearPagina("  2  ")).toBe(2);
  });

  it("1e20 no es un entero seguro: vuelve a la página 1, sin tirar", () => {
    expect(parsearPagina(1e20)).toBe(1);
    expect(parsearPagina("1e20")).toBe(1);
  });

  it("rechaza lo que no es un entero positivo, y también lo que pasa de 10000", () => {
    for (const invalida of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, PAGINA_MAXIMA + 1, "0", "-1", "1.5", "no", "10001", ""]) {
      expect(parsearPagina(invalida)).toBe(1);
    }
    expect(parsearPagina(undefined)).toBe(1);
    expect(parsearPagina(null)).toBe(1);
  });
});

describe("acotarPagina", () => {
  it("una página más allá de la última se queda en la última, y 0 páginas igual deja la 1", () => {
    expect(acotarPagina(99, 2)).toBe(2);
    expect(acotarPagina(1, 2)).toBe(1);
    expect(acotarPagina(5, 0)).toBe(1);
  });
});

describe("limitesDiaBogota", () => {
  it("2026-01-15 abre a las 05:00 UTC y cierra, exclusivo, a las 05:00 UTC del día siguiente", () => {
    const limites = limitesDiaBogota("2026-01-15");
    expect(limites?.inicio.toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(limites?.finExclusivo.toISOString()).toBe("2026-01-16T05:00:00.000Z");
  });

  it("ignora 2026-02-30, 2026 y 2026-1-5", () => {
    expect(limitesDiaBogota("2026-02-30")).toBeNull();
    expect(limitesDiaBogota("2026")).toBeNull();
    expect(limitesDiaBogota("2026-1-5")).toBeNull();
  });

  it("2026 no es bisiesto: el 29 de febrero tampoco cierra el ida y vuelta", () => {
    expect(limitesDiaBogota("2026-02-29")).toBeNull();
    expect(limitesDiaBogota("2024-02-29")?.inicio.toISOString()).toBe("2024-02-29T05:00:00.000Z");
  });

  it("cruza el fin de mes con el fin exclusivo (28 de febrero de 2026 → 1 de marzo 05:00 UTC)", () => {
    const limites = limitesDiaBogota("2026-02-28");
    expect(limites?.finExclusivo.toISOString()).toBe("2026-03-01T05:00:00.000Z");
  });
});

describe("rangoDiaBogota", () => {
  it("23:59:59.999 de Bogotá (04:59:59.999 UTC del día siguiente) sigue en el mismo día", () => {
    const rango = rangoDiaBogota(new Date("2026-07-21T04:59:59.999Z"));
    expect(rango.inicio.toISOString()).toBe("2026-07-20T05:00:00.000Z");
    expect(rango.finExclusivo.toISOString()).toBe("2026-07-21T05:00:00.000Z");
  });

  it("00:00 de Bogotá (05:00 UTC) abre el día nuevo", () => {
    const rango = rangoDiaBogota(new Date("2026-07-21T05:00:00.000Z"));
    expect(rango.inicio.toISOString()).toBe("2026-07-21T05:00:00.000Z");
    expect(rango.finExclusivo.toISOString()).toBe("2026-07-22T05:00:00.000Z");
  });

  it("cambio de mes: las 20:00 del 31 de marzo en Bogotá (1 de abril en UTC) siguen en marzo", () => {
    const rango = rangoDiaBogota(new Date("2026-04-01T01:00:00.000Z"));
    expect(rango.inicio.toISOString()).toBe("2026-03-31T05:00:00.000Z");
    expect(rango.finExclusivo.toISOString()).toBe("2026-04-01T05:00:00.000Z");
  });

  it("29 de febrero de un año bisiesto cierra en el 1 de marzo", () => {
    const rango = rangoDiaBogota(new Date("2028-02-29T12:00:00.000Z"));
    expect(rango.inicio.toISOString()).toBe("2028-02-29T05:00:00.000Z");
    expect(rango.finExclusivo.toISOString()).toBe("2028-03-01T05:00:00.000Z");
  });
});

describe("búsqueda", () => {
  it("recorta espacios y se queda con 100 caracteres", () => {
    expect(normalizarTextoBusqueda("  abc  ")).toBe("abc");
    expect(normalizarTextoBusqueda("   ")).toBeNull();
    expect(normalizarTextoBusqueda(undefined)).toBeNull();
    expect(normalizarTextoBusqueda("a".repeat(5000))).toHaveLength(LARGO_MAXIMO_BUSQUEDA);
  });

  it("escapa \\, % y _ antes de envolver en %…%", () => {
    expect(escaparComodinesLike("%")).toBe("\\%");
    expect(escaparComodinesLike("_")).toBe("\\_");
    expect(escaparComodinesLike("\\")).toBe("\\\\");
    expect(patronBusquedaLike("%")).toBe("%\\%%");
    expect(patronBusquedaLike("_")).toBe("%\\_%");
    expect(patronBusquedaLike("\\")).toBe("%\\\\%");
    expect(patronBusquedaLike(`  ${"a".repeat(5000)}  `)).toBe(`%${"a".repeat(LARGO_MAXIMO_BUSQUEDA)}%`);
    expect(patronBusquedaLike("%".repeat(5000))).toBe(`%${"\\%".repeat(LARGO_MAXIMO_BUSQUEDA)}%`);
  });
});

describe("normalizarParametro", () => {
  it("se queda con el primer valor cuando Next entrega un arreglo", () => {
    expect(normalizarParametro("hola")).toBe("hola");
    expect(normalizarParametro(["a", "b"])).toBe("a");
    expect(normalizarParametro(["", "b"])).toBe("");
    expect(normalizarParametro([])).toBeUndefined();
    expect(normalizarParametro(undefined)).toBeUndefined();
  });
});
