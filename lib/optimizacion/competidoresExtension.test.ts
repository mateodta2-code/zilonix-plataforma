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

  it("datos raros quedan en null (nunca un 0 inventado) y como máximo 10", () => {
    const m = leerMensajeCompetidores(
      mensaje(Array.from({ length: 15 }, () => ({ ...COMPETIDOR, precio: "49900", vendidos: -3, calificacion: 9, esFull: "sí" }))),
      PROPIA
    );
    if (m?.tipo !== "ok") throw new Error("esperaba ok");
    expect(m.competidores).toHaveLength(10);
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
