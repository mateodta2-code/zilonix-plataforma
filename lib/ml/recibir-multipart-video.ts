import { createWriteStream } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";
import busboy from "busboy";
import { Readable } from "stream";

// Rama feat-publicar-clip, punto 4 — "No cargues 280MB en memoria".
// request.formData() (lo que usaba la versión anterior de esta ruta)
// arma los `File` en memoria igual — es exactamente el problema que el
// pedido prohíbe, solo que escondido detrás de la API estándar. busboy
// SÍ parsea el multipart por streaming de verdad: cada parte de
// archivo se escribe a disco a medida que llega, nunca junta el cuerpo
// entero antes de dar el primer byte. (busboy ya es una dependencia
// TRANSITIVA de next@14 — se declaró ACÁ como dependencia directa en
// package.json porque esta ruta la importa de verdad, nunca depender
// en silencio de un paquete transitivo que Next podría dejar de usar.)

export class MultipartArchivoDemasiadoGrandeError extends Error {}
export class MultipartInvalidoError extends Error {}

export type ArchivoRecibido = { rutaArchivo: string; contentType: string; nombreOriginal: string };

export type ResultadoMultipart = { campos: Record<string, string>; archivos: Record<string, ArchivoRecibido> };

// Code review de Pablo — topes de CANTIDAD, no solo de tamaño: sin
// esto, alguien podía mandar un multipart con cientos de partes
// (archivos chicos o campos de texto) y aunque cada uno respetara el
// tope de bytes individual, el parseo entero (un `rutasCreadas.push`,
// un `escritura`/stream por archivo) crecía sin techo. 20 archivos y 50
// campos son de sobra para el caso real (un video por defecto + hasta
// unos pocos overrides puntuales por cuenta, más `cuentas`/`tempVideoId`
// — ver app/api/ml/clip/route.ts) y chicos a propósito, para que
// cualquier intento real de abuso corte rápido.
const TOPE_ARCHIVOS_MULTIPART = 20;
const TOPE_CAMPOS_MULTIPART = 50;

// Un tope de bytes POR ARCHIVO (no total) — varias cuentas pueden traer
// cada una su propio video de override, así que el límite real es "cada
// parte individual respeta el tamaño máximo de un Clip", nunca una
// suma fija de antemano (no se sabe cuántas partes van a llegar hasta
// parsear los headers).
export async function recibirMultipartVideo(request: Request, topeBytesPorArchivo: number): Promise<ResultadoMultipart> {
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new MultipartInvalidoError("La petición no es multipart/form-data.");
  }
  if (!request.body) throw new MultipartInvalidoError("La petición no tiene cuerpo.");

  const campos: Record<string, string> = {};
  const archivos: Record<string, ArchivoRecibido> = {};
  const rutasCreadas: string[] = [];

  const bb = busboy({
    headers: { "content-type": contentType },
    limits: { fileSize: topeBytesPorArchivo, files: TOPE_ARCHIVOS_MULTIPART, fields: TOPE_CAMPOS_MULTIPART },
  });

  // Bug real encontrado probando esto: el "close" de busboy dispara en
  // cuanto termina de LEER el multipart de entrada, pero cada archivo
  // sigue escribiéndose a disco de forma asíncrona — resolver ahí
  // mismo devolvía `archivos` todavía vacío (race real, no hipotética).
  // Por eso cada archivo tiene su PROPIA promesa (resuelve con su
  // `close` de escritura, nunca antes) y recién se resuelve el
  // resultado final cuando busboy terminó Y todas esas escrituras
  // también.
  const escriturasPendientes: Promise<void>[] = [];

  const finalizado = new Promise<void>((resolve, reject) => {
    let huboError = false;
    const fallar = (error: unknown) => {
      if (huboError) return;
      huboError = true;
      reject(error);
    };

    bb.on("field", (nombre, valor) => {
      campos[nombre] = valor;
    });

    bb.on("file", (nombre, stream, info) => {
      const rutaArchivo = path.join(tmpdir(), `zilonix-clip-subida-${crypto.randomUUID()}.tmp`);
      rutasCreadas.push(rutaArchivo);
      const escritura = createWriteStream(rutaArchivo);
      let truncado = false;

      const promesaArchivo = new Promise<void>((resolveArchivo, rejectArchivo) => {
        stream.on("limit", () => {
          truncado = true;
        });

        stream.on("error", (error) => {
          escritura.destroy();
          rejectArchivo(error);
        });

        escritura.on("error", (error) => {
          stream.unpipe(escritura);
          stream.resume();
          rejectArchivo(error);
        });

        escritura.on("close", () => {
          if (truncado) {
            rejectArchivo(new MultipartArchivoDemasiadoGrandeError("Un archivo de la subida supera el tamaño máximo permitido (280MB)."));
            return;
          }
          archivos[nombre] = { rutaArchivo, contentType: info.mimeType, nombreOriginal: info.filename ?? "clip.mp4" };
          resolveArchivo();
        });

        stream.pipe(escritura);
      });
      escriturasPendientes.push(promesaArchivo);
    });

    // Code review de Pablo — busboy NUNCA lanza por su cuenta al pasar
    // `limits.files`/`limits.fields`: simplemente deja de emitir más
    // partes y emite estos 2 eventos aparte. Sin escucharlos, una
    // subida con de más archivos/campos que el tope terminaría en
    // "close" normal, con solo las primeras N partes — silencioso,
    // nunca un error real. Acá se trata igual que cualquier otra falla
    // de parseo: rechaza con MultipartInvalidoError y limpia todo lo ya
    // escrito (mismo catch de abajo).
    bb.on("filesLimit", () => fallar(new MultipartInvalidoError(`La subida tiene más de ${TOPE_ARCHIVOS_MULTIPART} archivos — rechazada.`)));
    bb.on("fieldsLimit", () => fallar(new MultipartInvalidoError(`La subida tiene más de ${TOPE_CAMPOS_MULTIPART} campos — rechazada.`)));
    bb.on("error", fallar);
    bb.on("close", () => {
      Promise.all(escriturasPendientes).then(() => resolve(), fallar);
    });
  });

  // NextRequest.body es un ReadableStream (Web Streams) — busboy espera
  // un stream de Node clásico. Readable.fromWeb es el puente oficial de
  // Node (≥18) para esto, nunca un Buffer intermedio.
  Readable.fromWeb(request.body as import("stream/web").ReadableStream).pipe(bb);

  try {
    await finalizado;
  } catch (error) {
    // Cualquier falla a mitad de camino (un archivo pasó el tope, un
    // error de red leyendo el cuerpo) borra TODO lo que ya se haya
    // escrito a disco — nunca deja un archivo parcial huérfano en
    // os.tmpdir().
    await Promise.all(rutasCreadas.map((ruta) => rm(ruta, { force: true }).catch(() => undefined)));
    throw error;
  }

  return { campos, archivos };
}
