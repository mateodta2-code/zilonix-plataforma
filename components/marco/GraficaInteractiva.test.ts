import { describe, expect, it } from "vitest";
import { puntoBajoCursor } from "@/components/marco/GraficaInteractiva";

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
