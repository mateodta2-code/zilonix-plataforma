import { PDFDocument, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rectangle, stroke } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { agregarContenidoAEtiqueta, marcosDeGuia, quitarHojasDeLista, recortarGuias, rectangulosDelContenido, reescalarEtiquetaASticker } from "./pdf-etiqueta";

// pdf-lib no deja incrustar una página sin contenido ("Can't embed
// page with missing Contents") — una página en blanco de verdad no
// sirve de fixture, así que cada página de prueba dibuja un rectángulo
// mínimo, igual que cualquier guía real de Mercado Libre (que siempre
// trae contenido real).
async function pdfDePrueba(ancho: number, alto: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([ancho, alto]);
  pagina.drawRectangle({ x: 0, y: 0, width: ancho, height: alto });
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const PUNTOS_POR_CM = 28.3465;

describe("reescalarEtiquetaASticker", () => {
  it("la página de salida mide exactamente 10x15cm, sin importar el tamaño original", async () => {
    const original = await pdfDePrueba(288, 432); // una guía normal tipo carta-media, apaisada distinto
    const salida = await PDFDocument.load(await reescalarEtiquetaASticker(original));
    expect(salida.getPageCount()).toBe(1);
    const { width, height } = salida.getPage(0).getSize();
    expect(width).toBeCloseTo(10 * PUNTOS_POR_CM, 1);
    expect(height).toBeCloseTo(15 * PUNTOS_POR_CM, 1);
  });

  it("conserva una página por cada página del PDF original (una guía con varios shipment_ids trae varias páginas)", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) {
      const pagina = doc.addPage([288, 432]);
      pagina.drawRectangle({ x: 0, y: 0, width: 288, height: 432 });
    }
    const bytes = await doc.save();
    const original = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const salida = await PDFDocument.load(await reescalarEtiquetaASticker(original));
    expect(salida.getPageCount()).toBe(3);
  });

  it("nunca estira el contenido: una página angosta y alta queda centrada y a escala, no deformada a 10x15", async () => {
    // Una guía mucho más angosta que 10x15 (p.ej. 7x20cm reales en pt):
    // si se "estirara" para llenar la hoja perdería la proporción real.
    const anchoOriginalPt = 7 * PUNTOS_POR_CM;
    const altoOriginalPt = 20 * PUNTOS_POR_CM;
    const original = await pdfDePrueba(anchoOriginalPt, altoOriginalPt);
    const salida = await PDFDocument.load(await reescalarEtiquetaASticker(original));
    const { width: anchoSalida, height: altoSalida } = salida.getPage(0).getSize();
    // La hoja de salida SIGUE siendo 10x15 (el sticker), el contenido
    // adentro es lo que queda a escala — eso no se puede medir desde
    // getSize() de la página (que siempre es 10x15), así que esta
    // prueba solo confirma que no truena con una proporción muy
    // distinta a la hoja de destino.
    expect(anchoSalida).toBeCloseTo(10 * PUNTOS_POR_CM, 1);
    expect(altoSalida).toBeCloseTo(15 * PUNTOS_POR_CM, 1);
  });
});

describe("agregarContenidoAEtiqueta", () => {
  const items = [
    { titulo: "Camiseta negra talla M", cantidad: 2, skuCodigo: "CAM-NEG-M" },
    { titulo: "Gorra azul", cantidad: 1, skuCodigo: null },
  ];

  it("sin ítems devuelve el PDF tal cual", async () => {
    const original = await pdfDePrueba(288, 432);
    expect(await agregarContenidoAEtiqueta(original, [])).toBe(original);
  });

  it("alarga cada página hacia abajo (mismo ancho, más alta) sin cambiar el número de páginas", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 2; i++) doc.addPage([288, 432]).drawRectangle({ x: 0, y: 0, width: 288, height: 432 });
    const bytes = await doc.save();
    const original = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const salida = await PDFDocument.load(await agregarContenidoAEtiqueta(original, items));
    expect(salida.getPageCount()).toBe(2);
    for (const pagina of salida.getPages()) {
      const { width, height } = pagina.getSize();
      expect(width).toBeCloseTo(288, 1);
      expect(height).toBeGreaterThan(432);
    }
  });

  it("un título largo hace la franja más alta (parte en renglones, no se sale de la hoja)", async () => {
    const original = await pdfDePrueba(288, 432);
    const corto = await PDFDocument.load(await agregarContenidoAEtiqueta(original, [{ titulo: "Gorra", cantidad: 1, skuCodigo: null }]));
    const largo = await PDFDocument.load(
      await agregarContenidoAEtiqueta(original, [{ titulo: "Set de 3 pijamas de algodón para dama con estampado floral ".repeat(3), cantidad: 1, skuCodigo: "SKU-MUY-LARGO-SIN-ESPACIOS-0000000000000000000000" }])
    );
    expect(largo.getPage(0).getSize().height).toBeGreaterThan(corto.getPage(0).getSize().height);
  });

  it("un emoji o carácter raro en el título no rompe la guía", async () => {
    const original = await pdfDePrueba(288, 432);
    const salida = await agregarContenidoAEtiqueta(original, [{ titulo: "⭐ Oferta 🔥 Pijama — niña ñandú", cantidad: 3, skuCodigo: null }]);
    expect((await PDFDocument.load(salida)).getPageCount()).toBe(1);
  });

  it("el sticker de 10x15 se sigue armando a partir de la guía con contenido", async () => {
    const original = await pdfDePrueba(288, 432);
    const salida = await PDFDocument.load(await reescalarEtiquetaASticker(await agregarContenidoAEtiqueta(original, items)));
    const { width, height } = salida.getPage(0).getSize();
    expect(width).toBeCloseTo(10 * PUNTOS_POR_CM, 1);
    expect(height).toBeCloseTo(15 * PUNTOS_POR_CM, 1);
  });
});

// Tamaños reales del PDF de /shipment_labels (2026-11-13): guía Flex
// 10x15cm, guía de colecta en A4 horizontal y lista de despacho en A4
// vertical.
const GUIA: [number, number] = [283.4646, 425.1969];
const GUIA_COLECTA: [number, number] = [841.89, 595.28];
const A4: [number, number] = [595.2756, 841.8898];

async function pdfConPaginas(tamanos: [number, number][]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (const [ancho, alto] of tamanos) doc.addPage([ancho, alto]).drawRectangle({ x: 0, y: 0, width: ancho, height: alto });
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("quitarHojasDeLista", () => {
  it("deja solo las guías y quita las hojas A4 de lista de despacho", async () => {
    const original = await pdfConPaginas([GUIA, GUIA, GUIA, A4]);
    const salida = await PDFDocument.load(await quitarHojasDeLista(original));
    expect(salida.getPageCount()).toBe(3);
    for (const pagina of salida.getPages()) expect(pagina.getSize().width).toBeCloseTo(GUIA[0], 1);
  });

  it("colecta: la guía en A4 horizontal se queda y solo sale la lista en A4 vertical", async () => {
    const original = await pdfConPaginas([GUIA_COLECTA, A4]);
    const salida = await PDFDocument.load(await quitarHojasDeLista(original));
    expect(salida.getPageCount()).toBe(1);
    expect(salida.getPage(0).getSize().width).toBeCloseTo(GUIA_COLECTA[0], 1);
  });

  it("si todas las hojas parecen lista, no quita nada (nunca un PDF vacío)", async () => {
    const original = await pdfConPaginas([A4, A4]);
    expect(await quitarHojasDeLista(original)).toBe(original);
  });

  it("sin hoja A4, el PDF vuelve tal cual", async () => {
    const original = await pdfConPaginas([GUIA, GUIA]);
    expect(await quitarHojasDeLista(original)).toBe(original);
  });
});

describe("agregarContenidoAEtiqueta con lista de despacho", () => {
  it("la franja va solo en la guía; la hoja A4 de lista queda del mismo tamaño", async () => {
    const original = await pdfConPaginas([GUIA, A4]);
    const salida = await PDFDocument.load(await agregarContenidoAEtiqueta(original, [{ titulo: "Gorra", cantidad: 1, skuCodigo: null }]));
    expect(salida.getPage(0).getSize().height).toBeGreaterThan(GUIA[1]);
    expect(salida.getPage(1).getSize().width).toBeCloseTo(A4[0], 1);
    expect(salida.getPage(1).getSize().height).toBeCloseTo(A4[1], 1);
  });

  it("colecta: la guía en A4 horizontal sí lleva la franja", async () => {
    const original = await pdfConPaginas([GUIA_COLECTA, A4]);
    const salida = await PDFDocument.load(await agregarContenidoAEtiqueta(original, [{ titulo: "Gorra", cantidad: 1, skuCodigo: null }]));
    expect(salida.getPage(0).getSize().height).toBeGreaterThan(GUIA_COLECTA[1]);
  });
});

// Marco real de la guía de Agencia (contenido de la página de
// /shipment_labels, 2026-11-13): "31.1811 145.4173 255.6850 421.5118 re".
const MARCO_REAL = { x: 31.1811, y: 145.4173, w: 255.685, h: 421.5118 };

describe("rectangulosDelContenido / marcosDeGuia", () => {
  it("lee el marco real y lo junta aunque Mercado Libre lo dibuje varias veces", () => {
    const contenido = `${MARCO_REAL.x} ${MARCO_REAL.y} ${MARCO_REAL.w} ${MARCO_REAL.h} re
31.4646 145.7008 255.1181 420.9449 re
q
31.4646 145.7008 255.1181 420.9449 re
Q`;
    const marcos = marcosDeGuia(rectangulosDelContenido(contenido));
    expect(marcos).toHaveLength(1);
    expect(marcos[0].izquierda).toBeCloseTo(MARCO_REAL.x, 1);
  });

  it("aplica cm dentro de q/Q y lo deshace al cerrar con Q", () => {
    const rects = rectangulosDelContenido("q 1 0 0 1 300 0 cm 0 0 10 10 re Q 0 0 10 10 re");
    expect(rects[0].izquierda).toBeCloseTo(300, 5);
    expect(rects[1].izquierda).toBeCloseTo(0, 5);
  });

  it("un texto que dice 're' o trae paréntesis no se confunde con un rectángulo", () => {
    const rects = rectangulosDelContenido("BT (1 2 3 4 re \) ( anidado ) fin) Tj [(re) 120 (x)] TJ ET <</MCID 0>> BDC EMC");
    expect(rects).toHaveLength(0);
  });

  it("ignora rectángulos que no tienen tamaño de guía (código de barras, líneas)", () => {
    expect(marcosDeGuia(rectangulosDelContenido("42.8 478.7 65.7 19.8 re 31.4 234.7 255.1 0.28 re"))).toHaveLength(0);
  });

  it("varias guías en la misma hoja: orden de lectura, de izquierda a derecha", () => {
    const marcos = marcosDeGuia(rectangulosDelContenido("311 145 255 421 re 31 145 255 421 re"));
    expect(marcos.map((m) => Math.round(m.izquierda))).toEqual([31, 311]);
  });
});

async function hojaConMarcos(ancho: number, alto: number, xs: number[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([ancho, alto]);
  for (const x of xs) {
    pagina.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, x, 0), rectangle(0, MARCO_REAL.y, MARCO_REAL.w, MARCO_REAL.h), stroke(), popGraphicsState());
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("recortarGuias", () => {
  it("guía de Agencia (A4 horizontal, una guía): queda una página del tamaño del marco", async () => {
    const salida = await PDFDocument.load(await recortarGuias(await hojaConMarcos(841.89, 595.28, [MARCO_REAL.x])));
    expect(salida.getPageCount()).toBe(1);
    const { width, height } = salida.getPage(0).getSize();
    expect(width).toBeCloseTo(MARCO_REAL.w + 8, 0);
    expect(height).toBeCloseTo(MARCO_REAL.h + 8, 0);
  });

  it("dos guías en la misma hoja A4 horizontal: una página por guía", async () => {
    const salida = await PDFDocument.load(await recortarGuias(await hojaConMarcos(841.89, 595.28, [31, 311])));
    expect(salida.getPageCount()).toBe(2);
  });

  it("una hoja sin marco reconocible se deja completa (nunca se pierde una guía)", async () => {
    const original = await pdfDePrueba(841.89, 595.28);
    const salida = await PDFDocument.load(await recortarGuias(original));
    expect(salida.getPageCount()).toBe(1);
    expect(salida.getPage(0).getSize().width).toBeCloseTo(841.89, 1);
  });

  it("la guía Flex (ya en 10x15) no se recorta", async () => {
    const salida = await PDFDocument.load(await recortarGuias(await hojaConMarcos(GUIA[0], GUIA[1], [10])));
    expect(salida.getPage(0).getSize().width).toBeCloseTo(GUIA[0], 1);
    expect(salida.getPage(0).getSize().height).toBeCloseTo(GUIA[1], 1);
  });

  it("después de recortar, el sticker queda en 10x15 por guía", async () => {
    const recortado = await recortarGuias(await hojaConMarcos(841.89, 595.28, [31, 311]));
    const salida = await PDFDocument.load(await reescalarEtiquetaASticker(recortado));
    expect(salida.getPageCount()).toBe(2);
    for (const p of salida.getPages()) expect(p.getSize().height).toBeCloseTo(15 * PUNTOS_POR_CM, 1);
  });
});
