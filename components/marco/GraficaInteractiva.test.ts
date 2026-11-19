import { describe, expect, it } from "vitest";
import { escalarX, puntoBajoCursor } from "@/components/marco/GraficaInteractiva";

// Dibujo de 600×160 (GraficaLineas), 25 puntos de x=24 a x=576.
const puntos = Array.from({ length: 25 }, (_, i) => ({ x: 24 + i * 23 }));

describe("puntoBajoCursor — el punto marcado es el que está bajo el cursor", () => {
  it("tarjeta ancha (bug de staging): la gráfica queda centrada con margen a los lados", () => {
    // 1400 px de ancho, 160 de alto: escala 1, margen de 400 px a cada lado.
    expect(puntoBajoCursor(400 + 24, 1400, 160, 600, 160, puntos)).toMatchObject({ indice: 0, izquierdaPx: 424 });
    expect(puntoBajoCursor(400 + 576, 1400, 160, 600, 160, puntos)).toMatchObject({ indice: 24, izquierdaPx: 976 });
    // Antes se tomaba el ancho entero: el cursor sobre el punto 0 (x=424)
    // marcaba otro punto. Ahora el globo cae donde está el punto.
    expect(puntoBajoCursor(400 + 24 + 23 * 10, 1400, 160, 600, 160, puntos)?.indice).toBe(10);
    // Cursor en el margen vacío: el punto más cercano del borde.
    expect(puntoBajoCursor(50, 1400, 160, 600, 160, puntos)?.indice).toBe(0);
  });

  it("pantalla angosta (celular): escala por el ancho, sin margen", () => {
    // 300 px de ancho: escala 0,5, margen 0.
    expect(puntoBajoCursor(12, 300, 160, 600, 160, puntos)).toMatchObject({ indice: 0, izquierdaPx: 12 });
    expect(puntoBajoCursor(288, 300, 160, 600, 160, puntos)).toMatchObject({ indice: 24, haciaIzquierda: true });
  });

  it("sin tamaño o sin puntos: nada", () => {
    expect(puntoBajoCursor(10, 0, 160, 600, 160, puntos)).toBeNull();
    expect(puntoBajoCursor(10, 300, 160, 600, 160, [])).toBeNull();
  });
});

describe("escalarX — la gráfica ocupa todo el ancho de la tarjeta", () => {
  it("reparte los puntos en el ancho real, con el mismo margen a los lados", () => {
    expect(escalarX(24, 600, 1400, 24)).toBe(24); // primer punto: pegado al margen izquierdo
    expect(escalarX(576, 600, 1400, 24)).toBe(1376); // último: pegado al margen derecho
    expect(escalarX(300, 600, 1400, 24)).toBe(700); // el del medio, en el medio
  });

  it("con el ancho real, el cursor sobre un punto lo marca (sin margen extra)", () => {
    const anchos = puntos.map((p) => ({ x: escalarX(p.x, 600, 1400, 24) }));
    expect(puntoBajoCursor(anchos[10].x, 1400, 160, 1400, 160, anchos)).toMatchObject({ indice: 10, izquierdaPx: anchos[10].x });
  });

  it("sin medir todavía: deja los puntos como vienen", () => {
    expect(escalarX(100, 600, 0, 24)).toBe(100);
  });
});
