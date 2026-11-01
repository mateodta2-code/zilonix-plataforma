import { PDFDocument } from "pdf-lib";

// 1 cm = 28.3465 pt (72 pt/in ÷ 2.54 cm/in) — conversión estándar de
// PDF, no una medida inventada.
const PUNTOS_POR_CM = 28.3465;
const ANCHO_STICKER_PT = 10 * PUNTOS_POR_CM;
const ALTO_STICKER_PT = 15 * PUNTOS_POR_CM;

// "Ver guía (sticker)" (punto 4 de la tarea) — el MISMO PDF que ya
// manda Mercado Libre para "Ver guía", reescalado a una hoja de
// 10x15cm por página, explícitamente SIN convertir a ZPL (otro
// lenguaje aparte, de impresora térmica — no es lo que pide la
// tarea). Cada página del PDF original se incrusta como página
// completa dentro de una página nueva de 10x15cm, centrada y
// respetando su proporción real (nunca recortada ni estirada) —
// mismo PDF, mismo contenido, solo el tamaño de hoja cambia.
export async function reescalarEtiquetaASticker(pdfOriginal: ArrayBuffer): Promise<ArrayBuffer> {
  const original = await PDFDocument.load(pdfOriginal);
  const salida = await PDFDocument.create();
  const paginasIncrustadas = await salida.embedPdf(original, original.getPageIndices());

  for (const incrustada of paginasIncrustadas) {
    const pagina = salida.addPage([ANCHO_STICKER_PT, ALTO_STICKER_PT]);
    const escala = Math.min(ANCHO_STICKER_PT / incrustada.width, ALTO_STICKER_PT / incrustada.height);
    const anchoFinal = incrustada.width * escala;
    const altoFinal = incrustada.height * escala;
    pagina.drawPage(incrustada, {
      x: (ANCHO_STICKER_PT - anchoFinal) / 2,
      y: (ALTO_STICKER_PT - altoFinal) / 2,
      xScale: escala,
      yScale: escala,
    });
  }

  const bytes = await salida.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
