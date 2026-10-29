import { createWriteStream, createReadStream } from "fs";
import { mkdir, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";
import { HostnameNoResueltoError, HostnamePrivadoError, exigirHostnamePublico } from "@/lib/seguridad/ssrf";
import { tipoVideoPorMagicBytes, type TipoVideoDetectado } from "./video-magic-bytes";

// Rama feat-publicar-clip, punto 1 ("Desde un link") — descarga un
// video externo con el MISMO patrón anti-SSRF que ya usa
// app/panel/publicar/fotos/validar-url-externa.ts para Canva (Parte 3),
// generalizado para video: solo https, allowlist estricta de hosts,
// DNS resuelto y rechazado si cae en una IP privada/link-local/metadata
// (lib/seguridad/ssrf.ts, compartido), redirects seguidos A MANO (nunca
// `redirect:"follow"`) y REVALIDADOS en cada salto — un CDN real puede
// redirigir una vez (a un dominio firmado, por ejemplo), pero nunca se
// sigue un salto fuera de la allowlist. A diferencia de las fotos
// (tope de 10MB, se buffer<iza en memoria), un video real puede pesar
// hasta 280MB — SIEMPRE se escribe a un archivo temporal por streaming,
// nunca se junta en memoria.
export class VideoExternoInvalidoError extends Error {}
export class VideoExternoNoPermitidoError extends Error {}
export class VideoExternoNoDisponibleError extends Error {}
export class VideoExternoDemasiadoGrandeError extends Error {}
export class VideoExternoTipoInvalidoError extends Error {}

const TIMEOUT_MS = 15_000; // más generoso que una foto — un video pesa más y tarda más en empezar a responder
const TOPE_REDIRECTS = 5;
// Mismo límite real que ya exige Mercado Libre para Clips (lib/ml/clip.ts,
// TAMANO_MAXIMO_CLIP_BYTES) — una sola fuente de verdad del número,
// pero declarada acá aparte para no crear un import circular entre
// lib/ml/clip.ts y este archivo (clip.ts VA a importar de acá).
export const TAMANO_MAXIMO_VIDEO_EXTERNO_BYTES = 280 * 1024 * 1024;

// Allowlist de hosts de video — documentada, conservadora, se ajusta
// SOLO con evidencia real (nunca "por si acaso"), mismo criterio que
// la de Canva para fotos.
//
// Canva: confirmado por el pedido real — export-download.canva.com (el
// host que da el link de descarga real de un MP4 exportado) y
// cualquier subdominio de canva.com.
//
// Los 6 marketplaces (Mercado Libre, Amazon, Temu, AliExpress, Alibaba,
// Shein): arranca con los MISMOS hosts de CDN de IMAGEN ya confirmados
// en next.config.mjs (IMG_SRC_CSP, investigación real documentada ahí)
// — varios marketplaces sirven foto y video desde el mismo dominio o
// un hermano directo. **Pendiente real, documentado a propósito, no
// silencioso**: ninguno de estos 6 hosts está confirmado todavía con
// una URL de VIDEO real (solo con fotos) — antes de ir a producción
// hay que probar un link de video real de cada plataforma y ajustar
// esta lista si hace falta (agregar o sacar un host), nunca asumir que
// el de fotos sirve video también solo porque "debería".
const HOSTS_EXACTOS_PERMITIDOS_VIDEO = new Set(["export-download.canva.com"]);
const SUFIJOS_HOST_PERMITIDOS_VIDEO = [
  ".canva.com", // Canva — confirmado por el pedido
  ".mlstatic.com", // Mercado Libre — CDN de imagen confirmado, video SIN confirmar todavía
  ".media-amazon.com", // Amazon — idem
  ".kwcdn.com", // Temu — idem
  ".alicdn.com", // AliExpress/Alibaba — idem
  ".aliexpress-media.com", // AliExpress — idem
  ".ltwebstatic.com", // Shein — idem
];

export function hostPermitidoVideo(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (HOSTS_EXACTOS_PERMITIDOS_VIDEO.has(h)) return true;
  return SUFIJOS_HOST_PERMITIDOS_VIDEO.some((sufijo) => h.endsWith(sufijo));
}

// Varios CDN de marketplaces sirven video con un Content-Type genérico
// ("application/octet-stream", o ninguno) en vez de un video/* real —
// se tolera el HEADER por eso, pero la firma binaria real
// (tipoVideoPorMagicBytes) sigue siendo la prueba de verdad en los dos
// casos, nunca se confía solo en esto.
const TIPOS_DECLARADOS_TOLERADOS = new Set(["video/mp4", "video/quicktime", "video/mpeg", "video/x-msvideo", "application/octet-stream"]);

async function validarYResolverRedirectSeguro(urlActual: URL): Promise<{ url: URL; res: Response } | { redirigidoA: URL }> {
  if (urlActual.protocol !== "https:") throw new VideoExternoInvalidoError("Solo se acepta un link https.");
  if (!hostPermitidoVideo(urlActual.hostname)) {
    throw new VideoExternoNoPermitidoError(`"${urlActual.hostname}" no está en la lista de hosts de video permitidos.`);
  }
  try {
    await exigirHostnamePublico(urlActual.hostname);
  } catch (e) {
    if (e instanceof HostnameNoResueltoError) throw new VideoExternoNoDisponibleError(e.message);
    if (e instanceof HostnamePrivadoError) throw new VideoExternoNoPermitidoError(e.message);
    throw e;
  }

  let res: Response;
  try {
    // `redirect: "manual"` a propósito — nunca se sigue un redirect a
    // ciegas (ver el comentario completo arriba del archivo); esta
    // función revalida CADA salto antes de pedirlo.
    res = await fetch(urlActual.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
  } catch {
    throw new VideoExternoNoDisponibleError("No se pudo descargar ese video a tiempo.");
  }

  // Un redirect real (3xx con Location) — el fetch con redirect:"manual"
  // en Node/undici lo entrega como una respuesta "opaqueredirect" (sin
  // status legible) O como un 3xx normal con el header Location, según
  // el runtime — se revisa el header primero (más confiable), nunca se
  // confía en res.type.
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    const siguiente = new URL(location, urlActual);
    return { redirigidoA: siguiente };
  }

  if (!res.ok) throw new VideoExternoNoDisponibleError(`Ese video respondió ${res.status}.`);
  return { url: urlActual, res };
}

async function seguirHastaElVideo(urlInicial: URL): Promise<Response> {
  let actual = urlInicial;
  for (let salto = 0; salto <= TOPE_REDIRECTS; salto++) {
    const resultado = await validarYResolverRedirectSeguro(actual);
    if ("res" in resultado) return resultado.res;
    actual = resultado.redirigidoA;
  }
  throw new VideoExternoNoPermitidoError("Demasiados redirects siguiendo ese link.");
}

// Separada de descargarVideoExternoSeguro (parametrizada con
// `topeBytes`, nunca la constante fija) para poder probar el corte
// real por streaming con un tope CHICO en los tests — probarlo con el
// tope real de 280MB escribiría a disco cientos de MB en cada corrida,
// lento sin necesidad (la lógica de corte es la misma, nunca depende
// del tamaño real del tope).
export async function escribirCuerpoEnArchivoConTope(res: Response, rutaArchivo: string, topeBytes: number): Promise<void> {
  if (!res.body || typeof (res.body as unknown as { getReader?: unknown }).getReader !== "function") {
    throw new VideoExternoNoDisponibleError("El video no llegó como stream real.");
  }
  const reader = res.body.getReader();
  const escritura = createWriteStream(rutaArchivo);
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > topeBytes) {
        throw new VideoExternoDemasiadoGrandeError("El video supera el tamaño máximo permitido (280MB).");
      }
      await new Promise<void>((resolve, reject) => {
        escritura.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
    }
    // Éxito — recién ACÁ se cierra el archivo de verdad (`end`, nunca
    // `destroy`): esperar a que el stream termine de escribir todo lo
    // que tenía en el buffer interno antes de que el llamador intente
    // leerlo (ej. para las magic bytes).
    await new Promise<void>((resolve, reject) => escritura.end((err: unknown) => (err ? reject(err) : resolve())));
  } catch (error) {
    // Bug real evitado: llamar `escritura.end()` DESPUÉS de
    // `escritura.destroy()` nunca dispara el callback (el stream ya
    // está destruido, "finish" no llega) — esperarlo colgaba esta
    // función para siempre. En el camino de error solo se destruye,
    // nunca se intenta terminarlo prolijo.
    try {
      void reader.cancel();
    } catch {
      // ya cancelado/terminado — nunca rompe por esto
    }
    escritura.destroy();
    await rm(rutaArchivo, { force: true });
    throw error;
  }
}

export type VideoDescargado = { rutaArchivo: string; contentType: TipoVideoDetectado; byteLength: number };

// Lee solo los primeros bytes del archivo YA en disco (nunca el
// archivo completo, que puede pesar hasta 280MB) para confirmar la
// firma binaria real.
function leerPrimerosBytes(rutaArchivo: string, cantidad: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    const stream = createReadStream(rutaArchivo, { start: 0, end: cantidad - 1 });
    stream.on("data", (chunk) => partes.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(partes)));
    stream.on("error", reject);
  });
}

// Descarga el video completo, por streaming, a un archivo temporal
// nuevo en os.tmpdir() (nombre aleatorio real, crypto.randomUUID()).
// NUNCA junta el cuerpo en memoria — corta la escritura (y borra el
// archivo parcial) en el momento exacto en que se supera el tope,
// tenga o no content-length declarado. El llamador es responsable de
// borrar `rutaArchivo` cuando ya no lo necesite (ver
// lib/trabajos/subirClipMultiCuenta.ts — el archivo se comparte entre
// varias cuentas, se borra al terminar el trabajo entero, no acá).
export async function descargarVideoExternoSeguro(urlCruda: string): Promise<VideoDescargado> {
  let urlInicial: URL;
  try {
    urlInicial = new URL(urlCruda);
  } catch {
    throw new VideoExternoInvalidoError("Ese link no es una URL válida.");
  }

  const res = await seguirHastaElVideo(urlInicial);

  const contentTypeDeclarado = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentTypeDeclarado && !TIPOS_DECLARADOS_TOLERADOS.has(contentTypeDeclarado)) {
    throw new VideoExternoTipoInvalidoError(`Tipo de archivo no permitido (${contentTypeDeclarado}) — solo video MP4, MOV, MPEG o AVI.`);
  }

  const contentLengthCrudo = res.headers.get("content-length");
  const contentLength = Number(contentLengthCrudo);
  if (contentLengthCrudo && Number.isFinite(contentLength) && contentLength > TAMANO_MAXIMO_VIDEO_EXTERNO_BYTES) {
    throw new VideoExternoDemasiadoGrandeError("El video supera el tamaño máximo permitido (280MB).");
  }

  const carpetaTemporal = tmpdir();
  await mkdir(carpetaTemporal, { recursive: true });
  const rutaArchivo = path.join(carpetaTemporal, `zilonix-clip-${crypto.randomUUID()}.tmp`);

  await escribirCuerpoEnArchivoConTope(res, rutaArchivo, TAMANO_MAXIMO_VIDEO_EXTERNO_BYTES);

  const encabezado = await leerPrimerosBytes(rutaArchivo, 64 * 1024);
  const contentTypeReal = tipoVideoPorMagicBytes(encabezado);
  if (!contentTypeReal) {
    await rm(rutaArchivo, { force: true });
    throw new VideoExternoTipoInvalidoError("El video descargado no tiene una firma real de MP4, MOV, MPEG ni AVI.");
  }

  const info = await stat(rutaArchivo);
  return { rutaArchivo, contentType: contentTypeReal, byteLength: info.size };
}
