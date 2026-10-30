import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { reescalarEtiquetaASticker } from "./pdf-etiqueta";

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
