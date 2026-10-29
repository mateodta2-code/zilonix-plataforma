import { unzipSync } from "fflate";
import { tipoImagenPorMagicBytes, type TipoImagenDetectado } from "./magic-bytes";

// Rama feat-publicar-fotos-zip — respaldo "sin Canva": el negocio
// descarga su diseño de Canva (PNG si tiene una sola página, ZIP si
// tiene varias) y lo suelta en el "+" de la galería o de la portada,
// igual que ya hacía con un archivo suelto. Todo corre en el
// NAVEGADOR de la persona (fflate, una librería liviana — nunca en el
// servidor): el ZIP nunca viaja completo a nuestra infraestructura,
// solo las imágenes ya extraídas y validadas, una por una, por el
// mismo endpoint de Cloudinary que ya existe.

// "60 MB el ZIP entero" (pedido) se aplica en 2 lugares distintos a
// propósito: (1) el tamaño del ARCHIVO .zip tal cual lo soltó/eligió
// la persona (chequeo barato, antes de leer un solo byte — lo hace el
// componente que llama a esto, con file.size); (2) el tope de bytes
// DESCOMPRIMIDOS que esta función está dispuesta a inflar en total
// (ver más abajo) — la defensa real contra una "zip bomb" (un archivo
// chico que, descomprimido, pesa gigas y congela la pestaña).
export const TOPE_BYTES_ZIP_ARCHIVO = 60 * 1024 * 1024;
export const TOPE_BYTES_ZIP_DESCOMPRIMIDO = 60 * 1024 * 1024;
// Mismo tope que ya exige cualquier foto subida a Cloudinary (galería,
// portada, Canva por URL) — una sola fuente de verdad del límite por
// imagen individual.
export const TOPE_BYTES_POR_IMAGEN_ZIP = 10 * 1024 * 1024;
export const TOPE_IMAGENES_POR_ZIP = 20;

export class ZipInvalidoError extends Error {}
export class ZipVacioError extends Error {}

const EXTENSIONES_IMAGEN_ZIP = new Set(["png", "jpg", "jpeg", "webp"]);

// Pura — nombre de archivo (puede traer carpetas, "a/b/foto.png") ->
// extensión real en minúsculas, sin el punto. "" si no tiene ninguna.
function extensionDe(nombre: string): string {
  const base = nombre.split("/").pop() ?? nombre;
  const idx = base.lastIndexOf(".");
  return idx === -1 ? "" : base.slice(idx + 1).toLowerCase();
}

// Punto del pedido — "se ignora lo demás, incluyendo carpetas ocultas y
// __MACOSX". macOS agrega `__MACOSX/` (metadata de Finder) y archivos
// `._NombreReal` (el "resource fork" de AppleDouble) a cualquier ZIP
// armado desde el Finder — ninguno de los dos es una foto real, aunque
// `__MACOSX/._foto.png` "parezca" una imagen solo por la extensión.
// Nunca una carpeta (termina en "/"), nunca un segmento de ruta que
// empiece con "." (tapa tanto `._foto.png` como cualquier otro archivo
// oculto real), y `__MACOSX` como primer segmento queda explícito
// además, por si algún empaquetador no sigue el patrón del punto.
export function esImagenDeZipValida(nombre: string): boolean {
  if (!nombre || nombre.endsWith("/")) return false;
  const segmentos = nombre.split("/");
  if (segmentos[0] === "__MACOSX") return false;
  if (segmentos.some((s) => s.startsWith("."))) return false;
  return EXTENSIONES_IMAGEN_ZIP.has(extensionDe(nombre));
}

// Orden natural real (pedido explícito: "1, 2, 10" — nunca alfabético
// puro, donde "10" ordenaría antes que "2"). Separa el nombre en
// tramos de dígitos vs. no-dígitos y compara tramo a tramo: si los dos
// tramos en la misma posición son números, se comparan como número;
// si no, como texto.
export function compararOrdenNatural(a: string, b: string): number {
  const partesA = a.match(/\d+|\D+/g) ?? [a];
  const partesB = b.match(/\d+|\D+/g) ?? [b];
  const largo = Math.max(partesA.length, partesB.length);
  for (let i = 0; i < largo; i++) {
    const pa = partesA[i] ?? "";
    const pb = partesB[i] ?? "";
    if (pa === pb) continue;
    const esNumA = /^\d+$/.test(pa);
    const esNumB = /^\d+$/.test(pb);
    if (esNumA && esNumB) return Number(pa) - Number(pb);
    return pa < pb ? -1 : 1;
  }
  return 0;
}

export type ImagenDeZip = { nombre: string; datos: Uint8Array; tipo: TipoImagenDetectado };
export type ImagenOmitidaDeZip = { nombre: string; motivo: "demasiado_grande" | "tipo_invalido" };
export type ResultadoExtraccionZip = {
  imagenes: ImagenDeZip[];
  // Había más de TOPE_IMAGENES_POR_ZIP imágenes válidas — se tomaron
  // solo las primeras (orden natural), el resto quedó afuera.
  truncadoPorCantidad: boolean;
  omitidas: ImagenOmitidaDeZip[];
};

// Extrae y valida las imágenes de un .zip ya leído en memoria
// (Uint8Array). DOS pasadas a propósito, nunca una sola:
//
// Pasada 1 — SOLO METADATA. fflate (`unzipSync` con `filter`) lee el
// encabezado real de cada entrada (nombre + tamaño ORIGINAL, formato
// estándar de ZIP, APPNOTE.txt) sin descomprimir nada — el filtro
// siempre devuelve `false`, así que ningún byte se infla todavía. Con
// eso se decide, en base al tamaño DECLARADO (nunca al contenido real
// todavía), qué entradas son candidatas: imagen válida (extensión +
// nunca __MACOSX/oculta), dentro del tope individual
// (TOPE_BYTES_POR_IMAGEN_ZIP) y dentro del presupuesto TOTAL
// (TOPE_BYTES_ZIP_DESCOMPRIMIDO, acumulado en orden natural — una
// imagen que no entra se descarta, pero las siguientes más chicas
// todavía pueden entrar, nunca se corta todo de un tirón).
//
// Pasada 2 — RECIÉN ACÁ se infla, y SOLO el conjunto ya aprobado por
// la pasada 1 — nunca el ZIP entero. Esto es lo que evita una "zip
// bomb": el tamaño descomprimido nunca se mide DESPUÉS de inflar todo,
// se decide ANTES, con datos que no requieren inflar nada.
//
// Defensa extra (el tamaño declarado en el encabezado puede mentir):
// después de inflar, se vuelve a medir el tamaño REAL de cada imagen y
// se valida su firma binaria real (tipoImagenPorMagicBytes, mismo
// criterio que el resto de Publicar) — si alguna de las dos falla, esa
// imagen puntual se omite, nunca se tira abajo el resto del ZIP.
export function extraerImagenesDeZip(buffer: Uint8Array): ResultadoExtraccionZip {
  const entradas: { name: string; originalSize: number }[] = [];
  try {
    unzipSync(buffer, {
      filter(file) {
        entradas.push({ name: file.name, originalSize: file.originalSize });
        return false;
      },
    });
  } catch {
    throw new ZipInvalidoError("No se pudo leer el archivo ZIP — puede estar dañado o no ser un ZIP real.");
  }

  if (entradas.length === 0) throw new ZipVacioError("El ZIP está vacío.");

  const candidatas = entradas.filter((e) => esImagenDeZipValida(e.name)).sort((a, b) => compararOrdenNatural(a.name, b.name));

  if (candidatas.length === 0) throw new ZipVacioError("El ZIP no tiene ninguna imagen PNG, JPG ni WEBP.");

  const omitidas: ImagenOmitidaDeZip[] = [];
  const aceptadas: { name: string; originalSize: number }[] = [];
  let totalAcumulado = 0;
  for (const candidata of candidatas) {
    if (aceptadas.length >= TOPE_IMAGENES_POR_ZIP) break;
    if (candidata.originalSize > TOPE_BYTES_POR_IMAGEN_ZIP || totalAcumulado + candidata.originalSize > TOPE_BYTES_ZIP_DESCOMPRIMIDO) {
      omitidas.push({ nombre: candidata.name, motivo: "demasiado_grande" });
      continue;
    }
    totalAcumulado += candidata.originalSize;
    aceptadas.push(candidata);
  }
  const truncadoPorCantidad = candidatas.length > TOPE_IMAGENES_POR_ZIP;

  const nombresAceptados = new Set(aceptadas.map((a) => a.name));
  let infladas: Record<string, Uint8Array>;
  try {
    infladas = unzipSync(buffer, { filter: (file) => nombresAceptados.has(file.name) });
  } catch {
    throw new ZipInvalidoError("No se pudo leer el archivo ZIP — puede estar dañado o no ser un ZIP real.");
  }

  const imagenes: ImagenDeZip[] = [];
  for (const { name } of aceptadas) {
    const datos = infladas[name];
    if (!datos) continue;
    // El tamaño del encabezado puede mentir — se vuelve a medir el real.
    if (datos.byteLength > TOPE_BYTES_POR_IMAGEN_ZIP) {
      omitidas.push({ nombre: name, motivo: "demasiado_grande" });
      continue;
    }
    const tipo = tipoImagenPorMagicBytes(datos);
    if (!tipo) {
      omitidas.push({ nombre: name, motivo: "tipo_invalido" });
      continue;
    }
    imagenes.push({ nombre: name, datos, tipo });
  }

  return { imagenes, truncadoPorCantidad, omitidas };
}
