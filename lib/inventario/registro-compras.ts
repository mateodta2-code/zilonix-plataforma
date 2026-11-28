// Registro de compras (27-nov) — piezas puras de la pantalla tipo hoja del
// Zilonix OS («PRODUCTOS COMPRADOS»): una fila = un producto comprado.
// Sin base ni Next: las usan lib/inventario/compras.ts, las acciones y el
// formulario (cliente), y se prueban solas.

// Plataformas de la lista; cualquier otra se escribe a mano («Otra»).
export const PLATAFORMAS_COMPRA = ["Amazon", "AliExpress", "Temu", "Shein", "Alibaba", "Mercado Libre"] as const;

export class DatosCompraInvalidosError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DatosCompraInvalidosError";
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(texto: string): boolean {
  if (!FECHA.test(texto)) return false;
  const [a, m, d] = texto.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

function textoOpcional(valor: string | null | undefined, maximo: number, etiqueta: string): string | null {
  const limpio = (valor ?? "").trim().replace(/\s+/g, " ");
  if (limpio === "") return null;
  if (limpio.length > maximo) throw new DatosCompraInvalidosError(`${etiqueta}: máximo ${maximo} caracteres.`);
  return limpio;
}

function fechaOpcional(valor: string | null | undefined, etiqueta: string): string | null {
  const limpio = (valor ?? "").trim();
  if (limpio === "") return null;
  if (!fechaValida(limpio)) throw new DatosCompraInvalidosError(`${etiqueta}: usa una fecha real (AAAA-MM-DD).`);
  return limpio;
}

export type DatosCompra = {
  fechaCompra: string | null;
  formaPago: string | null;
  plataforma: string | null;
  ordenPlataforma: string | null;
  linkCompra: string | null;
  entregaEstimada: string | null;
};

// Valida y limpia los datos de la compra en la plataforma. El link solo
// puede ser http(s): se pinta como enlace y nunca debe poder ser
// javascript: ni data:. Los mismos topes que los CHECK de la base.
export function validarDatosCompra(entrada: {
  fechaCompra?: string | null;
  formaPago?: string | null;
  plataforma?: string | null;
  ordenPlataforma?: string | null;
  linkCompra?: string | null;
  entregaEstimada?: string | null;
}): DatosCompra {
  const link = textoOpcional(entrada.linkCompra, 500, "Link de compra");
  if (link !== null) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new DatosCompraInvalidosError("Link de compra: pega el enlace completo, empezando por https://");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new DatosCompraInvalidosError("Link de compra: solo enlaces que empiecen por https:// o http://");
    }
  }
  return {
    fechaCompra: fechaOpcional(entrada.fechaCompra, "Fecha de compra"),
    formaPago: textoOpcional(entrada.formaPago, 60, "Forma de pago"),
    plataforma: textoOpcional(entrada.plataforma, 40, "Plataforma"),
    ordenPlataforma: textoOpcional(entrada.ordenPlataforma, 80, "Orden de compra"),
    linkCompra: link,
    entregaEstimada: fechaOpcional(entrada.entregaEstimada, "Entrega estimada"),
  };
}

// SKU sugerido para un producto nuevo, como los del OS (FULCEP5716,
// FULTAB5717): «FUL» + las 3 primeras letras del nombre (sin tildes ni
// símbolos) + 4 números al azar. Queda editable en el formulario; si
// choca con uno existente, la base lo rechaza y se pide otro.
export function sugerirCodigoSku(nombre: string, aleatorio: () => number = Math.random): string {
  const letras = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const tres = (letras + "XXX").slice(0, 3);
  const numero = String(Math.floor(aleatorio() * 10000)).padStart(4, "0").slice(0, 4);
  return `FUL${tres}${numero}`;
}

// Código de SKU escrito a mano: mayúsculas, letras, números y guiones,
// de 3 a 40. Mismo criterio que pide la tabla de SKU para buscar y copiar.
export function validarCodigoSku(codigo: string): string {
  const limpio = codigo.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(limpio)) {
    throw new DatosCompraInvalidosError("SKU: de 3 a 40 letras, números o guiones, sin espacios.");
  }
  return limpio;
}

const DIA_MS = 24 * 60 * 60 * 1000;

function aDiaUtc(texto: string): number | null {
  return fechaValida(texto) ? Date.UTC(Number(texto.slice(0, 4)), Number(texto.slice(5, 7)) - 1, Number(texto.slice(8, 10))) : null;
}

// Días entre dos fechas AAAA-MM-DD (b − a). null si falta alguna.
export function diasEntre(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null;
  const da = aDiaUtc(a);
  const db = aDiaUtc(b);
  return da === null || db === null ? null : Math.round((db - da) / DIA_MS);
}

// Hoy en Bogotá como AAAA-MM-DD (Railway corre en UTC).
export function hoyBogota(ahora: Date): string {
  return new Date(ahora.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// «Días que faltan» para la entrega estimada: solo mientras no ha
// llegado. Negativo = ya se pasó la fecha estimada.
export function diasQueFaltan(entregaEstimada: string | null, fechaEntrega: string | null, hoy: string): number | null {
  if (fechaEntrega !== null) return null;
  return diasEntre(hoy, entregaEstimada);
}

// Texto de la nota del kardex al recibir: siempre dice de qué OC son las
// unidades (pedido del usuario), más la nota que se escribió, si hay.
export function notaRecepcion(numeroOc: number | null, nota: string | null): string | null {
  const partes = [numeroOc !== null ? `OC-${numeroOc}` : null, nota && nota.trim() !== "" ? nota.trim() : null].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : null;
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// «2026-05-14» → «14 may 2026», como la hoja del OS. Lo que no es una
// fecha real se deja tal cual.
export function fechaCorta(fecha: string | null): string {
  if (fecha === null) return "—";
  if (!fechaValida(fecha)) return fecha;
  return `${Number(fecha.slice(8, 10))} ${MESES_CORTOS[Number(fecha.slice(5, 7)) - 1]} ${fecha.slice(0, 4)}`;
}
