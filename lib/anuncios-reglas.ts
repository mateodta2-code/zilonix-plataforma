// Anuncios de la plataforma (25-nov) — reglas puras (sin base ni Next): las
// usan el superadmin, el panel del vendedor y las pruebas.

export const TIPOS_ANUNCIO = {
  info: "Información",
  advertencia: "Advertencia",
  peligro: "Problema",
} as const;
export type TipoAnuncio = keyof typeof TIPOS_ANUNCIO;
export const MENSAJE_MAXIMO = 300;

export type EstadoAnuncio = "programado" | "activo" | "vencido" | "retirado";
export const ETIQUETA_ESTADO_ANUNCIO: Record<EstadoAnuncio, string> = {
  programado: "Programado",
  activo: "Activo",
  vencido: "Vencido",
  retirado: "Retirado",
};

export function estadoAnuncio(a: { inicioTs: Date; finTs: Date | null; retiradoTs: Date | null }, ahora: Date): EstadoAnuncio {
  if (a.retiradoTs) return "retirado";
  if (a.inicioTs > ahora) return "programado";
  if (a.finTs && a.finTs <= ahora) return "vencido";
  return "activo";
}

// El formulario manda fecha y hora de Colombia («2026-11-25T14:30», sin zona,
// así llega un <input type="datetime-local">). Colombia es UTC-5 todo el año
// (sin horario de verano), por eso se fija -05:00. Vacío = null.
export function fechaColombia(valor: string): Date | null | "invalida" {
  const limpio = valor.trim();
  if (!limpio) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(limpio)) return "invalida";
  const fecha = new Date(`${limpio}:00-05:00`);
  return Number.isNaN(fecha.getTime()) ? "invalida" : fecha;
}

export type AnuncioNuevo = { mensaje: string; tipo: TipoAnuncio; inicioTs: Date; finTs: Date | null };

// Sin «desde» = ahora. «Hasta» es opcional, pero si viene tiene que ser
// después de «desde» y no puede estar ya en el pasado.
export function validarAnuncio(entrada: { mensaje: string; tipo: string; desde: string; hasta: string }, ahora: Date): { ok: true; anuncio: AnuncioNuevo } | { ok: false; error: string } {
  const mensaje = entrada.mensaje.trim().replace(/\s+/g, " ");
  if (!mensaje) return { ok: false, error: "Escribe el mensaje del anuncio." };
  if (mensaje.length > MENSAJE_MAXIMO) return { ok: false, error: `El mensaje no puede pasar de ${MENSAJE_MAXIMO} caracteres.` };
  if (!Object.prototype.hasOwnProperty.call(TIPOS_ANUNCIO, entrada.tipo)) return { ok: false, error: "Elige el tipo de anuncio." };
  const desde = fechaColombia(entrada.desde);
  const hasta = fechaColombia(entrada.hasta);
  if (desde === "invalida" || hasta === "invalida") return { ok: false, error: "Revisa las fechas." };
  const inicioTs = desde ?? ahora;
  if (hasta && hasta <= inicioTs) return { ok: false, error: "«Hasta» tiene que ser después de «Desde»." };
  if (hasta && hasta <= ahora) return { ok: false, error: "«Hasta» ya pasó." };
  return { ok: true, anuncio: { mensaje, tipo: entrada.tipo as TipoAnuncio, inicioTs, finTs: hasta } };
}
