import { afterEach, describe, expect, it, vi } from "vitest";
import { categoriasPorNivel, tendenciasCategoriaMl } from "@/lib/ml/cliente";
import { leerFicha } from "@/lib/publicaciones/ficha";
import { createHash } from "node:crypto";
import { PROMPT_TITULOS_RECOMENDADO } from "@/lib/publicaciones/prompt-titulos-recomendado";
import { CANTIDAD_TITULOS, leerPropuestaTitulos, limpiarKeywords, promptTitulos, limpiarTitulo, nombresPropios, origenPalabras, recortarPorPalabra, sinMayusculaCadaPalabra, unirTendenciasPorNivel, filtrarTendenciasRelacionadas } from "@/lib/publicaciones/titulos";

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
    expect(limpiarTitulo("Camiseta algodón 15% dto", 60)).toBe("Camiseta algodón");
    expect(limpiarTitulo("Camiseta algodón 40% de dcto", 60)).toBe("Camiseta algodón");
    expect(limpiarTitulo("Camiseta algodón 25  %  off", 60)).toBe("Camiseta algodón");
    expect(limpiarTitulo("Camiseta 100%  algodón", 60)).toBe("Camiseta 100% algodón");
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

describe("tendencias por nivel de categoría (23-nov)", () => {
  it("unirTendenciasPorNivel: sin repetir, queda el nivel más alto, ordena alta → baja", () => {
    const r = unirTendenciasPorNivel([
      { nivel: "baja", palabras: ["bebedero colibri", "comedero colibri"] },
      { nivel: "media", palabras: ["comederos para pajaros"] },
      { nivel: "alta", palabras: ["Bebedero Colibri", "bebedero para aves"] },
    ]);
    expect(r).toEqual([
      { palabra: "Bebedero Colibri", nivel: "alta" },
      { palabra: "bebedero para aves", nivel: "alta" },
      { palabra: "comederos para pajaros", nivel: "media" },
      { palabra: "comedero colibri", nivel: "baja" },
    ]);
  });

  it("origenPalabras: las de tendencia llevan su nivel; las demás no", () => {
    const p = origenPalabras(["Bebedero colibrí vidrio"], ["bebedero colibri"], "vidrio", [{ palabra: "bebedero colibri", nivel: "media" }]);
    expect(p.find((x) => x.palabra === "Bebedero")).toMatchObject({ origen: "tendencia", nivel: "media" });
    expect(p.find((x) => x.palabra === "vidrio")).toEqual({ palabra: "vidrio", origen: "vendedor" });
  });
});

describe("categoriasPorNivel (ruta de /categories/{id})", () => {
  it("específica, padre y general sin repetir", () => {
    const ruta = [
      { id: "MCO1071", name: "Animales y Mascotas" },
      { id: "MCO1100", name: "Aves" },
      { id: "MCO4321", name: "Bebederos y Comederos" },
    ];
    expect(categoriasPorNivel(ruta, "MCO4321")).toEqual([
      { nivel: "baja", categoriaId: "MCO4321", nombre: "Bebederos y Comederos" },
      { nivel: "media", categoriaId: "MCO1100", nombre: "Aves" },
      { nivel: "alta", categoriaId: "MCO1071", nombre: "Animales y Mascotas" },
    ]);
    // Ruta de 2: no hay «general» aparte de la padre.
    expect(categoriasPorNivel(ruta.slice(1), "MCO4321").map((c) => c.nivel)).toEqual(["baja", "media"]);
    // Sin ruta: solo la específica.
    expect(categoriasPorNivel([], "MCO4321")).toEqual([{ nivel: "baja", categoriaId: "MCO4321", nombre: "MCO4321" }]);
  });
});

describe("filtrarTendenciasRelacionadas (24-nov: «Mascotas» para un bebedero de colibrí)", () => {
  const producto = "Pack de 2 comederos colibrí base roja plástico transparente para ventana";
  const categoria = "Bebederos y Comederos";

  it("de la general y la padre solo quedan las que nombran el tipo de producto de la categoría; la específica completa", () => {
    const r = filtrarTendenciasRelacionadas(
      [
        { nivel: "baja" as const, palabras: ["bebedero colibri", "alpiste"] },
        { nivel: "media" as const, palabras: ["jaula para aves", "comedero para pajaros"] },
        { nivel: "alta" as const, palabras: ["dispensador comida gato", "guacal para gatos", "cerdo minipig", "comederos automaticos perro"] },
      ],
      producto,
      categoria
    );
    expect(r.niveles).toEqual([
      { nivel: "baja", palabras: ["bebedero colibri", "alpiste"] },
      { nivel: "media", palabras: ["comedero para pajaros"] },
      { nivel: "alta", palabras: ["comederos automaticos perro"] },
    ]);
    expect(r.descartadas).toBe(4);
  });

  it("una palabra del material o del uso («transparente», «ventana») no basta (24-nov)", () => {
    const r = filtrarTendenciasRelacionadas(
      [
        { nivel: "alta" as const, palabras: ["cama flotante asoleadora para gato ventana hamaca color aguamarina transparente"] },
        { nivel: "media" as const, palabras: ["venta de aves agapornis", "desparasitante para aves", "bebederos para gallinas ponedoras"] },
      ],
      producto,
      categoria
    );
    expect(r.niveles).toEqual([{ nivel: "media", palabras: ["bebederos para gallinas ponedoras"] }]);
    expect(r.descartadas).toBe(3);
  });

  it("si la categoría no tiene palabras importantes, se compara con el producto", () => {
    const r = filtrarTendenciasRelacionadas([{ nivel: "alta" as const, palabras: ["comedero colibri vidrio", "cerdo minipig"] }], producto, "Otros");
    expect(r.niveles).toEqual([{ nivel: "alta", palabras: ["comedero colibri vidrio"] }]);
  });

  it("palabras vacías («para», «color», «pack») no hacen coincidir nada", () => {
    const r = filtrarTendenciasRelacionadas([{ nivel: "alta" as const, palabras: ["cama para gato color aguamarina", "pack de juguetes"] }], producto, categoria);
    expect(r.niveles).toEqual([]);
    expect(r.descartadas).toBe(2);
  });

  it("máximo 10 por nivel", () => {
    const muchas = Array.from({ length: 25 }, (_, i) => `bebedero colibri ${i}`);
    const r = filtrarTendenciasRelacionadas([{ nivel: "baja" as const, palabras: muchas }], producto);
    expect(r.niveles[0].palabras).toHaveLength(10);
  });
});

const ficha = leerFicha({ nombre: { valor: "Termo de acero", origen: "vendedor" }, material: { valor: "Acero inoxidable", origen: "foto" } });

describe("prompt recomendado de títulos", () => {
  it("es el texto de Mateo sin cambios", () => {
    expect(createHash("sha256").update(PROMPT_TITULOS_RECOMENDADO).digest("hex")).toBe("e9ace074f9753b455d855c5e09fd743beef1cf6dc8d2151c6155c5f8115048ea");
    expect(PROMPT_TITULOS_RECOMENDADO.startsWith("# 1. INVESTIGACIÓN ESTRATÉGICA DEL PRODUCTO")).toBe(true);
    expect(PROMPT_TITULOS_RECOMENDADO.endsWith("podrán aprovecharse posteriormente en la descripción.")).toBe(true);
  });

  it("promptTitulos empieza con el recomendado y termina con el bloque JSON", () => {
    const p = promptTitulos({ ficha, idioma: "español", pais: "Colombia", categoria: "Termos", tendencias: ["termo"], info: "" });
    expect(p.startsWith(PROMPT_TITULOS_RECOMENDADO)).toBe(true);
    expect(p).toContain("Categoría de Mercado Libre: Termos");
    expect(p.endsWith("No escribas el número de caracteres: lo cuenta el sistema.")).toBe(true);
    expect(p).toContain('"keywordsNoUtilizadas"');
  });
});

describe("limpiarKeywords", () => {
  it("deja solo strings limpios, sin repetidos, símbolos, promoción ni cifras inventadas", () => {
    const r = limpiarKeywords(["Termo", "termo", "TÉRMO ", 5, "x", "termo ★ acero", "oferta", "botella 12 horas", "botella 1 L", "a".repeat(41)], 20, "Capacidad 1 L");
    expect(r).toEqual(["Termo", "termo acero", "botella 1 L"]);
    expect(limpiarKeywords("nada")).toEqual([]);
    expect(limpiarKeywords(Array.from({ length: 30 }, (_, i) => `palabra${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`))).toHaveLength(20);
  });
});

describe("leerPropuestaTitulos con 10 títulos y keywords", () => {
  const titulos = Array.from({ length: 12 }, (_, i) => `Termo de acero inoxidable modelo ${String.fromCharCode(97 + i)}`);
  it("tope de 10, keywords limpias y vacías si la IA no las manda", () => {
    const r = leerPropuestaTitulos(JSON.stringify({ titulos, keywordsPrincipales: ["termo", "Termo", "termo 99 L"], keywordsNoUtilizadas: ["botilito"] }), { ficha, tendencias: [], info: "" });
    expect(CANTIDAD_TITULOS).toBe(10);
    expect(r?.titulos).toHaveLength(10);
    expect(r?.keywordsPrincipales).toEqual(["termo"]);
    expect(r?.keywordsNoUtilizadas).toEqual(["botilito"]);
    const sin = leerPropuestaTitulos(JSON.stringify({ titulos }), { ficha, tendencias: [], info: "" });
    expect(sin?.keywordsPrincipales).toEqual([]);
    expect(sin?.keywordsNoUtilizadas).toEqual([]);
  });
  it("un título de más de 60 se corta por palabra", () => {
    const r = leerPropuestaTitulos(JSON.stringify({ titulos: ["Termo de acero inoxidable para bebidas frías y calientes con tapa rosca"] }), { ficha, tendencias: [], info: "" });
    expect(r?.titulos[0].length).toBeLessThanOrEqual(60);
  });
});
