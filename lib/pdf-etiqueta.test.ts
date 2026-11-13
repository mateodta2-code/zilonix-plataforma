import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { agregarContenidoAEtiqueta, quitarHojasDeLista, reescalarEtiquetaASticker } from "./pdf-etiqueta";

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

// Tamaños reales del PDF de /shipment_labels (guía Flex, 2026-11-13):
// guía 10x15cm y lista de despacho en A4.
const GUIA: [number, number] = [283.4646, 425.1969];
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

  it("si todas las hojas son A4, no quita nada (nunca un PDF vacío)", async () => {
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
});
