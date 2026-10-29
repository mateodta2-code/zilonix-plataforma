import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  compararOrdenNatural,
  esImagenDeZipValida,
  extraerImagenesDeZip,
  TOPE_BYTES_POR_IMAGEN_ZIP,
  TOPE_BYTES_ZIP_DESCOMPRIMIDO,
  TOPE_IMAGENES_POR_ZIP,
  ZipInvalidoError,
  ZipVacioError,
} from "./zip";

// Mismas firmas reales que ya usa validar-url-externa.test.ts — para
// que los fixtures de este archivo sean imágenes de verdad (magic
// bytes reales), no un buffer vacío cualquiera.
function bufferJpeg(bytesExtra = 10): Uint8Array {
  const buffer = new Uint8Array(3 + bytesExtra);
  buffer.set([0xff, 0xd8, 0xff]);
  return buffer;
}

function bufferPng(bytesExtra = 10): Uint8Array {
  const buffer = new Uint8Array(8 + bytesExtra);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buffer;
}

describe("esImagenDeZipValida — Parte A (respaldo ZIP sin Canva)", () => {
  it("acepta png/jpg/jpeg/webp (sin importar mayúsculas)", () => {
    expect(esImagenDeZipValida("foto.png")).toBe(true);
    expect(esImagenDeZipValida("foto.JPG")).toBe(true);
    expect(esImagenDeZipValida("carpeta/foto.jpeg")).toBe(true);
    expect(esImagenDeZipValida("foto.WEBP")).toBe(true);
  });

  it("rechaza extensiones que no son imagen", () => {
    expect(esImagenDeZipValida("documento.pdf")).toBe(false);
    expect(esImagenDeZipValida("video.mp4")).toBe(false);
    expect(esImagenDeZipValida("sin-extension")).toBe(false);
  });

  it("rechaza carpetas (nombre termina en /)", () => {
    expect(esImagenDeZipValida("carpeta/")).toBe(false);
  });

  it("rechaza __MACOSX y archivos ocultos (incluido el patrón real ._foto.png de macOS)", () => {
    expect(esImagenDeZipValida("__MACOSX/._foto.png")).toBe(false);
    expect(esImagenDeZipValida("__MACOSX/subcarpeta/._foto.png")).toBe(false);
    expect(esImagenDeZipValida(".DS_Store")).toBe(false);
    expect(esImagenDeZipValida("carpeta/.oculto.png")).toBe(false);
  });

  it("vacío: false, nunca lanza", () => {
    expect(esImagenDeZipValida("")).toBe(false);
  });
});

describe("compararOrdenNatural — orden 1, 2, 10 (nunca alfabético puro)", () => {
  it("ordena números de forma natural, no alfabética", () => {
    const nombres = ["foto-10.png", "foto-2.png", "foto-1.png"];
    expect([...nombres].sort(compararOrdenNatural)).toEqual(["foto-1.png", "foto-2.png", "foto-10.png"]);
  });

  it("1, 2, 10 sin ningún prefijo de texto", () => {
    expect(["10.png", "2.png", "1.png"].sort(compararOrdenNatural)).toEqual(["1.png", "2.png", "10.png"]);
  });

  it("nombres sin números: orden alfabético normal", () => {
    expect(["b.png", "a.png"].sort(compararOrdenNatural)).toEqual(["a.png", "b.png"]);
  });

  it("mismo nombre: 0", () => {
    expect(compararOrdenNatural("foto.png", "foto.png")).toBe(0);
  });
});

describe("extraerImagenesDeZip — Parte A (respaldo ZIP sin Canva)", () => {
  it("ZIP vacío (sin ninguna entrada): ZipVacioError", () => {
    const zip = zipSync({});
    expect(() => extraerImagenesDeZip(zip)).toThrow(ZipVacioError);
  });

  it("ZIP con un solo archivo que no es imagen: ZipVacioError (nada útil que extraer)", () => {
    const zip = zipSync({ "documento.pdf": new Uint8Array([1, 2, 3]) });
    expect(() => extraerImagenesDeZip(zip)).toThrow(ZipVacioError);
  });

  it("no es un ZIP real (bytes cualquiera): ZipInvalidoError, nunca lanza una excepción cruda", () => {
    const basura = new Uint8Array([1, 2, 3, 4, 5]);
    expect(() => extraerImagenesDeZip(basura)).toThrow(ZipInvalidoError);
  });

  it("extrae imágenes reales en orden natural, ignora __MACOSX y un PDF suelto", () => {
    const zip = zipSync({
      "foto-10.png": bufferPng(),
      "foto-2.png": bufferPng(),
      "foto-1.png": bufferPng(),
      "__MACOSX/._foto-1.png": bufferPng(),
      "leeme.pdf": new Uint8Array([1, 2, 3]),
    });
    const resultado = extraerImagenesDeZip(zip);
    expect(resultado.imagenes.map((i) => i.nombre)).toEqual(["foto-1.png", "foto-2.png", "foto-10.png"]);
    expect(resultado.imagenes.every((i) => i.tipo === "image/png")).toBe(true);
    expect(resultado.truncadoPorCantidad).toBe(false);
    expect(resultado.omitidas).toEqual([]);
  });

  it("mezcla real de formatos (jpeg + png), cada uno con su tipo real confirmado por magic bytes", () => {
    const zip = zipSync({ "a.jpg": bufferJpeg(), "b.png": bufferPng() });
    const resultado = extraerImagenesDeZip(zip);
    expect(resultado.imagenes).toEqual([
      { nombre: "a.jpg", datos: expect.any(Uint8Array), tipo: "image/jpeg" },
      { nombre: "b.png", datos: expect.any(Uint8Array), tipo: "image/png" },
    ]);
  });

  it(`más de ${TOPE_IMAGENES_POR_ZIP} imágenes válidas: se toman solo las primeras ${TOPE_IMAGENES_POR_ZIP} en orden natural, truncadoPorCantidad=true`, () => {
    const archivos: Record<string, Uint8Array> = {};
    for (let i = 1; i <= TOPE_IMAGENES_POR_ZIP + 5; i++) archivos[`foto-${i}.png`] = bufferPng();
    const zip = zipSync(archivos);
    const resultado = extraerImagenesDeZip(zip);
    expect(resultado.imagenes).toHaveLength(TOPE_IMAGENES_POR_ZIP);
    expect(resultado.imagenes[0].nombre).toBe("foto-1.png");
    expect(resultado.imagenes[TOPE_IMAGENES_POR_ZIP - 1].nombre).toBe(`foto-${TOPE_IMAGENES_POR_ZIP}.png`);
    expect(resultado.truncadoPorCantidad).toBe(true);
  });

  // "Cuidado con zip bombs: corta si el tamaño descomprimido supera el
  // límite, sin descomprimir todo primero" — se prueba con el tamaño
  // DECLARADO en el ZIP (fflate lo guarda en el encabezado real, sin
  // necesitar descomprimir para leerlo): una imagen con un tamaño
  // original (sin comprimir) mayor al tope individual queda afuera,
  // nunca se infla.
  it("imagen con tamaño original (declarado) por encima del tope individual: se omite, nunca se infla", () => {
    const grande = bufferPng(TOPE_BYTES_POR_IMAGEN_ZIP + 1024);
    const chica = bufferPng();
    const zip = zipSync({ "grande.png": grande, "chica.png": chica });
    const resultado = extraerImagenesDeZip(zip);
    expect(resultado.imagenes.map((i) => i.nombre)).toEqual(["chica.png"]);
    expect(resultado.omitidas).toEqual([{ nombre: "grande.png", motivo: "demasiado_grande" }]);
  });

  it("presupuesto total descomprimido: una imagen que haría superar el tope total se omite, pero una más chica que SÍ entra después sigue aceptándose", () => {
    // Cada una por debajo del tope INDIVIDUAL (10MB) a propósito —
    // este caso prueba el tope TOTAL (60MB), aislado del individual
    // (ya probado arriba). 6 × 9MB = 54MB (entran); una 7ma de 9MB
    // sumaría 63MB (no entra); una 8va chica todavía cabe en los ~6MB
    // que quedan de presupuesto.
    const archivos: Record<string, Uint8Array> = {};
    const tamanoGrande = 9 * 1024 * 1024;
    for (let i = 1; i <= 6; i++) archivos[`a-big-${i}.png`] = bufferPng(tamanoGrande);
    archivos["b-big-7.png"] = bufferPng(tamanoGrande);
    archivos["c-chica.png"] = bufferPng(100);
    const zip = zipSync(archivos);
    const resultado = extraerImagenesDeZip(zip);
    const nombres = resultado.imagenes.map((i) => i.nombre);
    expect(nombres).toContain("c-chica.png");
    expect(nombres).not.toContain("b-big-7.png");
    expect(nombres.filter((n) => n.startsWith("a-big-"))).toHaveLength(6);
    expect(resultado.omitidas).toEqual([{ nombre: "b-big-7.png", motivo: "demasiado_grande" }]);
  });

  it("archivo con extensión de imagen pero sin firma binaria real: se omite ese archivo puntual, nunca tira abajo el resto del ZIP", () => {
    const disfrazado = new Uint8Array(Buffer.from("esto es texto plano, no una imagen de verdad", "utf8"));
    const zip = zipSync({ "disfrazado.png": disfrazado, "real.png": bufferPng() });
    const resultado = extraerImagenesDeZip(zip);
    expect(resultado.imagenes.map((i) => i.nombre)).toEqual(["real.png"]);
    expect(resultado.omitidas).toEqual([{ nombre: "disfrazado.png", motivo: "tipo_invalido" }]);
  });
});
