import { afterEach, describe, expect, it, vi } from "vitest";
import { categoriasPorNivel, tendenciasCategoriaMl } from "@/lib/ml/cliente";
import { leerFicha } from "@/lib/publicaciones/ficha";
import { leerPropuestaTitulos, limpiarTitulo, nombresPropios, origenPalabras, promptTitulos, recortarPorPalabra, sinMayusculaCadaPalabra, unirTendenciasPorNivel, filtrarTendenciasRelacionadas } from "@/lib/publicaciones/titulos";

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

describe("palabras de la competencia", () => {
  it("una palabra que solo está en el título de la competencia queda como «competencia»", () => {
    const p = origenPalabras(["Bebedero colibrí picaflor"], [], "bebedero colibrí", [], "Bebedero Colibri Picaflor X2");
    expect(p.find((x) => x.palabra === "picaflor")).toEqual({ palabra: "picaflor", origen: "competencia" });
    expect(p.find((x) => x.palabra === "Bebedero")).toMatchObject({ origen: "vendedor" });
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

describe("más vendidos de la categoría como idea de palabras (25-nov)", () => {
  it("una palabra que solo está en los más vendidos sale «De los más vendidos»; la competencia manda si está en los dos", () => {
    const p = origenPalabras(["Lápices de colores profesionales artísticos"], [], "lápices de colores", [], "Colores artísticos", "Colores Profesionales X72 Lápices Artísticos");
    expect(p.find((x) => x.palabra === "profesionales")).toEqual({ palabra: "profesionales", origen: "mas_vendidos" });
    expect(p.find((x) => x.palabra === "artísticos")).toEqual({ palabra: "artísticos", origen: "competencia" });
  });

  it("el prompt los lista como idea, sin copiarlos; sin más vendidos no aparece esa parte", () => {
    const ficha = leerFicha({ nombre: { valor: "Lápices de colores", origen: "vendedor" } });
    const con = promptTitulos({ ficha, idioma: "español", pais: "Colombia", categoria: "Lápices", tendencias: [], info: "", masVendidos: ["Colores Profesionales X72", "Set 48 Lápices"] });
    expect(con).toContain("Títulos de los más vendidos de la categoría");
    expect(con).toContain("- Colores Profesionales X72\n- Set 48 Lápices");
    expect(con).toContain("no los copies");
    const sin = promptTitulos({ ficha, idioma: "español", pais: "Colombia", categoria: "Lápices", tendencias: [], info: "" });
    expect(sin).not.toContain("más vendidos");
  });
});
