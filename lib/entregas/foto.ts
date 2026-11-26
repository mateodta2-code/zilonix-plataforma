// Domi-3 — reglas de la foto de entrega, puras (las usa el servidor; el
// celular ya la manda reducida a JPEG de lado ≤ LADO_MAXIMO_PX).

export const LADO_MAXIMO_PX = 1600;
export const CALIDAD_JPEG = 0.8;
// Una foto de 1600 px a calidad 0,8 pesa ~200-600 KB. 3 MB deja margen sin
// aceptar cualquier archivo.
export const BYTES_MAXIMOS = 3 * 1024 * 1024;

// No se confía en el tipo que declara el navegador: se miran los bytes. Un
// JPEG siempre empieza con FF D8 FF.
export function esJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// null si la foto sirve; si no, el texto para el domiciliario.
export function validarFotoEntrega(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return "Toma la foto de la entrega para confirmarla.";
  if (bytes.length > BYTES_MAXIMOS) return "La foto pesa demasiado. Tómala otra vez.";
  if (!esJpeg(bytes)) return "Ese archivo no es una foto válida. Tómala otra vez.";
  return null;
}
