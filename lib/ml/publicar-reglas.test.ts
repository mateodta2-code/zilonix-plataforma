import { describe, expect, it } from "vitest";
import type { DefinicionAtributoMl } from "@/lib/ml/publicar-tipos";
import {
  aplicarReglaSaleFormat,
  aplicarRespaldoDimensionesProducto,
  canonicalizarValorListaCerrada,
  clipRequiereReputacion,
  conUnidadSiHaceFalta,
  decidirAtributoGtin,
  detectarGeneroPorTitulo,
  esErrorDeFamilyName,
  esGtinReal,
  esRechazoDeVariantesPorCategoria,
  esValorNumericoValido,
  exigeGtinPorMarca,
  faltanDimensionesPaquete,
  itemNoModificablePorRevision,
  limitarStock,
  marcaGenerica,
  ReglaSaleFormatError,
  resolverIdsPaquete,
  truncarTitulo,
  valorAutocompletadoSeguro,
  ValorListaCerradaInvalidoError,
} from "./publicar-reglas";

// Tarea 2.11 — cada prueba de acá cubre una regla real reportada en vivo
// contra el Zilonix OS actual (ver comentarios de publicar-reglas.ts).
// El objetivo no es solo "la función anda" sino "este caso real exacto
// ya no se vuelve a romper".

describe("esGtinReal — caso real: 'Noaplica' escrito a mano (Débora, cuenta juliana)", () => {
  it("rechaza las formas de decir 'no tengo código'", () => {
    expect(esGtinReal("Noaplica")).toBe(false);
    expect(esGtinReal("No aplica")).toBe(false);
    expect(esGtinReal("N/A")).toBe(false);
    expect(esGtinReal("na")).toBe(false);
    expect(esGtinReal("Ninguno")).toBe(false);
    expect(esGtinReal("No tiene")).toBe(false);
    expect(esGtinReal("")).toBe(false);
    expect(esGtinReal(null)).toBe(false);
    expect(esGtinReal(undefined)).toBe(false);
  });
  it("acepta un código real", () => {
    expect(esGtinReal("7701234567890")).toBe(true);
  });
});

describe("marcaGenerica", () => {
  const brandDef: DefinicionAtributoMl = { id: "BRAND", name: "Marca", values: [{ name: "Abercrombie & Fitch" }, { name: "Genérica" }] };
  it("encuentra la opción genérica real, nunca inventa un nombre", () => {
    expect(marcaGenerica(brandDef)?.name).toBe("Genérica");
  });
  it("sin opción genérica en la categoría, no hay nada que reintentar", () => {
    expect(marcaGenerica({ id: "BRAND", name: "Marca", values: [{ name: "Nike" }] })).toBeNull();
    expect(marcaGenerica(null)).toBeNull();
  });
});

describe("conUnidadSiHaceFalta — caso real: 'Calostro En Polvo...' 0/2, POWER Esterilizador Grownsy, DIAMETER Melissa", () => {
  it("agrega la unidad a un número puro", () => {
    expect(conUnidadSiHaceFalta("NET_WEIGHT", "1200")).toBe("1200 g");
    expect(conUnidadSiHaceFalta("POWER", "750")).toBe("750 W");
    expect(conUnidadSiHaceFalta("DIAMETER", "15")).toBe("15 cm");
    expect(conUnidadSiHaceFalta("INNER_DIAMETER", "15")).toBe("15 cm");
    expect(conUnidadSiHaceFalta("MIN_RECOMMENDED_AGE", "3")).toBe("3 años");
  });
  it("no toca un valor que ya trae letras", () => {
    expect(conUnidadSiHaceFalta("NET_WEIGHT", "1.2 kg")).toBe("1.2 kg");
    expect(conUnidadSiHaceFalta("POWER", "No aplica")).toBe("No aplica");
  });
  it("no le agrega ninguna unidad a un atributo sin regla (ej. conteo _NUMBER)", () => {
    expect(conUnidadSiHaceFalta("SPEEDS_NUMBER", "5")).toBe("5");
  });
});

describe("esValorNumericoValido — caso real: combo 'tatiana', item.attribute.number_invalid_format", () => {
  it("'N/A' no es un número válido", () => {
    expect(esValorNumericoValido("N/A")).toBe(false);
    expect(esValorNumericoValido("No aplica")).toBe(false);
  });
  it("un número (con o sin decimales) sí es válido", () => {
    expect(esValorNumericoValido("20")).toBe(true);
    expect(esValorNumericoValido("20.5")).toBe(true);
    expect(esValorNumericoValido("20,5")).toBe(true);
  });
});

describe("detectarGeneroPorTitulo — caso real: 'Brazaletes para Mujer X3 Dorados 14K', Melissa, invalid.title.gender", () => {
  const valores = [{ name: "Hombre" }, { name: "Mujer" }, { name: "Unisex" }, { name: "Niño" }, { name: "Niña" }];
  it("detecta 'Mujer' en el título real", () => {
    expect(detectarGeneroPorTitulo("Brazaletes para Mujer X3 Dorados 14K", valores)?.name).toBe("Mujer");
  });
  it("detecta 'Hombre' con 'Caballero'", () => {
    expect(detectarGeneroPorTitulo("Reloj para Caballero clásico", valores)?.name).toBe("Hombre");
  });
  it("niño/niña se detectan antes que hombre/mujer y no chocan entre sí", () => {
    expect(detectarGeneroPorTitulo("Zapatos para Niña talla 22", valores)?.name).toBe("Niña");
    expect(detectarGeneroPorTitulo("Zapatos para Niño talla 22", valores)?.name).toBe("Niño");
  });
  it("sin ninguna palabra de género en el título, cae a Unisex", () => {
    expect(detectarGeneroPorTitulo("Mochila impermeable 30L", valores)?.name).toBe("Unisex");
  });
});

describe("aplicarReglaSaleFormat — tres iteraciones reales: Débora 0/8 (vacío), 'Kit 5 Botellas de Viaje' (5≠1), caso espejo Pack", () => {
  it("Unidad + vacío ⇒ se fuerza a 1 (Débora, 0/8)", () => {
    expect(aplicarReglaSaleFormat({ SALE_FORMAT: "Unidad" }).UNITS_PER_PACK).toBe("1");
  });
  it("Unidad + un número válido pero distinto de 1 ⇒ se fuerza a 1 igual (Kit 5 Botellas de Viaje)", () => {
    expect(aplicarReglaSaleFormat({ SALE_FORMAT: "Unidad", UNITS_PER_PACK: "5" }).UNITS_PER_PACK).toBe("1");
  });
  it("Unidad + ya en 1 ⇒ no cambia", () => {
    expect(aplicarReglaSaleFormat({ SALE_FORMAT: "Unidad", UNITS_PER_PACK: "1" }).UNITS_PER_PACK).toBe("1");
  });
  it("Pack + vacío ⇒ falla ANTES de llamar a Mercado Libre (caso espejo, Mateo 25/9)", () => {
    expect(() => aplicarReglaSaleFormat({ SALE_FORMAT: "Pack" })).toThrow(ReglaSaleFormatError);
  });
  it("Pack + '1' ⇒ también falla (1 no es un pack real)", () => {
    expect(() => aplicarReglaSaleFormat({ SALE_FORMAT: "Pack", UNITS_PER_PACK: "1" })).toThrow(ReglaSaleFormatError);
  });
  it("Pack + número real > 1 ⇒ se respeta tal cual", () => {
    expect(aplicarReglaSaleFormat({ SALE_FORMAT: "Pack", UNITS_PER_PACK: "3" }).UNITS_PER_PACK).toBe("3");
  });
  it("sin SALE_FORMAT, no toca nada", () => {
    expect(aplicarReglaSaleFormat({ OTRO: "x" })).toEqual({ OTRO: "x" });
  });
});

describe("aplicarRespaldoDimensionesProducto — caso real: Mateo 8 cuentas, 'Esterilizador Grownsy' 4/8", () => {
  const dim = { peso: "500", largo: "20", ancho: "15", alto: "10" };
  it("vacío ⇒ usa el respaldo del paquete con su unidad", () => {
    const r = aplicarRespaldoDimensionesProducto({}, dim);
    expect(r.WIDTH).toBe("15 cm"); // ancho
    expect(r.HEIGHT).toBe("10 cm"); // alto
    expect(r.LENGTH).toBe("20 cm"); // largo
    expect(r.WEIGHT).toBe("500 g"); // peso
  });
  it("número puro ya puesto ⇒ se le agrega unidad, nunca se pisa con el respaldo", () => {
    const r = aplicarRespaldoDimensionesProducto({ WIDTH: "99" }, dim);
    expect(r.WIDTH).toBe("99 cm");
  });
  it("ya trae letras (o 'No aplica') ⇒ se deja intacto", () => {
    const r = aplicarRespaldoDimensionesProducto({ WIDTH: "No aplica", HEIGHT: "5 in" }, dim);
    expect(r.WIDTH).toBe("No aplica");
    expect(r.HEIGHT).toBe("5 in");
  });
  it("vacío y sin respaldo tampoco ⇒ se omite la clave (nunca basura)", () => {
    const r = aplicarRespaldoDimensionesProducto({}, {});
    expect(r.WIDTH).toBeUndefined();
    expect(r.WEIGHT).toBeUndefined();
  });
});

describe("resolverIdsPaquete — caso real: Melissa, 'Juguetes para Piñata' MCO457486, x3", () => {
  it("categoría nueva que expone los 4 en MAYÚSCULA", () => {
    const ids = resolverIdsPaquete(new Set(["SELLER_PACKAGE_WEIGHT", "SELLER_PACKAGE_LENGTH", "SELLER_PACKAGE_WIDTH", "SELLER_PACKAGE_HEIGHT"]));
    expect(ids.peso).toBe("SELLER_PACKAGE_WEIGHT");
    expect(ids.alto).toBe("SELLER_PACKAGE_HEIGHT");
  });
  it("categoría de siempre (ninguna de las dos formas listada) ⇒ cae a minúscula", () => {
    const ids = resolverIdsPaquete(new Set(["OTRO_ATRIBUTO"]));
    expect(ids.peso).toBe("seller_package_weight");
  });
});

describe("canonicalizarValorListaCerrada — caso real: Mateo 28/9, SUPPLEMENT_CLASS 'Colágeno hidrolizado'", () => {
  const def: DefinicionAtributoMl = {
    id: "SUPPLEMENT_CLASS",
    name: "Clase del suplemento",
    value_type: "list",
    values: [{ name: "Colágeno Hidrolizado" }, { name: "Proteína" }],
  };
  it("coincide sin importar mayúsculas/tildes/espacios, y manda el nombre EXACTO de ML", () => {
    expect(canonicalizarValorListaCerrada(def, "colageno hidrolizado")).toBe("Colágeno Hidrolizado");
  });
  it("sin coincidencia real, avisa con las opciones válidas en vez de dejar pasar el texto", () => {
    expect(() => canonicalizarValorListaCerrada(def, "Vitamina C")).toThrow(ValorListaCerradaInvalidoError);
  });
  it("si el atributo no es de lista cerrada, deja el texto tal cual", () => {
    expect(canonicalizarValorListaCerrada({ id: "X", name: "X", value_type: "string" }, "cualquier cosa")).toBe("cualquier cosa");
  });
});

describe("valorAutocompletadoSeguro — nunca toma values[0] a ciegas (caso real BRAND 'Abercrombie & Fitch')", () => {
  it("BRAND sin opción genérica ⇒ cae al primer valor (no hay opción más segura)", () => {
    const v = valorAutocompletadoSeguro("BRAND", "Cualquier producto", [{ name: "Abercrombie & Fitch" }]);
    expect(v.name).toBe("Abercrombie & Fitch");
  });
  it("BRAND con opción genérica disponible ⇒ se prefiere esa, nunca la marca real", () => {
    const v = valorAutocompletadoSeguro("BRAND", "Cualquier producto", [{ name: "Abercrombie & Fitch" }, { name: "Genérica" }]);
    expect(v.name).toBe("Genérica");
  });
  it("GENDER usa el título, no una regla genérica", () => {
    const v = valorAutocompletadoSeguro("GENDER", "Reloj para Mujer", [{ name: "Hombre" }, { name: "Mujer" }, { name: "Unisex" }]);
    expect(v.name).toBe("Mujer");
  });
});

describe("decidirAtributoGtin — árbol de decisión real (MCO8830 dept supply, MCO39965 FullyLemon)", () => {
  const emptyGtinDef: DefinicionAtributoMl = {
    id: "EMPTY_GTIN_REASON",
    name: "Motivo",
    values: [{ name: "El producto no tiene código registrado" }, { name: "Otro motivo" }],
  };
  it("GTIN real escrito a mano ⇒ se manda tal cual", () => {
    expect(decidirAtributoGtin("7701234567890", emptyGtinDef)).toEqual({ id: "GTIN", value_name: "7701234567890" });
  });
  it("sin GTIN real, categoría ofrece EMPTY_GTIN_REASON ⇒ se usa el mecanismo oficial", () => {
    expect(decidirAtributoGtin(undefined, emptyGtinDef)).toEqual({ id: "EMPTY_GTIN_REASON", value_name: "El producto no tiene código registrado" });
  });
  it("sin GTIN real y SIN EMPTY_GTIN_REASON en la categoría (MCO39965) ⇒ GTIN='No aplica' de respaldo", () => {
    expect(decidirAtributoGtin(undefined, null)).toEqual({ id: "GTIN", value_name: "No aplica" });
  });
  it("'Noaplica' escrito a mano se trata igual que vacío (no como GTIN real)", () => {
    expect(decidirAtributoGtin("Noaplica", emptyGtinDef)).toEqual({ id: "EMPTY_GTIN_REASON", value_name: "El producto no tiene código registrado" });
  });
});

describe("truncarTitulo / limitarStock — límites duros de Mercado Libre", () => {
  it("título a 60 caracteres", () => {
    expect(truncarTitulo("x".repeat(80)).length).toBe(60);
  });
  it("stock tope 99999 (Available quantity max. value is 99999)", () => {
    expect(limitarStock(500000)).toBe(99999);
    expect(limitarStock(10)).toBe(10);
    expect(limitarStock(NaN)).toBe(1);
  });
});

describe("detección de errores reales por regex sobre la respuesta cruda de Mercado Libre", () => {
  it("family_name inválido", () => {
    expect(esErrorDeFamilyName("The field family name is invalid")).toBe(true);
    expect(esErrorDeFamilyName("algo totalmente distinto")).toBe(false);
  });
  it("exige GTIN por marca registrada", () => {
    expect(exigeGtinPorMarca('{"cause":[{"code":"item.attribute.missing_conditional_required","references":["[GTIN]"]}]}')).toBe(true);
    expect(exigeGtinPorMarca("missing_conditional_required sin GTIN mencionado")).toBe(false);
  });
  it("rechazo de variantes por categoría User Products", () => {
    expect(esRechazoDeVariantesPorCategoria("variations field is invalid for this family")).toBe(true);
  });
  it("faltan dimensiones del paquete (Melissa, 22/9)", () => {
    expect(faltanDimensionesPaquete("item.attribute.missing.seller.package.dimensions")).toBe(true);
  });
  it("item bajo revisión, no se puede pausar/activar (Mateo 25/9)", () => {
    expect(itemNoModificablePorRevision("item.status.not_modifiable")).toBe(true);
  });
  it("clip exige reputación (Mateo, 28/9, FullyLemon)", () => {
    expect(clipRequiereReputacion("PA_UNAUTHORIZED_RESULT_FROM_POLICIES")).toBe(true);
  });
});
