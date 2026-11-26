import { esJpeg } from "@/lib/entregas/foto";

// Capturas de los tickets de soporte (25-nov) — reglas puras. Las imágenes
// son PRIVADAS en Cloudinary, en zilonix-soporte/<empresa>/<ticket>-<uuid>.
// Una ruta solo sirve una imagen si su id tiene EXACTAMENTE ese prefijo
// (empresa y ticket del que se pide): así, aunque alguien lograra guardar en
// su ticket el id de una imagen ajena (otra empresa, una foto de entrega),
// nunca se serviría.

export const MAX_IMAGENES_TICKET = 3;
// Las capturas de pantalla se leen mejor con más resolución que una foto
// de entrega: lado mayor 2000 px.
export const LADO_MAXIMO_CAPTURA = 2000;
export const CALIDAD_CAPTURA = 0.85;
export const BYTES_MAXIMOS_CAPTURA = 3 * 1024 * 1024;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ARCHIVO_RE = new RegExp(`^${UUID}$`, "i");

export function carpetaSoporte(empresaId: string): string {
  return `zilonix-soporte/${empresaId}`;
}

// El «archivo» que viaja en la URL de la imagen: el uuid final del id.
export function esArchivoValido(archivo: string): boolean {
  return ARCHIVO_RE.test(archivo);
}

// El id completo que esa empresa y ese ticket tendrían para ese archivo.
export function publicIdDe(empresaId: string, ticketId: string, archivo: string): string {
  return `${carpetaSoporte(empresaId)}/${ticketId}-${archivo}`;
}

// El archivo (uuid) de un id guardado, o null si el id no es de ese ticket
// y esa empresa.
export function archivoDe(publicId: string, empresaId: string, ticketId: string): string | null {
  const prefijo = `${carpetaSoporte(empresaId)}/${ticketId}-`;
  if (!publicId.startsWith(prefijo)) return null;
  const archivo = publicId.slice(prefijo.length);
  return esArchivoValido(archivo) ? archivo : null;
}

// null si las imágenes sirven; si no, el texto para el usuario.
export function validarImagenesTicket(imagenes: Uint8Array[]): string | null {
  if (imagenes.length > MAX_IMAGENES_TICKET) return `Puedes adjuntar hasta ${MAX_IMAGENES_TICKET} imágenes por mensaje.`;
  for (const bytes of imagenes) {
    if (bytes.length === 0) return "Una de las imágenes está vacía. Vuelve a adjuntarla.";
    if (bytes.length > BYTES_MAXIMOS_CAPTURA) return "Una de las imágenes pesa demasiado. Vuelve a adjuntarla.";
    if (!esJpeg(bytes)) return "Uno de los archivos no es una imagen válida. Vuelve a adjuntarla.";
  }
  return null;
}
