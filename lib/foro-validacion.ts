// Foro de la comunidad — validaciones puras (sin base de datos), aparte
// de lib/foro.ts para poder probarlas sin Postgres.

// Error con un mensaje pensado para mostrarse tal cual a la persona.
// Cualquier otro error (la base, un bug) nunca llega al cliente con su
// texto crudo — las acciones lo cambian por un mensaje genérico.
export class ForoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ForoError";
  }
}

export const LIMITES_FORO = {
  tituloMin: 5,
  tituloMax: 150,
  cuerpoMin: 10,
  cuerpoMax: 5000,
  respuestaMin: 2,
  respuestaMax: 5000,
} as const;

// Saltos de línea de más (pegar desde otro lado) se recortan a uno en
// blanco como máximo; el resto del texto queda igual. Nunca se guarda
// HTML interpretado: React lo pinta como texto plano.
function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validarPregunta(titulo: unknown, cuerpo: unknown): { titulo: string; cuerpo: string } {
  const t = normalizar(titulo).replace(/\s+/g, " ");
  const c = normalizar(cuerpo);
  if (t.length < LIMITES_FORO.tituloMin) throw new ForoError(`El título necesita al menos ${LIMITES_FORO.tituloMin} caracteres.`);
  if (t.length > LIMITES_FORO.tituloMax) throw new ForoError(`El título puede tener máximo ${LIMITES_FORO.tituloMax} caracteres.`);
  if (c.length < LIMITES_FORO.cuerpoMin) throw new ForoError(`Cuenta un poco más tu pregunta (mínimo ${LIMITES_FORO.cuerpoMin} caracteres).`);
  if (c.length > LIMITES_FORO.cuerpoMax) throw new ForoError(`La pregunta puede tener máximo ${LIMITES_FORO.cuerpoMax} caracteres.`);
  return { titulo: t, cuerpo: c };
}

export function validarRespuesta(cuerpo: unknown): string {
  const c = normalizar(cuerpo);
  if (c.length < LIMITES_FORO.respuestaMin) throw new ForoError("Escribe tu respuesta antes de publicarla.");
  if (c.length > LIMITES_FORO.respuestaMax) throw new ForoError(`La respuesta puede tener máximo ${LIMITES_FORO.respuestaMax} caracteres.`);
  return c;
}

// "%" y "_" son comodines de ILIKE: escritos por la persona se buscan
// literal, nunca como patrón.
export function patronBusqueda(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// Carpeta de Cloudinary donde /api/foro/imagen guarda las imágenes del
// foro — separada de las fotos de Publicar (zilonix-plataforma).
export const CARPETA_IMAGENES_FORO = "zilonix-foro";

// Solo se acepta una imagen que salió de /api/foro/imagen: nuestro
// Cloudinary, carpeta zilonix-foro, sin parámetros. Un link a otro
// sitio permitiría rastrear quién abre la pregunta (la imagen se pide a
// ese servidor) o cambiarla después de moderada (decisión del 14-nov:
// solo "Adjuntar imagen", nunca pegar un link).
export function esUrlImagenForo(url: string, cloudName: string | undefined): boolean {
  if (!cloudName || !/^[A-Za-z0-9_-]+$/.test(cloudName)) return false;
  const patron = new RegExp(String.raw`^https://res\.cloudinary\.com/${cloudName}/image/upload/(v\d+/)?${CARPETA_IMAGENES_FORO}/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$`);
  return patron.test(url);
}

// null = sin imagen. Una URL que no es nuestra se rechaza con un
// mensaje, nunca se guarda en silencio sin la imagen.
export function validarImagenForo(url: unknown, cloudName: string | undefined): string | null {
  const texto = String(url ?? "").trim();
  if (!texto) return null;
  if (!esUrlImagenForo(texto, cloudName)) throw new ForoError("La imagen no es válida. Vuelve a adjuntarla.");
  return texto;
}
