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
