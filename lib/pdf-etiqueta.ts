import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";

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

export type ItemContenidoEtiqueta = { titulo: string; cantidad: number; skuCodigo: string | null };

// Las fuentes estándar de PDF (Helvetica) solo codifican WinAnsi:
// pdf-lib TRUENA con un emoji o un carácter fuera de ese juego (un
// título de Mercado Libre puede traer cualquiera, p.ej. "⭐ Oferta").
// Lo que la fuente no puede dibujar se quita (un "?" en la guía
// confunde más que ayuda) en vez de romper la guía entera.
function textoDibujable(texto: string, font: PDFFont): string {
  const permitidos = new Set(font.getCharacterSet());
  return [...texto.normalize("NFC")]
    .map((c) => (/\s/.test(c) ? " " : permitidos.has(c.codePointAt(0) ?? -1) ? c : ""))
    .join("")
    .replace(/ +/g, " ")
    .trim();
}

// Parte un texto en renglones que quepan en `ancho` — por palabras, y
// una palabra que sola no cabe se corta por caracteres (un SKU largo
// sin espacios no debe salirse de la hoja).
function partirEnRenglones(texto: string, font: PDFFont, tamano: number, ancho: number): string[] {
  const renglones: string[] = [];
  let actual = "";
  for (const palabra of texto.split(" ")) {
    const candidato = actual ? `${actual} ${palabra}` : palabra;
    if (font.widthOfTextAtSize(candidato, tamano) <= ancho) {
      actual = candidato;
      continue;
    }
    if (actual) renglones.push(actual);
    actual = "";
    for (const c of palabra) {
      if (font.widthOfTextAtSize(actual + c, tamano) > ancho && actual) {
        renglones.push(actual);
        actual = "";
      }
      actual += c;
    }
  }
  if (actual) renglones.push(actual);
  return renglones;
}

// "En la guía sale el producto y la cantidad" — la guía de Mercado
// Libre no dice qué va dentro del paquete, y quien empaca la necesita
// junto a la etiqueta. En vez de escribir encima del PDF de Mercado
// Libre (no sabemos dónde queda espacio libre en su diseño, y tapar
// un código de barras haría la guía inservible), cada página se
// alarga hacia abajo con una franja aparte: la guía original queda
// intacta arriba, y debajo va "CONTENIDO" con cantidad x producto
// (+ SKU si lo hay). Sin ítems, el PDF vuelve tal cual.
export async function agregarContenidoAEtiqueta(pdfOriginal: ArrayBuffer, items: ItemContenidoEtiqueta[]): Promise<ArrayBuffer> {
  if (items.length === 0) return pdfOriginal;

  const original = await PDFDocument.load(pdfOriginal);
  const salida = await PDFDocument.create();
  const normal = await salida.embedFont(StandardFonts.Helvetica);
  const negrita = await salida.embedFont(StandardFonts.HelveticaBold);
  const paginasIncrustadas = await salida.embedPdf(original, original.getPageIndices());

  const unidades = items.reduce((suma, i) => suma + i.cantidad, 0);
  const encabezado = `CONTENIDO (${unidades} ${unidades === 1 ? "unidad" : "unidades"})`;

  for (const incrustada of paginasIncrustadas) {
    const ancho = incrustada.width;
    // Letra proporcional al ancho de la guía: legible tanto en una
    // guía de 10cm como en una hoja carta, sin ocupar media página.
    const tamano = Math.min(12, Math.max(7, ancho * 0.035));
    const interlineado = tamano * 1.3;
    const margen = tamano;
    const anchoTexto = ancho - margen * 2;

    const renglones: { texto: string; font: PDFFont }[] = [{ texto: encabezado, font: negrita }];
    for (const item of items) {
      const sku = item.skuCodigo ? ` · SKU ${item.skuCodigo}` : "";
      const texto = textoDibujable(`${item.cantidad} x ${item.titulo}${sku}`, normal);
      for (const r of partirEnRenglones(texto, normal, tamano, anchoTexto)) renglones.push({ texto: r, font: normal });
    }

    const altoFranja = margen * 2 + renglones.length * interlineado;
    const pagina = salida.addPage([ancho, incrustada.height + altoFranja]);
    pagina.drawPage(incrustada, { x: 0, y: altoFranja });
    pagina.drawLine({ start: { x: margen, y: altoFranja }, end: { x: ancho - margen, y: altoFranja }, thickness: 0.75, color: rgb(0, 0, 0) });

    let y = altoFranja - margen - tamano;
    for (const r of renglones) {
      pagina.drawText(r.texto, { x: margen, y, size: tamano, font: r.font, color: rgb(0, 0, 0) });
      y -= interlineado;
    }
  }

  const bytes = await salida.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
