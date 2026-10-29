// Rama feat-publicar-clip — mismo criterio que
// app/panel/publicar/fotos/validar-url-externa.ts (tipoImagenPorMagicBytes):
// el Content-Type/MIME que declara el navegador (o el servidor remoto,
// para un video traído por link) nunca es prueba real de qué bytes son
// esos. Se confirma contra la firma binaria REAL del contenedor de
// video antes de subir nada a Mercado Libre — nunca se confía solo en
// lo declarado. Solo hace falta leer los primeros bytes del archivo
// (nunca el archivo de video COMPLETO, que puede pesar hasta 280MB).
export type TipoVideoDetectado = "video/mp4" | "video/quicktime" | "video/mpeg" | "video/x-msvideo";

function textoDe(buffer: Buffer | Uint8Array, inicio: number, fin: number): string {
  return String.fromCharCode(...buffer.subarray(inicio, fin));
}

export function tipoVideoPorMagicBytes(buffer: Buffer | Uint8Array): TipoVideoDetectado | null {
  // ISO-BMFF (MP4/MOV/M4V comparten el mismo contenedor real) — bytes
  // 4-7 son siempre "ftyp" (bytes 0-3 son el tamaño de esa "box", un
  // número que varía, nunca se valida). La "marca" de 4 bytes justo
  // después ("qt  " para QuickTime/MOV real; "isom"/"mp41"/"mp42"/
  // "MSNV"/etc. para MP4) decide a cuál de los dos mapear — cualquier
  // otra marca real de ISO-BMFF se trata como MP4, el formato más
  // común, nunca se rechaza por no reconocer la marca puntual.
  if (buffer.length >= 12 && textoDe(buffer, 4, 8) === "ftyp") {
    const marca = textoDe(buffer, 8, 12).trim().toLowerCase();
    return marca === "qt" ? "video/quicktime" : "video/mp4";
  }
  // AVI: contenedor RIFF (mismo patrón que WEBP, pero con "AVI " en
  // vez de "WEBP" en los bytes 8-11 — el espacio final es parte real
  // de la firma, RIFF rellena los códigos de 4 letras con espacios).
  if (buffer.length >= 11 && textoDe(buffer, 0, 4) === "RIFF" && textoDe(buffer, 8, 11) === "AVI") {
    return "video/x-msvideo";
  }
  // MPEG (Program Stream) — encabezado de "pack" real: 00 00 01 BA.
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0xba) {
    return "video/mpeg";
  }
  return null;
}
