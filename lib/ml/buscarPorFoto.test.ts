import { describe, expect, it } from "vitest";
import {
  clasificarVeredicto,
  construirConsultas,
  construirPromptReconocimiento,
  detectarTipoImagen,
  esUrlMiniaturaPermitida,
  idiomaConsultas,
  parsearComparacion,
  parsearReconocimiento,
  seleccionarCandidatos,
} from "./buscarPorFoto";
import { TOPE_QUERIES_ANALIZAR } from "./variantesBusqueda";

const valido = '{"nombre":"Reloj digital","marca":"Casio","modelo":"F-91W","atributos":["negro","resina"],"confianza":0.9,"consultas":["reloj casio digital","reloj digital negro"]}';

describe("parsearReconocimiento", () => {
  it("JSON válido", () => {
    const r = parsearReconocimiento(valido)!;
    expect(r.nombre).toBe("Reloj digital");
    expect(r.marca).toBe("Casio");
    expect(r.confianza).toBe(0.9);
    expect(r.consultas).toHaveLength(2);
  });
  it("con texto y fences alrededor", () => {
    expect(parsearReconocimiento("Claro:\n```json\n" + valido + "\n```\nListo")?.nombre).toBe("Reloj digital");
  });
  it("JSON roto o sin nombre → null", () => {
    expect(parsearReconocimiento('{"nombre":"Reloj"')).toBeNull();
    expect(parsearReconocimiento("no hay json")).toBeNull();
    expect(parsearReconocimiento('{"marca":"Casio"}')).toBeNull();
  });
  it("campos faltantes toman valores seguros", () => {
    const r = parsearReconocimiento('{"nombre":"Taza"}')!;
    expect(r).toMatchObject({ marca: null, modelo: null, atributos: [], confianza: 0, consultas: [] });
  });
  it("confianza fuera de rango se acota; atributos máx. 6; consultas fuera de 2–5 palabras se descartan", () => {
    expect(parsearReconocimiento('{"nombre":"A","confianza":7}')!.confianza).toBe(1);
    expect(parsearReconocimiento('{"nombre":"A","confianza":-2}')!.confianza).toBe(0);
    const r = parsearReconocimiento('{"nombre":"A","atributos":["1","2","3","4","5","6","7","8"],"consultas":["sola","dos palabras","uno dos tres cuatro cinco seis"]}')!;
    expect(r.atributos).toHaveLength(6);
    expect(r.consultas).toEqual(["dos palabras"]);
  });
});

describe("construirConsultas", () => {
  it("deduplica sin tildes/mayúsculas y respeta el tope", () => {
    const { termino, consultas } = construirConsultas({
      nombre: "Reloj digital",
      marca: "Casio",
      modelo: "F-91W",
      consultas: ["reloj digital", "RELOJ DIGITAL", "reloj casio", "reloj negro", "reloj retro", "reloj deportivo"],
    });
    expect(termino).toBe("Reloj digital");
    expect(consultas).not.toContain("reloj digital");
    expect(1 + consultas.length).toBeLessThanOrEqual(TOPE_QUERIES_ANALIZAR);
  });
  it("completa con marca/modelo si la IA no dio consultas", () => {
    const { consultas } = construirConsultas({ nombre: "Reloj", marca: "Casio", modelo: "F-91W", consultas: [] });
    expect(consultas).toContain("Casio F-91W");
  });
});

describe("idioma por país (sin fijar es-CO)", () => {
  it("usa SITIOS_ML para los países que opera", () => {
    expect(idiomaConsultas("BR").descripcion).toBe("portugués de Brasil");
    expect(idiomaConsultas("MX").descripcion).toBe("español de México");
    expect(idiomaConsultas("CO").codigo).toBe("es-CO");
  });
  it("UY y PE van en español neutro", () => {
    expect(idiomaConsultas("UY").descripcion).toContain("neutro");
    expect(idiomaConsultas("PE").codigo).toBe("es");
    expect(construirPromptReconocimiento("PE")).toContain("español neutro");
    expect(construirPromptReconocimiento("BR")).toContain("portugués");
  });
});

describe("veredictos y candidatos", () => {
  it("clasificarVeredicto", () => {
    expect(clasificarVeredicto("Igual")).toBe("igual");
    expect(clasificarVeredicto(" PARECIDO ")).toBe("parecido");
    expect(clasificarVeredicto("distinto")).toBe("distinto");
    expect(clasificarVeredicto("quizá")).toBe("dudoso");
    expect(clasificarVeredicto(null)).toBe("dudoso");
  });
  it("parsearComparacion completa los ids que faltan e ignora inventados", () => {
    const r = parsearComparacion('[{"id":"c1","veredicto":"igual","motivo":"mismo"},{"id":"c9","veredicto":"igual"}]', ["c1", "c2"])!;
    expect(r).toEqual([
      { id: "c1", veredicto: "igual", motivo: "mismo" },
      { id: "c2", veredicto: "dudoso", motivo: expect.any(String) },
    ]);
    expect(parsearComparacion("nada", ["c1"])).toBeNull();
  });
  it("seleccionarCandidatos: máx. 12, solo mlstatic https, sin fotos repetidas", () => {
    const productos = Array.from({ length: 20 }, (_, i) => ({ foto: `https://http2.mlstatic.com/D_${i % 18}.jpg` }));
    productos.splice(1, 0, { foto: "http://http2.mlstatic.com/x.jpg" }, { foto: "https://otro.com/x.jpg" }, { foto: null as unknown as string });
    const c = seleccionarCandidatos(productos);
    expect(c).toHaveLength(12);
    expect(c[0].id).toBe("c1");
    expect(new Set(c.map((x) => x.url)).size).toBe(12);
    expect(c.every((x) => esUrlMiniaturaPermitida(x.url))).toBe(true);
  });
});

describe("firma de bytes y lista blanca", () => {
  it("detectarTipoImagen", () => {
    expect(detectarTipoImagen(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectarTipoImagen(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectarTipoImagen(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(detectarTipoImagen(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(detectarTipoImagen(new Uint8Array([]))).toBeNull();
  });
  it("esUrlMiniaturaPermitida", () => {
    expect(esUrlMiniaturaPermitida("https://http2.mlstatic.com/D_1.jpg")).toBe(true);
    expect(esUrlMiniaturaPermitida("https://mlstatic.com/a.jpg")).toBe(true);
    expect(esUrlMiniaturaPermitida("http://http2.mlstatic.com/a.jpg")).toBe(false);
    expect(esUrlMiniaturaPermitida("https://otro.com/a.jpg")).toBe(false);
    expect(esUrlMiniaturaPermitida("https://mlstatic.com.evil.com/a.jpg")).toBe(false);
    expect(esUrlMiniaturaPermitida("https://evilmlstatic.com/a.jpg")).toBe(false);
    expect(esUrlMiniaturaPermitida("https://user@http2.mlstatic.com/a.jpg")).toBe(false);
    expect(esUrlMiniaturaPermitida("no es url")).toBe(false);
  });
});
