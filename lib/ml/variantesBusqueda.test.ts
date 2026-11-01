import { describe, expect, it } from "vitest";
import { completarQueriesAnalizar, generarVariantesBusqueda, TOPE_QUERIES_ANALIZAR } from "./variantesBusqueda";

describe("generarVariantesBusqueda — issue #221 (heurística, nunca IA)", () => {
  it("texto vacío -> []", () => {
    expect(generarVariantesBusqueda("")).toEqual([]);
    expect(generarVariantesBusqueda("   ")).toEqual([]);
  });

  it("el término original siempre es el primero", () => {
    expect(generarVariantesBusqueda("reloj digital")[0]).toBe("reloj digital");
  });

  it("nunca repite una variante (ej. sin tildes cuando el término ya no tiene tildes)", () => {
    const variantes = generarVariantesBusqueda("reloj digital");
    const normalizadas = variantes.map((v) => v.toLowerCase());
    expect(new Set(normalizadas).size).toBe(normalizadas.length);
  });

  it("suma la variante sin tildes cuando el término tiene diacríticos", () => {
    const variantes = generarVariantesBusqueda("camión eléctrico");
    expect(variantes).toContain("camion electrico");
  });

  it("suma el orden de palabras invertido con 2+ palabras", () => {
    const variantes = generarVariantesBusqueda("reloj digital");
    expect(variantes).toContain("digital reloj");
  });

  it("con una sola palabra, nunca agrega la variante de orden invertido (sería idéntica al original)", () => {
    const variantes = generarVariantesBusqueda("camión");
    expect(variantes.filter((v) => v === "camión")).toHaveLength(1); // el original aparece una sola vez, nunca duplicado como "invertido"
  });

  it("alterna singular/plural del último token", () => {
    expect(generarVariantesBusqueda("reloj digital")).toContain("reloj digitals");
    expect(generarVariantesBusqueda("relojes digitales")).toContain("relojes digitale");
  });

  it("nunca devuelve más de `tope` variantes", () => {
    expect(generarVariantesBusqueda("camión eléctrico usado", 2)).toHaveLength(2);
    expect(generarVariantesBusqueda("camión eléctrico usado", 4).length).toBeLessThanOrEqual(4);
  });

  it("nunca inventa una palabra no relacionada con el término original", () => {
    const variantes = generarVariantesBusqueda("reloj digital");
    const palabrasOriginales = new Set(["reloj", "digital", "digitals"]);
    for (const variante of variantes) {
      for (const palabra of variante.split(/\s+/)) {
        expect(palabrasOriginales.has(palabra.toLowerCase())).toBe(true);
      }
    }
  });
});

describe("completarQueriesAnalizar — issue #225 (5 búsquedas: término + 4 variantes IA, respaldo de reglas)", () => {
  it("IA falla (array vacío) -> cae entero al respaldo de reglas, nunca deja a Analizar sin queries", () => {
    const queries = completarQueriesAnalizar("reloj digital", []);
    expect(queries[0]).toBe("reloj digital");
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.length).toBeLessThanOrEqual(TOPE_QUERIES_ANALIZAR);
    // Todo lo que no es el término original tiene que venir de la
    // heurística de reglas (generarVariantesBusqueda) — nunca inventado.
    const esperadas = new Set(generarVariantesBusqueda("reloj digital", TOPE_QUERIES_ANALIZAR).map((v) => v.toLowerCase()));
    for (const q of queries) expect(esperadas.has(q.toLowerCase())).toBe(true);
  });

  it("IA trae variantes con tilde/mayúsculas/espacios de más que YA están cubiertas por el término -> dedup, nunca repite, completa lo que falte con el respaldo de reglas", () => {
    // "Camión" con tilde y mayúscula distinta, y con espacios de más —
    // normalizarParaComparar (sin tildes + minúsculas + espacios
    // colapsados) tiene que verlas como la MISMA query que el término,
    // así que las dos variantes de la IA de abajo no suman nada nuevo
    // — lo único que llega a completar el resto es el respaldo de
    // reglas (generarVariantesBusqueda).
    const queries = completarQueriesAnalizar("camion electrico", ["CAMIÓN   ELECTRICO", "camion electrico"]);
    const normalizadas = queries.map((q) => q.toLowerCase());
    expect(new Set(normalizadas).size).toBe(normalizadas.length); // nunca una query duplicada
    expect(queries[0]).toBe("camion electrico");
    expect(queries.length).toBeGreaterThan(1); // el respaldo de reglas sí completó algo más
    expect(queries.length).toBeLessThanOrEqual(TOPE_QUERIES_ANALIZAR);
  });

  // Caso explícito pedido en la revisión del issue #225: un término con
  // tilde, una variante de IA que es el MISMO término sin tilde/con
  // mayúsculas distintas (tiene que deduplicarse) + 3 variantes de IA
  // genuinamente nuevas (quedan 4 únicas) + el respaldo de reglas
  // completando la quinta con una variante que la IA no trajo.
  it("caso tilde: dedup de una variante de IA que es el término sin tilde, respaldo de reglas completa hasta 5 únicas", () => {
    const queries = completarQueriesAnalizar("camión", ["CAMION", "camión usado", "vehiculo camion", "transporte pesado"]);

    expect(queries).toHaveLength(5);
    const normalizadas = queries.map((q) => q.toLowerCase());
    expect(new Set(normalizadas).size).toBe(5); // las 5 son de verdad distintas entre sí
    expect(queries[0]).toBe("camión");
    expect(queries).not.toContain("CAMION"); // dedup real: nunca entra como una query aparte del término
  });

  it("IA trae 4 variantes únicas reales -> se usan tal cual, sin tocar el respaldo de reglas", () => {
    const variantesIA = ["camion de carga", "camion pesado", "transporte de carga", "vehiculo de carga"];
    const queries = completarQueriesAnalizar("camion electrico", variantesIA);
    expect(queries).toEqual(["camion electrico", ...variantesIA]);
  });

  it("nunca devuelve más de TOPE_QUERIES_ANALIZAR aunque la IA traiga de más", () => {
    const variantesIA = ["uno dos", "tres cuatro", "cinco seis", "siete ocho", "nueve diez"];
    const queries = completarQueriesAnalizar("producto base", variantesIA);
    expect(queries.length).toBeLessThanOrEqual(TOPE_QUERIES_ANALIZAR);
  });

  it("término vacío -> [] (nunca llama a nada, nunca abre pestañas)", () => {
    expect(completarQueriesAnalizar("", ["algo"])).toEqual([]);
    expect(completarQueriesAnalizar("   ", [])).toEqual([]);
  });
});
