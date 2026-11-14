import { PDFArray, PDFDocument, PDFFont, PDFRawStream, StandardFonts, decodePDFRawStream, rgb } from "pdf-lib";

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

// Evidencia real (2 PDFs de /shipment_labels descargados de staging,
// 2026-11-13): la guía Flex viene en 10x15cm (283.46 x 425.20 pt) y la
// de colecta en A4 HORIZONTAL (841.89 x 595.28 pt); en los dos casos
// la lista de despacho "Identificación / Productos" (el "manifiesto")
// viene aparte en A4 VERTICAL (595.28 x 841.89 pt). Hoy la única forma
// confirmada de distinguirlas es el tamaño y la orientación de la
// hoja: A4 vertical = lista. Ojo: no basta "A4 = lista" — así se
// colaba el manifiesto en colecta (guía y lista eran A4 las dos).
const ANCHO_A4_PT = 595.28;
const ALTO_A4_PT = 841.89;
function esHojaDeLista(ancho: number, alto: number): boolean {
  return Math.abs(ancho - ANCHO_A4_PT) < 3 && Math.abs(alto - ALTO_A4_PT) < 3;
}

// Impresión masiva "solo las guías, no el manifiesto" (pedido del
// equipo, 2026-11-13): quita las hojas de lista de despacho y deja
// solo las guías. Si TODAS las hojas parecen lista (un formato de guía
// que todavía no hemos visto) o ninguna lo es, el PDF vuelve tal cual —
// nunca se entrega un PDF vacío ni se quita una guía por adivinar.
export async function quitarHojasDeLista(pdfOriginal: ArrayBuffer): Promise<ArrayBuffer> {
  const original = await PDFDocument.load(pdfOriginal);
  const indicesGuia = original.getPages().flatMap((p, i) => {
    const { width, height } = p.getSize();
    return esHojaDeLista(width, height) ? [] : [i];
  });
  if (indicesGuia.length === 0 || indicesGuia.length === original.getPageCount()) return pdfOriginal;

  const salida = await PDFDocument.create();
  for (const pagina of await salida.copyPages(original, indicesGuia)) salida.addPage(pagina);
  const bytes = await salida.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

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
    // La hoja de lista de despacho ya trae producto y cantidad
    // (Mercado Libre los imprime ahí): se copia tal cual, sin franja.
    if (esHojaDeLista(incrustada.width, incrustada.height)) {
      salida.addPage([incrustada.width, incrustada.height]).drawPage(incrustada);
      continue;
    }
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

// ── Sticker 10x15 recortando cada guía ──────────────────────────────
//
// Evidencia real (guía de Agencia/Places de /shipment_labels,
// 2026-11-13): la guía NO viene en 10x15 sino en una hoja A4
// horizontal, dibujada dentro de un marco de ~9x15cm
// ("31.18 145.42 255.69 421.51 re" en el contenido de la página) en el
// lado izquierdo — el resto de la hoja queda en blanco. Reescalar la
// hoja entera a 10x15 (reescalarEtiquetaASticker) dejaría la guía
// diminuta. En vez de adivinar en qué posiciones pone Mercado Libre la
// 2da/3ra guía de un lote, se buscan en el contenido de la página los
// rectángulos del tamaño de ese marco y cada uno se recorta a su
// propia página. Si una hoja no trae ningún marco reconocible, se deja
// completa (mismo resultado que antes de este cambio).

type Matriz = [number, number, number, number, number, number];
export type Caja = { izquierda: number; abajo: number; derecha: number; arriba: number };

const IDENTIDAD: Matriz = [1, 0, 0, 1, 0, 0];

// Mismo orden que el operador `cm` de PDF: la matriz nueva se aplica
// ANTES de la actual (CTM' = M × CTM).
function multiplicar(m: Matriz, n: Matriz): Matriz {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function transformarRect(x: number, y: number, w: number, h: number, ctm: Matriz): Caja {
  const puntos = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ].map(([px, py]) => [ctm[0] * px + ctm[2] * py + ctm[4], ctm[1] * px + ctm[3] * py + ctm[5]]);
  const xs = puntos.map((p) => p[0]);
  const ys = puntos.map((p) => p[1]);
  return { izquierda: Math.min(...xs), abajo: Math.min(...ys), derecha: Math.max(...xs), arriba: Math.max(...ys) };
}

const BLANCOS = " \n\r\t\f\0";
const DELIMITADORES = BLANCOS + "()<>[]{}/%";
const PATRON_NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)$/;

// Lector mínimo del contenido de una página: solo sigue q/Q/cm (para
// saber la posición real) y junta los `re` (rectángulos). Strings,
// diccionarios y arreglos se saltan sin interpretarlos. Una imagen en
// línea (BI…EI, binario) corta la lectura: se devuelve lo encontrado
// hasta ahí, nunca se adivina el resto.
export function rectangulosDelContenido(contenido: string): Caja[] {
  const rects: Caja[] = [];
  const pila: Matriz[] = [];
  let ctm = IDENTIDAD;
  let numeros: number[] = [];
  let i = 0;
  const n = contenido.length;

  while (i < n) {
    const c = contenido[i];
    if (BLANCOS.includes(c)) {
      i++;
    } else if (c === "%") {
      while (i < n && contenido[i] !== "\n" && contenido[i] !== "\r") i++;
    } else if (c === "(") {
      let profundidad = 1;
      i++;
      while (i < n && profundidad > 0) {
        if (contenido[i] === "\\") i++;
        else if (contenido[i] === "(") profundidad++;
        else if (contenido[i] === ")") profundidad--;
        i++;
      }
      numeros = [];
    } else if (c === "<" || c === ">") {
      // "<<"/">>" (diccionario) o "<...>" (string hexadecimal): nunca
      // son operandos de q/Q/cm/re.
      if (c === "<" && contenido[i + 1] !== "<") {
        while (i < n && contenido[i] !== ">") i++;
      }
      i += c === contenido[i + 1] ? 2 : 1;
      numeros = [];
    } else if ("[]{}".includes(c)) {
      i++;
      numeros = [];
    } else if (c === "/") {
      i++;
      while (i < n && !DELIMITADORES.includes(contenido[i])) i++;
      numeros = [];
    } else {
      const inicio = i;
      while (i < n && !DELIMITADORES.includes(contenido[i])) i++;
      const token = contenido.slice(inicio, i);
      if (token === "") {
        // Un delimitador suelto (p.ej. un ")" sin su "(") — se salta;
        // sin esto el ciclo nunca avanzaría.
        i++;
        numeros = [];
        continue;
      }
      if (PATRON_NUMERO.test(token)) {
        numeros.push(Number(token));
        continue;
      }
      if (token === "q") pila.push(ctm);
      else if (token === "Q") ctm = pila.pop() ?? IDENTIDAD;
      else if (token === "cm" && numeros.length >= 6) ctm = multiplicar(numeros.slice(-6) as Matriz, ctm);
      else if (token === "re" && numeros.length >= 4) {
        const [x, y, w, h] = numeros.slice(-4);
        rects.push(transformarRect(x, y, w, h, ctm));
      } else if (token === "BI") break;
      numeros = [];
    }
  }
  return rects;
}

// Tamaño del marco real (255.69 x 421.51 pt ≈ 9x15cm) con holgura —
// nunca un rectángulo cualquiera (un código de barras, una línea).
function esMarcoDeGuia(caja: Caja): boolean {
  const ancho = caja.derecha - caja.izquierda;
  const alto = caja.arriba - caja.abajo;
  return ancho >= 235 && ancho <= 300 && alto >= 395 && alto <= 450;
}

function seSolapanCasiTodo(a: Caja, b: Caja): boolean {
  const ancho = Math.min(a.derecha, b.derecha) - Math.max(a.izquierda, b.izquierda);
  const alto = Math.min(a.arriba, b.arriba) - Math.max(a.abajo, b.abajo);
  if (ancho <= 0 || alto <= 0) return false;
  const areaMenor = Math.min((a.derecha - a.izquierda) * (a.arriba - a.abajo), (b.derecha - b.izquierda) * (b.arriba - b.abajo));
  return (ancho * alto) / areaMenor > 0.9;
}

// El marco se dibuja varias veces casi en el mismo lugar (borde,
// fondo, recorte): se juntan en uno solo. Orden de lectura: de arriba
// hacia abajo y de izquierda a derecha.
export function marcosDeGuia(rects: Caja[]): Caja[] {
  const marcos: Caja[] = [];
  for (const r of rects.filter(esMarcoDeGuia)) {
    const igual = marcos.findIndex((m) => seSolapanCasiTodo(m, r));
    if (igual === -1) {
      marcos.push({ ...r });
      continue;
    }
    const m = marcos[igual];
    marcos[igual] = {
      izquierda: Math.min(m.izquierda, r.izquierda),
      abajo: Math.min(m.abajo, r.abajo),
      derecha: Math.max(m.derecha, r.derecha),
      arriba: Math.max(m.arriba, r.arriba),
    };
  }
  return marcos.sort((a, b) => (Math.abs(a.arriba - b.arriba) > 20 ? b.arriba - a.arriba : a.izquierda - b.izquierda));
}

function contenidoDePagina(doc: PDFDocument, indice: number): string | null {
  try {
    const contents = doc.getPage(indice).node.Contents();
    if (!contents) return null;
    const flujos = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    let texto = "";
    for (const flujo of flujos) {
      if (!(flujo instanceof PDFRawStream)) return null;
      texto += Buffer.from(decodePDFRawStream(flujo).decode()).toString("latin1");
    }
    return texto;
  } catch {
    return null;
  }
}

// Una hoja que YA mide ~10x15 (la guía Flex) no se recorta.
function yaEsTamanoSticker(ancho: number, alto: number): boolean {
  return ancho <= ANCHO_STICKER_PT + 15 && alto <= ALTO_STICKER_PT + 15;
}

const MARGEN_RECORTE_PT = 4;

// Cada guía encontrada pasa a ser su propia página (del tamaño de su
// marco + un margen mínimo); las hojas sin marco reconocible, las ya
// de tamaño sticker y la lista de despacho se copian tal cual.
// Después, reescalarEtiquetaASticker lleva cada página a 10x15.
export async function recortarGuias(pdfOriginal: ArrayBuffer): Promise<ArrayBuffer> {
  const original = await PDFDocument.load(pdfOriginal);
  const salida = await PDFDocument.create();

  for (let i = 0; i < original.getPageCount(); i++) {
    const pagina = original.getPage(i);
    const { width, height } = pagina.getSize();
    const contenido = yaEsTamanoSticker(width, height) || esHojaDeLista(width, height) ? null : contenidoDePagina(original, i);
    const marcos = contenido ? marcosDeGuia(rectangulosDelContenido(contenido)) : [];

    if (marcos.length === 0) {
      const [copia] = await salida.copyPages(original, [i]);
      salida.addPage(copia);
      continue;
    }
    for (const marco of marcos) {
      const caja = {
        left: Math.max(0, marco.izquierda - MARGEN_RECORTE_PT),
        bottom: Math.max(0, marco.abajo - MARGEN_RECORTE_PT),
        right: Math.min(width, marco.derecha + MARGEN_RECORTE_PT),
        top: Math.min(height, marco.arriba + MARGEN_RECORTE_PT),
      };
      const incrustada = await salida.embedPage(pagina, caja);
      salida.addPage([caja.right - caja.left, caja.top - caja.bottom]).drawPage(incrustada, { x: 0, y: 0 });
    }
  }

  const bytes = await salida.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// Una guía de la impresión masiva, ya lista: sin la hoja de lista de
// despacho, con su franja CONTENIDO y, en sticker, recortada a su
// marco y llevada a 10x15. Mismo orden que "Ver guía (sticker)": el
// recorte va antes de la franja para que quede pegada a la guía.
export async function prepararGuiaDeLote(pdf: ArrayBuffer, items: ItemContenidoEtiqueta[], sticker: boolean): Promise<ArrayBuffer> {
  let guia = await quitarHojasDeLista(pdf);
  if (sticker) guia = await recortarGuias(guia);
  guia = await agregarContenidoAEtiqueta(guia, items);
  return sticker ? reescalarEtiquetaASticker(guia) : guia;
}

// Junta los PDFs de cada guía, en el mismo orden, en uno solo.
export async function unirPdfs(pdfs: ArrayBuffer[]): Promise<ArrayBuffer> {
  const salida = await PDFDocument.create();
  for (const pdf of pdfs) {
    const doc = await PDFDocument.load(pdf);
    for (const pagina of await salida.copyPages(doc, doc.getPageIndices())) salida.addPage(pagina);
  }
  const bytes = await salida.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
