import { deflateRawSync } from "zlib";

// Issue #128 — arma un .xlsx mínimo de verdad (ZIP + XML) para las
// pruebas, sin librería de Excel. Un string va como texto compartido,
// un número como celda numérica y null como celda vacía: justo la
// diferencia (vacía vs 0) que las reglas de #127 necesitan probar.
export type ValorCeldaPrueba = string | number | null;

function zip(partes: { nombre: string; contenido: string }[]): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;
  for (const parte of partes) {
    const nombre = Buffer.from(parte.nombre, "utf8");
    const datos = deflateRawSync(Buffer.from(parte.contenido, "utf8"));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(Buffer.byteLength(parte.contenido), 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, datos);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(Buffer.byteLength(parte.contenido), 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(offset, 42);
    centrales.push(central, nombre);
    offset += 30 + nombre.length + datos.length;
  }
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(partes.length, 8);
  fin.writeUInt16LE(partes.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

function escaparXml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function letraColumna(indice: number): string {
  let letras = "";
  let n = indice + 1;
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

export function crearXlsxDePrueba(filas: ValorCeldaPrueba[][], nombreHoja = "PRODUCTOS"): Buffer {
  const compartidos: string[] = [];
  const filasXml = filas
    .map((fila, i) => {
      const celdas = fila
        .map((valor, j) => {
          const ref = `${letraColumna(j)}${i + 1}`;
          if (valor === null) return "";
          if (typeof valor === "number") return `<c r="${ref}"><v>${valor}</v></c>`;
          compartidos.push(valor);
          return `<c r="${ref}" t="s"><v>${compartidos.length - 1}</v></c>`;
        })
        .join("");
      return `<row r="${i + 1}">${celdas}</row>`;
    })
    .join("");

  return zip([
    {
      nombre: "xl/workbook.xml",
      contenido: `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Otra" sheetId="2" r:id="rId2"/><sheet name="${escaparXml(nombreHoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      contenido: `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    },
    { nombre: "xl/worksheets/sheet1.xml", contenido: `<worksheet><sheetData>${filasXml}</sheetData></worksheet>` },
    { nombre: "xl/worksheets/sheet2.xml", contenido: `<worksheet><sheetData><row r="1"><c r="A1"><v>99</v></c></row></sheetData></worksheet>` },
    {
      nombre: "xl/sharedStrings.xml",
      contenido: `<sst>${compartidos.map((t) => `<si><t xml:space="preserve">${escaparXml(t)}</t></si>`).join("")}</sst>`,
    },
  ]);
}
