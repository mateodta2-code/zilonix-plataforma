import { describe, expect, it } from "vitest";
import { generarVariantesBusqueda } from "./variantesBusqueda";

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
