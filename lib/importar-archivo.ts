import { inflateRawSync } from "zlib";
import {
  detectarDelimitador,
  excedeTamanoMaximo,
  partirFilasLogicas,
  quitarBom,
  separarCamposCsv,
  TAMANO_MAXIMO_BYTES,
} from "@/lib/importar-csv-skus";

// Issue #128 (Z-FIN-06) — lector compartido de .csv y .xlsx (la tabla
// maestra hoy; cuentas de cobro #137 y #140 después). Solo lee celdas:
// no sabe de columnas de negocio ni toca la base.
//
// Sin librería de Excel a propósito: el issue pide que una dependencia
// nueva vaya en un PR aparte, revisado por licencia y seguridad. Un
// .xlsx es un ZIP con XML adentro; acá se lee solo lo necesario (la
// hoja, los textos compartidos y el tipo de cada celda) con el zlib de
// Node. No se soportan .xls viejos, ZIP64 ni archivos cifrados.
//
// Una celda conserva su tipo porque las reglas de #127 lo necesitan:
// en el costo, una celda vacía ("sin costo") no es lo mismo que un 0.

export type Celda =
  | { tipo: "vacia" }
  // Número guardado como número en Excel, ya pasado a decimal plano
  // ("3000", "1234.56"). Nunca pasa por Number.
  | { tipo: "numero"; valor: string }
  | { tipo: "texto"; valor: string };

export type FilaArchivo = { numeroFila: number; celdas: Celda[] };

export type HojaLeida = { ok: true; filas: FilaArchivo[] } | { ok: false; mensaje: string };

export const FORMATOS_ARCHIVO = ["csv", "xlsx"] as const;
export type FormatoArchivo = (typeof FORMATOS_ARCHIVO)[number];

// Mismo tope del importador de SKU para el archivo que sube la persona.
export const TAMANO_MAXIMO_ARCHIVO = TAMANO_MAXIMO_BYTES;
// Un .xlsx de 5 MB comprimido puede inflar mucho más. Cada parte del
// ZIP se corta en 40 MB: un archivo armado para inflar sin fin se
// rechaza en vez de llenar la memoria del servidor.
const TAMANO_MAXIMO_PARTE_XLSX = 40 * 1024 * 1024;
const FILAS_MAXIMAS_XLSX = 20_000;
const COLUMNAS_MAXIMAS = 200;

const VACIA: Celda = { tipo: "vacia" };

// Una celda de texto con solo espacios cuenta como vacía [SUPUESTO del
// issue #128].
function celdaDeTexto(texto: string): Celda {
  return texto.trim() === "" ? VACIA : { tipo: "texto", valor: texto };
}

export function formatoDeNombre(nombre: string): FormatoArchivo | null {
  const minuscula = nombre.toLowerCase();
  if (minuscula.endsWith(".csv")) return "csv";
  if (minuscula.endsWith(".xlsx")) return "xlsx";
  return null;
}

export function leerArchivo(nombre: string, contenido: Buffer): HojaLeida {
  if (contenido.length > TAMANO_MAXIMO_ARCHIVO) {
    return { ok: false, mensaje: `El archivo supera el tamaño máximo de ${TAMANO_MAXIMO_ARCHIVO / (1024 * 1024)} MB.` };
  }
  const formato = formatoDeNombre(nombre);
  if (formato === "csv") return leerCsv(contenido.toString("utf8"));
  if (formato === "xlsx") return leerXlsx(contenido);
  return { ok: false, mensaje: "Sube un archivo .xlsx o .csv. Los .xls viejos no se leen: guárdalo como .xlsx." };
}

// ---------- CSV ----------

export function leerCsv(textoCsv: string): HojaLeida {
  if (excedeTamanoMaximo(textoCsv)) {
    return { ok: false, mensaje: `El archivo supera el tamaño máximo de ${TAMANO_MAXIMO_ARCHIVO / (1024 * 1024)} MB.` };
  }
  const particion = partirFilasLogicas(quitarBom(textoCsv));
  if (!particion.ok) return { ok: false, mensaje: `El archivo supera el máximo de filas (fila ${particion.numeroFila}).` };

  const encabezado = particion.filas.find((f) => f.raw.trim() !== "");
  const delimitador = detectarDelimitador(encabezado?.raw ?? "");
  return {
    ok: true,
    filas: particion.filas.map((f) => ({
      numeroFila: f.numeroFila,
      // En CSV todo llega como texto: `""` es vacía y `0` es texto "0".
      celdas: separarCamposCsv(f.raw, delimitador).map(celdaDeTexto),
    })),
  };
}

// ---------- XLSX ----------

class XlsxInvalidoError extends Error {}

type EntradaZip = { metodo: number; tamanoComprimido: number; offsetLocal: number; cifrada: boolean };

function leerDirectorioZip(zip: Buffer): Map<string, EntradaZip> {
  // Fin del directorio central: firma 0x06054b50 en los últimos 64 KB.
  const desde = Math.max(0, zip.length - 65_557);
  let fin = -1;
  for (let i = zip.length - 22; i >= desde; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new XlsxInvalidoError("El archivo no es un .xlsx válido.");

  const total = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  if (p === 0xffffffff || total === 0xffff) throw new XlsxInvalidoError("El .xlsx es demasiado grande para leerlo aquí.");

  const entradas = new Map<string, EntradaZip>();
  for (let n = 0; n < total; n++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) throw new XlsxInvalidoError("El .xlsx está dañado.");
    const banderas = zip.readUInt16LE(p + 8);
    const metodo = zip.readUInt16LE(p + 10);
    const tamanoComprimido = zip.readUInt32LE(p + 20);
    const largoNombre = zip.readUInt16LE(p + 28);
    const largoExtra = zip.readUInt16LE(p + 30);
    const largoComentario = zip.readUInt16LE(p + 32);
    const offsetLocal = zip.readUInt32LE(p + 42);
    const nombre = zip.toString("utf8", p + 46, p + 46 + largoNombre);
    entradas.set(nombre, { metodo, tamanoComprimido, offsetLocal, cifrada: (banderas & 1) === 1 });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

function leerParteZip(zip: Buffer, entradas: Map<string, EntradaZip>, nombre: string): string | null {
  const entrada = entradas.get(nombre);
  if (!entrada) return null;
  if (entrada.cifrada) throw new XlsxInvalidoError("El .xlsx tiene contraseña. Quítala y vuelve a subirlo.");
  const p = entrada.offsetLocal;
  if (p + 30 > zip.length || zip.readUInt32LE(p) !== 0x04034b50) throw new XlsxInvalidoError("El .xlsx está dañado.");
  const inicio = p + 30 + zip.readUInt16LE(p + 26) + zip.readUInt16LE(p + 28);
  const datos = zip.subarray(inicio, inicio + entrada.tamanoComprimido);
  if (entrada.metodo === 0) {
    if (datos.length > TAMANO_MAXIMO_PARTE_XLSX) throw new XlsxInvalidoError("El .xlsx es demasiado grande.");
    return datos.toString("utf8");
  }
  if (entrada.metodo !== 8) throw new XlsxInvalidoError("El .xlsx usa una compresión que no se puede leer.");
  try {
    return inflateRawSync(datos, { maxOutputLength: TAMANO_MAXIMO_PARTE_XLSX }).toString("utf8");
  } catch {
    throw new XlsxInvalidoError("El .xlsx es demasiado grande o está dañado.");
  }
}

function decodificarXml(texto: string): string {
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entidad: string) => {
    if (entidad === "amp") return "&";
    if (entidad === "lt") return "<";
    if (entidad === "gt") return ">";
    if (entidad === "quot") return '"';
    if (entidad === "apos") return "'";
    const codigo = entidad.startsWith("#x") ? parseInt(entidad.slice(2), 16) : parseInt(entidad.slice(1), 10);
    return Number.isFinite(codigo) && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : "";
  });
}

function atributo(atributos: string, nombre: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${nombre}="([^"]*)"`).exec(atributos);
  return m ? decodificarXml(m[1]) : undefined;
}

// Texto de un <si> o <is>: puede venir partido en varios <r><t>.
function textoDeNodo(xml: string): string {
  let texto = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) texto += decodificarXml(m[1]);
  return texto;
}

function columnaDeReferencia(ref: string): number | null {
  const m = /^([A-Z]{1,3})\d+$/.exec(ref);
  if (!m) return null;
  let indice = 0;
  for (const letra of m[1]) indice = indice * 26 + (letra.charCodeAt(0) - 64);
  return indice - 1;
}

// Excel guarda los números como double ("45000.000000000007",
// "1.2E-2"). Se pasan a decimal plano y se redondean a 15 cifras
// significativas, la precisión que Excel muestra; así 0.1+0.2 queda
// "0.3" y no inventa decimales. Todo con texto, nunca con Number.
export function decimalDeNumeroExcel(crudo: string): string | null {
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(crudo.trim());
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const signo = m[1];
  let digitos = `${m[2]}${m[3] ?? ""}`;
  let puntoDecimal = m[2].length + Number(m[4] ?? "0");

  // Quita ceros a la izquierda sin perder la posición del punto.
  const ceros = digitos.length - digitos.replace(/^0+/, "").length;
  digitos = digitos.slice(ceros);
  puntoDecimal -= ceros;
  if (digitos === "") return "0";

  if (digitos.length > 15) {
    const resto = digitos.charCodeAt(15) - 48;
    let cifras = digitos.slice(0, 15).split("").map(Number);
    if (resto >= 5) {
      let i = cifras.length - 1;
      while (i >= 0 && cifras[i] === 9) cifras[i--] = 0;
      if (i < 0) {
        cifras = [1, ...cifras];
        puntoDecimal++;
      } else {
        cifras[i]++;
      }
    }
    digitos = cifras.join("");
  }

  let entero: string;
  let fraccion: string;
  if (puntoDecimal <= 0) {
    entero = "0";
    fraccion = "0".repeat(-puntoDecimal) + digitos;
  } else if (puntoDecimal >= digitos.length) {
    entero = digitos + "0".repeat(puntoDecimal - digitos.length);
    fraccion = "";
  } else {
    entero = digitos.slice(0, puntoDecimal);
    fraccion = digitos.slice(puntoDecimal);
  }
  fraccion = fraccion.replace(/0+$/, "");
  const valor = fraccion ? `${entero}.${fraccion}` : entero;
  return valor === "0" ? "0" : `${signo}${valor}`;
}

function rutaHojaPreferida(zip: Buffer, entradas: Map<string, EntradaZip>, nombrePreferido: string): string {
  const libro = leerParteZip(zip, entradas, "xl/workbook.xml");
  const relaciones = leerParteZip(zip, entradas, "xl/_rels/workbook.xml.rels");
  if (!libro || !relaciones) throw new XlsxInvalidoError("El .xlsx no tiene hojas.");

  const hojas = [...libro.matchAll(/<sheet\s([^>]*?)\/?>/g)].map((m) => ({
    nombre: atributo(m[1], "name") ?? "",
    rId: atributo(m[1], "r:id") ?? "",
  }));
  if (hojas.length === 0) throw new XlsxInvalidoError("El .xlsx no tiene hojas.");
  // La hoja PRODUCTOS si existe; si no, la primera del libro.
  const hoja = hojas.find((h) => h.nombre.trim().toUpperCase() === nombrePreferido) ?? hojas[0];

  for (const m of relaciones.matchAll(/<Relationship\s([^>]*?)\/?>/g)) {
    if (atributo(m[1], "Id") !== hoja.rId) continue;
    const destino = atributo(m[1], "Target") ?? "";
    return destino.startsWith("/") ? destino.slice(1) : `xl/${destino}`;
  }
  throw new XlsxInvalidoError("No se encontró la hoja dentro del .xlsx.");
}

export function leerXlsx(contenido: Buffer, nombreHoja = "PRODUCTOS"): HojaLeida {
  try {
    const entradas = leerDirectorioZip(contenido);
    const ruta = rutaHojaPreferida(contenido, entradas, nombreHoja);
    const hojaXml = leerParteZip(contenido, entradas, ruta);
    if (!hojaXml) throw new XlsxInvalidoError("No se encontró la hoja dentro del .xlsx.");

    const compartidosXml = leerParteZip(contenido, entradas, "xl/sharedStrings.xml");
    const compartidos = compartidosXml ? [...compartidosXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDeNodo(m[1])) : [];

    const filas: FilaArchivo[] = [];
    let siguienteFila = 1;
    for (const m of hojaXml.matchAll(/<row(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const numeroFila = Number(atributo(m[1] ?? "", "r") ?? siguienteFila);
      if (!Number.isSafeInteger(numeroFila) || numeroFila < 1) throw new XlsxInvalidoError("El .xlsx está dañado.");
      siguienteFila = numeroFila + 1;
      if (filas.length >= FILAS_MAXIMAS_XLSX) {
        return { ok: false, mensaje: `El archivo supera el máximo de ${FILAS_MAXIMAS_XLSX} filas.` };
      }

      const celdas: Celda[] = [];
      let siguienteColumna = 0;
      for (const c of (m[2] ?? "").matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const atributos = c[1] ?? "";
        const ref = atributo(atributos, "r");
        const columna = ref ? columnaDeReferencia(ref) : siguienteColumna;
        if (columna === null || columna >= COLUMNAS_MAXIMAS) continue;
        siguienteColumna = columna + 1;

        const interior = c[2] ?? "";
        const tipo = atributo(atributos, "t") ?? "n";
        const v = /<v>([\s\S]*?)<\/v>/.exec(interior)?.[1];
        let celda: Celda = VACIA;
        if (tipo === "s") {
          celda = v === undefined ? VACIA : celdaDeTexto(compartidos[Number(v)] ?? "");
        } else if (tipo === "inlineStr") {
          celda = celdaDeTexto(textoDeNodo(interior));
        } else if (tipo === "str" || tipo === "e") {
          celda = v === undefined ? VACIA : celdaDeTexto(decodificarXml(v));
        } else if (tipo === "b") {
          celda = v === undefined ? VACIA : { tipo: "texto", valor: v === "1" ? "VERDADERO" : "FALSO" };
        } else if (v !== undefined && v.trim() !== "") {
          const decimal = decimalDeNumeroExcel(decodificarXml(v));
          celda = decimal === null ? { tipo: "texto", valor: decodificarXml(v) } : { tipo: "numero", valor: decimal };
        }
        while (celdas.length < columna) celdas.push(VACIA);
        celdas[columna] = celda;
      }
      filas.push({ numeroFila, celdas });
    }
    return { ok: true, filas };
  } catch (error) {
    if (error instanceof XlsxInvalidoError) return { ok: false, mensaje: error.message };
    if (error instanceof RangeError) return { ok: false, mensaje: "El .xlsx está dañado." };
    throw error;
  }
}

// ---------- Montos ----------

export type MontoLeido = { tipo: "vacio" } | { tipo: "monto"; valor: string } | { tipo: "error"; mensaje: string };

const MONTO_MAXIMO_ENTEROS = 12; // numeric(14,2)

function aceptarDecimal(entero: string, fraccion: string, original: string): MontoLeido {
  const enteroLimpio = entero.replace(/^0+(?=\d)/, "");
  const fraccionLimpia = fraccion.replace(/0+$/, "");
  if (fraccionLimpia.length > 2) return { tipo: "error", mensaje: `"${original}" tiene más de 2 decimales.` };
  if (enteroLimpio.length > MONTO_MAXIMO_ENTEROS) return { tipo: "error", mensaje: `"${original}" es demasiado grande.` };
  return { tipo: "monto", valor: fraccionLimpia ? `${enteroLimpio}.${fraccionLimpia}` : enteroLimpio };
}

// Regla para montos escritos como texto (todo el CSV y las celdas de
// texto de un .xlsx), la convención de Colombia:
// - Punto = miles y coma = decimales: "1.234,56", "2.000", "3000,5".
// - Un número con un solo punto y 1 o 2 decimales ("1234.56", "0.5")
//   se lee como decimal: así se exporta desde muchas hojas.
// - "2,000" o "1.234.5" son ambiguos o están mal escritos: error, no
//   se adivina.
// Acepta un "$" y espacios al principio. Nunca pasa por Number.
export function leerMonto(celda: Celda): MontoLeido {
  if (celda.tipo === "vacia") return { tipo: "vacio" };
  if (celda.tipo === "numero") {
    if (celda.valor.startsWith("-")) return { tipo: "error", mensaje: `"${celda.valor}" es negativo.` };
    const [entero, fraccion = ""] = celda.valor.split(".");
    return aceptarDecimal(entero, fraccion, celda.valor);
  }

  const original = celda.valor.trim();
  const texto = original.replace(/^\$\s*/, "").replace(/\s+/g, "");
  if (texto === "") return { tipo: "vacio" };
  if (texto.startsWith("-")) return { tipo: "error", mensaje: `"${original}" es negativo.` };

  if (/^\d+$/.test(texto)) return aceptarDecimal(texto, "", original);
  const conMilesPunto = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/.exec(texto);
  if (conMilesPunto) return aceptarDecimal(conMilesPunto[1].replace(/\./g, ""), conMilesPunto[2] ?? "", original);
  const conComaDecimal = /^(\d+),(\d+)$/.exec(texto);
  if (conComaDecimal) {
    if (conComaDecimal[2].length > 2) {
      return { tipo: "error", mensaje: `"${original}" es ambiguo: usa punto para miles y coma para decimales (ej. 2.000 o 1.234,56).` };
    }
    return aceptarDecimal(conComaDecimal[1], conComaDecimal[2], original);
  }
  const conPuntoDecimal = /^(\d+)\.(\d{1,2})$/.exec(texto);
  if (conPuntoDecimal) return aceptarDecimal(conPuntoDecimal[1], conPuntoDecimal[2], original);
  return { tipo: "error", mensaje: `"${original}" no es un monto válido (ej. 2.000 o 1.234,56).` };
}

export function textoDeCelda(celda: Celda | undefined): string {
  if (!celda || celda.tipo === "vacia") return "";
  return celda.valor.trim();
}
