// Tickets de soporte (issue #623) — validaciones puras, sin base de
// datos, para probarlas sin Postgres.

// Mensaje pensado para mostrarse tal cual. Cualquier otro error (la
// base, un bug) nunca llega al cliente con su texto crudo.
export class SoporteError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SoporteError";
  }
}

export const LIMITES_SOPORTE = {
  asuntoMin: 5,
  asuntoMax: 150,
  mensajeMin: 10,
  mensajeMax: 5000,
  respuestaMin: 2,
  respuestaMax: 5000,
} as const;

// Lista cerrada: el módulo que llega del formulario nunca se guarda tal cual.
export const MODULOS_SOPORTE = [
  "Pedidos",
  "Productos e inventario",
  "Finanzas",
  "Publicidad",
  "Promociones",
  "Publicar",
  "Mercado Libre",
  "Falabella",
  "Personas y roles",
  "Bodegas",
  "Otro",
] as const;
export type ModuloSoporte = (typeof MODULOS_SOPORTE)[number];

export const ESTADOS_TICKET = ["abierto", "en_curso", "resuelto"] as const;
export type EstadoTicket = (typeof ESTADOS_TICKET)[number];

export const ETIQUETA_ESTADO_TICKET: Record<EstadoTicket, string> = {
  abierto: "Abierto",
  en_curso: "En curso",
  resuelto: "Resuelto",
};

function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validarTicket(asunto: unknown, mensaje: unknown, modulo: unknown): { asunto: string; mensaje: string; modulo: ModuloSoporte } {
  const a = normalizar(asunto).replace(/\s+/g, " ");
  const m = normalizar(mensaje);
  if (a.length < LIMITES_SOPORTE.asuntoMin) throw new SoporteError(`El asunto necesita al menos ${LIMITES_SOPORTE.asuntoMin} caracteres.`);
  if (a.length > LIMITES_SOPORTE.asuntoMax) throw new SoporteError(`El asunto puede tener máximo ${LIMITES_SOPORTE.asuntoMax} caracteres.`);
  if (m.length < LIMITES_SOPORTE.mensajeMin) throw new SoporteError(`Cuéntanos un poco más (mínimo ${LIMITES_SOPORTE.mensajeMin} caracteres).`);
  if (m.length > LIMITES_SOPORTE.mensajeMax) throw new SoporteError(`El mensaje puede tener máximo ${LIMITES_SOPORTE.mensajeMax} caracteres.`);
  const mod = MODULOS_SOPORTE.find((x) => x === modulo);
  if (!mod) throw new SoporteError("Elige el módulo al que se refiere tu consulta.");
  return { asunto: a, mensaje: m, modulo: mod };
}

export function validarMensajeTicket(mensaje: unknown): string {
  const m = normalizar(mensaje);
  if (m.length < LIMITES_SOPORTE.respuestaMin) throw new SoporteError("Escribe tu mensaje antes de enviarlo.");
  if (m.length > LIMITES_SOPORTE.respuestaMax) throw new SoporteError(`El mensaje puede tener máximo ${LIMITES_SOPORTE.respuestaMax} caracteres.`);
  return m;
}

export function esUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}
