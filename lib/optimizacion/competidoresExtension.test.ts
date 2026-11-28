import { describe, expect, it } from "vitest";
import {
  alertasCompetidoresExtension,
  esFotoMlValida,
  leerMensajeCompetidores,
  paisDeSitio,
  rotuloAntiguedad,
  terminoDesdeTitulo,
  textoRazonCompetidores,
} from "@/lib/optimizacion/competidoresExtension";

const PROPIA = "MCO1342632705";

function mensaje(competidores: unknown[], extra: Record<string, unknown> = {}) {
  return { fuente: "zilonix-extension", tipo: "competidores-leidos", payload: { excluirItemId: PROPIA, termino: "tijera ingletiadora", candidatos: competidores.length, competidores, ...extra } };
}

const COMPETIDOR = {
  itemId: "MCO111111111",
  link: "https://articulo.mercadolibre.com.co/MCO-111111111-tijera-_JM",
  titulo: "Tijera ingletiadora",
  foto: "https://http2.mlstatic.com/D_NQ_NP_123-O.webp",
  vendedor: "HERRAMIENTAS SAS",
  precio: 49_900,
  precioAnterior: 59_900,
  descuentoPorcentaje: 16,
  vendidos: 500,
  vendidosExacto: false,
  calificacion: 4.7,
  numeroOpiniones: 120,
  esCatalogo: false,
  esFull: true,
  envioGratis: true,
  fotos: 8,
  descripcion: true,
  vendidosEstimados: 1100,
  antiguedadDias: 400,
  ventasMes: 82,
  facturacionMes: 4_091_800,
  leidoDeFicha: true,
};

describe("leerMensajeCompetidores (nunca confía en el postMessage)", () => {
  it("lee un resultado válido con lo mismo que muestra el panel de la extensión", () => {
    const m = leerMensajeCompetidores(mensaje([COMPETIDOR]), PROPIA);
    expect(m?.tipo).toBe("ok");
    if (m?.tipo !== "ok") return;
    expect(m.competidores).toHaveLength(1);
    expect(m.competidores[0]).toMatchObject({ precio: 49_900, vendidos: 500, vendidosExacto: false, full: true, envioGratis: true, ventasMes: 82, fotos: 8 });
  });

  it("ignora mensajes de otra publicación, de otra fuente o de otro tipo", () => {
    expect(leerMensajeCompetidores(mensaje([COMPETIDOR], { excluirItemId: "MCO999999999" }), PROPIA)).toBeNull();
    expect(leerMensajeCompetidores({ ...mensaje([COMPETIDOR]), fuente: "zilonix-panel" }, PROPIA)).toBeNull();
    expect(leerMensajeCompetidores({ ...mensaje([COMPETIDOR]), tipo: "listado-importado" }, PROPIA)).toBeNull();
    expect(leerMensajeCompetidores(null, PROPIA)).toBeNull();
  });

  it("descarta links fuera de Mercado Libre y fotos que no son de mlstatic", () => {
    const m = leerMensajeCompetidores(
      mensaje([
        { ...COMPETIDOR, link: "https://mercadolibre.com.co.evil.com/MCO-1" },
        { ...COMPETIDOR, link: "http://articulo.mercadolibre.com.co/MCO-1" },
        { ...COMPETIDOR, foto: "https://evilmlstatic.com/x.jpg" },
      ]),
      PROPIA
    );
    expect(m?.tipo === "ok" && m.competidores).toHaveLength(1);
    expect(m?.tipo === "ok" && m.competidores[0].foto).toBeNull();
  });

  it("datos raros quedan en null (nunca un 0 inventado)", () => {
    const m = leerMensajeCompetidores(
      mensaje(Array.from({ length: 15 }, () => ({ ...COMPETIDOR, precio: "49900", vendidos: -3, calificacion: 9, esFull: "sí" }))),
      PROPIA
    );
    if (m?.tipo !== "ok") throw new Error("esperaba ok");
    expect(m.competidores).toHaveLength(15);
    expect(m.competidores[0]).toMatchObject({ precio: null, vendidos: null, calificacion: null, full: null });
  });

  it("un error trae su razón, con un texto legible", () => {
    const m = leerMensajeCompetidores({ fuente: "zilonix-extension", tipo: "competidores-error", payload: { excluirItemId: PROPIA, razon: "captcha" } }, PROPIA);
    expect(m).toEqual({ tipo: "error", itemId: PROPIA, razon: "captcha" });
    expect(textoRazonCompetidores("captcha")).toMatch(/verificar/);
    expect(textoRazonCompetidores("rara")).toMatch(/Intenta de nuevo/);
  });
});

describe("alertas frente a los competidores de la búsqueda", () => {
  it("precio, envío gratis y Full, como en la comparación de catálogo", () => {
    const m = leerMensajeCompetidores(mensaje([COMPETIDOR, { ...COMPETIDOR, itemId: "MCO222222222", esFull: false, precio: 60_000 }]), PROPIA);
    if (m?.tipo !== "ok") throw new Error("esperaba ok");
    const alertas = alertasCompetidoresExtension({ itemId: PROPIA, precio: 57_051, envioGratis: false, full: false }, m.competidores);
    expect(alertas).toContain("Tu precio está 14 % arriba del más barato.");
    expect(alertas).toContain("Te falta envío gratis (2 de 2 lo tienen).");
    expect(alertas).toContain("Te falta Full (1 de 2 lo tienen).");
    expect(alertas.join(" ")).not.toMatch(/descripción|cuotas/);
  });

  it("sin competidores, sin alertas", () => {
    expect(alertasCompetidoresExtension({ itemId: PROPIA, precio: 1, envioGratis: false, full: false }, [])).toEqual([]);
  });
});

describe("término, país y antigüedad", () => {
  it("el término son las primeras 8 palabras del título, sin símbolos", () => {
    expect(terminoDesdeTitulo("Tijera Ingletiadora - Cortaexpress Profesional 45° Para Molduras Y Zócalos Marca X")).toBe(
      "Tijera Ingletiadora - Cortaexpress Profesional 45 Para Molduras"
    );
    expect(terminoDesdeTitulo(null)).toBe("");
  });

  it("país de Mercado Libre por sitio; desconocido cae a Colombia", () => {
    expect(paisDeSitio("MCO")).toBe("CO");
    expect(paisDeSitio("MLM")).toBe("MX");
    expect(paisDeSitio("XXX")).toBe("CO");
  });

  it("antigüedad legible", () => {
    expect(rotuloAntiguedad(1)).toBe("1 día");
    expect(rotuloAntiguedad(45)).toBe("45 días");
    expect(rotuloAntiguedad(240)).toBe("8 meses");
    expect(rotuloAntiguedad(800)).toBe("2 años");
    expect(rotuloAntiguedad(null)).toBeNull();
  });

  it("foto válida solo de mlstatic.com con https", () => {
    expect(esFotoMlValida("https://http2.mlstatic.com/a.jpg")).toBe(true);
    expect(esFotoMlValida("https://evilmlstatic.com/a.jpg")).toBe(false);
    expect(esFotoMlValida("http://http2.mlstatic.com/a.jpg")).toBe(false);
  });
});

import {
  compararCompetidores,
  esLinkCompetidorValido,
  esperaMaximaMs,
  fotoGrande,
  fusionarCompetidores,
  nivelParecido,
  parecidoTitulos,
  quitarCompetidor,
  textoCambio,
  validarCompetidores,
  type CompetidorExtension,
} from "@/lib/optimizacion/competidoresExtension";

function comp(n: number, extra: Partial<CompetidorExtension> = {}): CompetidorExtension {
  const m = leerMensajeCompetidores(
    mensaje([{ ...COMPETIDOR, itemId: `MCO${100000000 + n}`, link: `https://articulo.mercadolibre.com.co/MCO-${100000000 + n}-x-_JM`, titulo: `Producto ${n}` }]),
    PROPIA
  );
  if (m?.tipo !== "ok") throw new Error("fixture inválido");
  return { ...m.competidores[0], ...extra };
}

describe("tienda, disponibles y marcas guardadas", () => {
  it('guarda solo el nombre de la tienda ("Vendido por X" -> X)', () => {
    const m = leerMensajeCompetidores(mensaje([{ ...COMPETIDOR, vendedor: "Vendido por DIRECTOACASABOG" }]), PROPIA);
    expect(m?.tipo === "ok" && m.competidores[0].vendedor).toBe("DIRECTOACASABOG");
  });
  it("conserva la cantidad disponible (+50) y si es aproximada", () => {
    const m = leerMensajeCompetidores(mensaje([{ ...COMPETIDOR, inventario: 50, inventarioAproximado: true }]), PROPIA);
    expect(m?.tipo === "ok" && [m.competidores[0].inventario, m.competidores[0].inventarioAproximado]).toEqual([50, true]);
  });
  it("modo links y manual se leen; una fecha inválida queda en null", () => {
    const m = leerMensajeCompetidores(mensaje([{ ...COMPETIDOR, manual: true, actualizadoTs: "no es fecha" }], { modo: "links" }), PROPIA);
    expect(m?.tipo === "ok" && [m.modo, m.competidores[0].manual, m.competidores[0].actualizadoTs]).toEqual(["links", true, null]);
  });
  it("admite hasta 30 competidores", () => {
    const m = leerMensajeCompetidores(mensaje(Array.from({ length: 40 }, (_, i) => ({ ...COMPETIDOR, itemId: `MCO${200000000 + i}`, link: `https://articulo.mercadolibre.com.co/MCO-${200000000 + i}-x` }))), PROPIA);
    expect(m?.tipo === "ok" && m.competidores).toHaveLength(30);
  });
});

describe("validarCompetidores al guardar", () => {
  it("acepta quitar todos (lista vacía) y la falta de término", () => {
    expect(validarCompetidores({ itemId: PROPIA, termino: "", candidatos: 0, competidores: [] })).toEqual({ termino: "(por link)", candidatos: 0, competidores: [] });
  });
  it("rechaza si todo lo recibido era inválido o no es una lista", () => {
    expect(validarCompetidores({ itemId: PROPIA, termino: "x", candidatos: 1, competidores: [{ link: "https://evil.com/x" }] })).toBeNull();
    expect(validarCompetidores({ itemId: PROPIA, termino: "x", candidatos: 1, competidores: "no" })).toBeNull();
  });
});

describe("parecido con el título propio", () => {
  const propio = "Luces Led Inalámbricas Para Cuadros Con Control Táctil Rgb Negro";
  it("mismo producto -> alto; otro diseño -> bajo", () => {
    expect(nivelParecido(parecidoTitulos(propio, "Luces Led Cuadros Inalambricos Control Tactil RGB"))).toBe("alto");
    expect(nivelParecido(parecidoTitulos(propio, "Aro de Luz LED 26cm con Trípode Ajustable Ring Fill Light"))).toBe("bajo");
  });
  it("sin título no inventa un número", () => {
    expect(parecidoTitulos(null, "x")).toBeNull();
    expect(nivelParecido(null)).toBeNull();
  });
});

describe("fusionar, quitar y validar links", () => {
  const AHORA = "2026-11-28T15:00:00.000Z";
  it("buscar de nuevo conserva los agregados por link y reemplaza lo demás", () => {
    const guardados = [comp(1, { manual: true }), comp(2)];
    const { lista } = fusionarCompetidores(guardados, [comp(3), comp(4)], "busqueda", AHORA);
    expect(lista.map((c) => c.itemId)).toEqual(["MCO100000001", "MCO100000003", "MCO100000004"]);
    expect(lista[0].manual).toBe(true);
    expect(lista[1].manual).toBe(false);
  });
  it("agregar por link: ficha leída se agrega como fija y con fecha", () => {
    const { lista, leidos } = fusionarCompetidores([comp(1)], [comp(9)], "links", AHORA);
    expect(leidos).toBe(1);
    expect(lista[1]).toMatchObject({ itemId: "MCO100000009", manual: true, actualizadoTs: AHORA });
  });
  it("actualizar: reemplaza datos y conserva si era fijo; una ficha que falla NO pisa los datos buenos", () => {
    const guardados = [comp(1, { manual: true, precio: 100 }), comp(2, { precio: 200 })];
    const { lista, leidos, noLeidos } = fusionarCompetidores(guardados, [comp(1, { precio: 90 }), comp(2, { precio: 1, leidoDeFicha: false })], "links", AHORA);
    expect([leidos, noLeidos]).toEqual([1, 1]);
    expect(lista[0]).toMatchObject({ precio: 90, manual: true, actualizadoTs: AHORA });
    expect(lista[1].precio).toBe(200);
  });
  it("un link nuevo que no se pudo leer no se agrega", () => {
    const { lista, noLeidos } = fusionarCompetidores([comp(1)], [comp(9, { leidoDeFicha: false })], "links", AHORA);
    expect(lista).toHaveLength(1);
    expect(noLeidos).toBe(1);
  });
  it("quitar un competidor", () => {
    expect(quitarCompetidor([comp(1), comp(2)], "MCO100000001").map((c) => c.itemId)).toEqual(["MCO100000002"]);
  });
  it("solo links de Mercado Libre", () => {
    expect(esLinkCompetidorValido("https://www.mercadolibre.com.co/lampara/up/MCO123456789")).toBe(true);
    expect(esLinkCompetidorValido("https://meli.la/2abcDEF")).toBe(true);
    expect(esLinkCompetidorValido("https://mercadolibre.com.co.evil.com/x")).toBe(false);
    expect(esLinkCompetidorValido("http://articulo.mercadolibre.com.co/x")).toBe(false);
  });
  it("foto grande y espera máxima", () => {
    expect(fotoGrande("https://http2.mlstatic.com/D_NQ_NP_123-V.webp")).toBe("https://http2.mlstatic.com/D_NQ_NP_123-O.webp");
    expect(fotoGrande("https://evil.com/a-V.webp")).toBe("https://evil.com/a-V.webp");
    expect(esperaMaximaMs(10)).toBeGreaterThan(esperaMaximaMs(1));
  });
});

describe("qué cambió en una actualización", () => {
  const AHORA = "2026-11-28T15:00:00.000Z";
  const ANTES = "2026-11-27T10:00:00.000Z";
  const base = (extra: Partial<CompetidorExtension> = {}) =>
    comp(1, { actualizadoTs: ANTES, precio: 100000, inventario: 50, inventarioAproximado: true, esCatalogo: false, full: false, envioGratis: false, ventasMes: 100, facturacionMes: 10000000, ...extra });
  const f = { plata: (n: number) => "$" + n, num: (n: number) => String(n) };

  it("detecta precio, inventario, catálogo, Full, envío gratis, ventas y facturación", () => {
    const despues = base({ precio: 90000, inventario: 30, esCatalogo: true, full: true, envioGratis: true, ventasMes: 150, facturacionMes: 13500000 });
    const c = compararCompetidores(base(), despues);
    expect(c.map((x) => x.campo)).toEqual(["precio", "inventario", "esCatalogo", "full", "envioGratis", "ventasMes", "facturacionMes"]);
    expect(c.find((x) => x.campo === "precio")).toEqual({ campo: "precio", antes: 100000, despues: 90000 });
  });
  it("sin cambios no devuelve nada", () => {
    expect(compararCompetidores(base(), base())).toEqual([]);
  });
  it("no compara si una de las lecturas es solo del listado, ni un dato que falta en una", () => {
    expect(compararCompetidores(base({ leidoDeFicha: false }), base({ precio: 1 }))).toEqual([]);
    expect(compararCompetidores(base({ full: null }), base({ full: true })).some((x) => x.campo === "full")).toBe(false);
  });
  it("inventario con «+» (mínimo) no se compara con una cantidad exacta", () => {
    expect(compararCompetidores(base({ inventarioAproximado: true }), base({ inventario: 5, inventarioAproximado: false })).some((x) => x.campo === "inventario")).toBe(false);
  });
  it("los estimados solo avisan desde un 5 % de cambio", () => {
    expect(compararCompetidores(base(), base({ ventasMes: 98, facturacionMes: 9800000 }))).toEqual([]);
    expect(compararCompetidores(base(), base({ ventasMes: 90 })).map((x) => x.campo)).toEqual(["ventasMes"]);
  });
  it("al actualizar, deja los cambios y la fecha de la lectura anterior en el competidor", () => {
    const nuevo = comp(1, { precio: 90000, inventario: 50, inventarioAproximado: true, esCatalogo: false, full: false, envioGratis: false, ventasMes: 100, facturacionMes: 10000000 });
    const { lista, conCambios } = fusionarCompetidores([base()], [nuevo], "links", AHORA);
    expect(conCambios).toBe(1);
    expect(lista[0].cambios).toEqual([{ campo: "precio", antes: 100000, despues: 90000 }]);
    expect(lista[0].cambiosDesdeTs).toBe(ANTES);
    expect(lista[0].actualizadoTs).toBe(AHORA);
  });
  it("una actualización sin cambios borra los cambios de la anterior; una ficha que falla los conserva", () => {
    const conAntiguos = base({ cambios: [{ campo: "precio", antes: 1, despues: 2 }] });
    const igual = comp(1, { precio: 100000, inventario: 50, inventarioAproximado: true, esCatalogo: false, full: false, envioGratis: false, ventasMes: 100, facturacionMes: 10000000 });
    expect(fusionarCompetidores([conAntiguos], [igual], "links", AHORA).lista[0].cambios).toEqual([]);
    const fallo = fusionarCompetidores([conAntiguos], [comp(1, { leidoDeFicha: false })], "links", AHORA).lista[0];
    expect(fallo.cambios).toHaveLength(1);
  });
  it("los cambios guardados se revalidan (campo desconocido o tipo equivocado se descartan)", () => {
    const m = leerMensajeCompetidores(
      mensaje([{ ...COMPETIDOR, cambios: [{ campo: "precio", antes: 1, despues: 2 }, { campo: "hack", antes: 1, despues: 2 }, { campo: "full", antes: 1, despues: 2 }] }]),
      PROPIA
    );
    expect(m?.tipo === "ok" && m.competidores[0].cambios).toEqual([{ campo: "precio", antes: 1, despues: 2 }]);
  });
  it("frases claras en español", () => {
    expect(textoCambio({ campo: "precio", antes: 100000, despues: 90000 }, f)).toEqual({ icono: "▼", texto: "Bajó el precio: $100000 → $90000 (−10 %)" });
    expect(textoCambio({ campo: "inventario", antes: 30, despues: 50 }, f).texto).toBe("Subió el inventario: 30 → 50");
    expect(textoCambio({ campo: "esCatalogo", antes: false, despues: true }, f).texto).toBe("Entró al catálogo");
    expect(textoCambio({ campo: "full", antes: true, despues: false }, f).texto).toBe("Salió de Full");
    expect(textoCambio({ campo: "envioGratis", antes: true, despues: false }, f).texto).toBe("Quitó el envío gratis");
    expect(textoCambio({ campo: "ventasMes", antes: 100, despues: 150 }, f).texto).toContain("Subieron las ventas/mes aprox.");
  });
  it("la tienda guarda su link y solo si es de Mercado Libre", () => {
    const ok = leerMensajeCompetidores(mensaje([{ ...COMPETIDOR, vendedorLink: "https://www.mercadolibre.com.co/perfil/X" }]), PROPIA);
    const mal = leerMensajeCompetidores(mensaje([{ ...COMPETIDOR, vendedorLink: "https://evil.com/perfil/X" }]), PROPIA);
    expect(ok?.tipo === "ok" && ok.competidores[0].vendedorLink).toBe("https://www.mercadolibre.com.co/perfil/X");
    expect(mal?.tipo === "ok" && mal.competidores[0].vendedorLink).toBeNull();
  });
});
