// Revisión de seguridad (hallazgo MED, Parte 3) — el Content-Type que
// manda el servidor (header HTTP, o `file.type` que pone el propio
// navegador en una subida) nunca es prueba real de qué bytes son esos:
// un archivo de texto cualquiera puede declararse "image/jpeg" sin que
// nada lo verifique. Se confirma contra los primeros bytes REALES del
// archivo (firma binaria real de cada formato) antes de subir nada a
// Cloudinary — nunca se confía solo en el header/MIME declarado.
//
// Separado en su propio archivo (rama feat-publicar-fotos-zip) — SIN
// ningún import de Node (`dns`, `net`, etc., que sí usa
// validar-url-externa.ts): esta función también la necesita el código
// que corre en el NAVEGADOR (extraer imágenes de un ZIP del lado del
// cliente, antes de subirlas) — un import de un módulo con `dns/promises`
// rompería el bundle de cliente. `validar-url-externa.ts` (server-only)
// re-exporta esto mismo, para no duplicar la lógica.
export type TipoImagenDetectado = "image/jpeg" | "image/png" | "image/webp";

export function tipoImagenPorMagicBytes(buffer: Buffer | Uint8Array): TipoImagenDetectado | null {
  // JPEG: FF D8 FF (los 3 primeros bytes de cualquier JPEG real).
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // PNG: firma completa de 8 bytes (89 50 4E 47 0D 0A 1A 0A) — el
  // pedido menciona los primeros 4 ("89 50 4E 47"), se confirma la
  // firma real completa, más estricta, nunca menos.
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // WEBP: contenedor RIFF — bytes 0-3 "RIFF", bytes 8-11 "WEBP"
  // (bytes 4-7 son el tamaño del archivo, varían siempre).
  if (buffer.length >= 12 && String.fromCharCode(...buffer.subarray(0, 4)) === "RIFF" && String.fromCharCode(...buffer.subarray(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}
