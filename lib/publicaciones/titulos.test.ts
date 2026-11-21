import { afterEach, describe, expect, it, vi } from "vitest";
import { tendenciasCategoriaMl } from "@/lib/ml/cliente";
import { leerFicha } from "@/lib/publicaciones/ficha";
import { leerPropuestaTitulos, limpiarTitulo, nombresPropios, origenPalabras, recortarPorPalabra, sinMayusculaCadaPalabra } from "@/lib/publicaciones/titulos";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

describe("reglas del título (en código, no solo pedidas a la IA)", () => {
  it("recorta a 60 y a 120 por palabra completa", () => {
    const largo = "Termo de acero inoxidable de un litro para café caliente y agua fría todo el día";
    const r60 = recortarPorPalabra(largo, 60);
    expect(r60.length).toBeLessThanOrEqual(60);
    expect(largo.startsWith(r60)).toBe(true);
    expect(largo.charAt(r60.length)).toBe(" ");
    expect(recortarPorPalabra(`${largo} ${largo}`, 120).length).toBeLessThanOrEqual(120);
  });

  it("quita Mayúscula En Cada Palabra y conserva tildes, siglas y nombres propios", () => {
    expect(sinMayusculaCadaPalabra("Termo Térmico Acero Inoxidable 1L Café")).toBe("Termo térmico acero inoxidable 1L café");
    expect(sinMayusculaCadaPalabra("Cable USB Tipo C Samsung", ["Samsung"])).toBe("Cable USB tipo C Samsung");
  });

  it("saca promoción, precios y símbolos", () => {
    expect(limpiarTitulo("¡Oferta! Termo Acero 1 L Envío Gratis $59.900 ★", 60)).toBe("Termo acero 1 L");
    expect(limpiarTitulo("x", 60)).toBeNull();
  });

  it("conserva los porcentajes que describen el producto; quita solo los de descuento", () => {
    expect(limpiarTitulo("Camiseta 100% Algodón Talla M", 60)).toBe("Camiseta 100% algodón talla M");
    expect(limpiarTitulo("Crema 99 % Natural 50 g", 60)).toBe("Crema 99 % natural 50 g");
    expect(limpiarTitulo("Camiseta algodón 20% off", 60)).toBe("Camiseta algodón");
    expect(limpiarTitulo("Camiseta algodón 50 % dcto", 60)).toBe("Camiseta algodón");
    expect(limpiarTitulo("Camiseta algodón 30% de descuento", 60)).toBe("Camiseta algodón");
    expect(limpiarTitulo("Camiseta algodão 15% desconto", 60)).toBe("Camiseta algodão");
  });

  it("los nombres propios salen del nombre de la ficha, salvo si viene todo en Mayúscula Cada Palabra", () => {
    expect(nombresPropios(leerFicha({ nombre: { valor: "Termo térmico Stanley Classic", origen: "vendedor" } }))).toEqual(["Stanley", "Classic"]);
    expect(nombresPropios(leerFicha({ nombre: { valor: "Termo Térmico Acero Inoxidable", origen: "vendedor" } }))).toEqual([]);
  });
});

describe("propuesta y origen de las palabras", () => {
  const ficha = leerFicha({ nombre: { valor: "Termo de acero", origen: "vendedor" }, material: { valor: "Acero inoxidable", origen: "foto" } });

  it("el origen lo calcula el código: tendencia, vendedor o sugerida por la IA", () => {
    const p = origenPalabras(["Termo acero inoxidable 1 L para café"], ["termo para cafe", "botilito"], "Termo de acero inoxidable");
    expect(p).toEqual([
      { palabra: "Termo", origen: "tendencia" },
      { palabra: "acero", origen: "vendedor" },
      { palabra: "inoxidable", origen: "vendedor" },
      { palabra: "para", origen: "tendencia" },
      { palabra: "café", origen: "tendencia" },
    ]);
  });

  it("lee el JSON, limpia cada título y sin tendencias sigue funcionando", () => {
    const r = leerPropuestaTitulos('{"titulos": ["Termo De Acero Inoxidable 1 L Oferta", "Termo De Acero Inoxidable 1 L Oferta", "Botella térmica de acero 1 L"], "catalogo": "Termo de acero inoxidable 1 L para bebidas frías y calientes"}', {
      ficha,
      tendencias: [],
      info: "Capacidad 1 L",
    });
    expect(r?.titulos).toEqual(["Termo de acero inoxidable 1 L", "Botella térmica de acero 1 L"]);
    expect(r?.catalogo).toBe("Termo de acero inoxidable 1 L para bebidas frías y calientes");
    expect(leerPropuestaTitulos("nada", { ficha, tendencias: [], info: "" })).toBeNull();
  });

  it("descarta títulos con cifras que no están en la ficha ni en el texto del vendedor", () => {
    const r = leerPropuestaTitulos('{"titulos": ["Termo de acero 12 horas caliente", "Termo de acero inoxidable 1 L"]}', { ficha, tendencias: [], info: "Capacidad 1 L" });
    expect(r?.titulos).toEqual(["Termo de acero inoxidable 1 L"]);
  });
});

describe("tendenciasCategoriaMl", () => {
  it("usa el site y la categoría de la cuenta (nunca MCO fijo) y lee keyword", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ keyword: "termo stanley", url: "x" }, { keyword: "" }, {}]), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await tendenciasCategoriaMl("MLB", "MLB1234", "token")).toEqual(["termo stanley"]);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("/trends/MLB/MLB1234");
  });

  it("si falla o la categoría no es del país, null (los títulos siguen sin tendencias)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    expect(await tendenciasCategoriaMl("MLB", "MLB1234", "token")).toBeNull();
    expect(await tendenciasCategoriaMl("MLB", "MCO1234", "token")).toBeNull();
  });
});
