import type { CandidatoClienteCliente } from "./tipos-cliente";

// Rama feat-promociones-aprobacion — cálculos puros de cada fila de la
// tabla de resultados, extraídos para poder probarlos sin montar el
// componente (sin librería de render de React en este repo — mismo
// criterio que resumenBusquedaVacia.ts / mensajes-error.ts).

export function numero(valor: string | null): number | null {
  if (valor == null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

// "Precio con promo" — el precio del deal YA ACTIVO en Mercado Libre
// cuando existe (candidato.precioActual, lo que de verdad se le
// muestra hoy al comprador), con el precio que el motor sugiere como
// respaldo (precioSugerido) para una promoción todavía sin confirmar
// donde ML no mandó un precio propio.
export function precioConPromo(candidato: CandidatoClienteCliente): number | null {
  return numero(candidato.precioActual) ?? numero(candidato.precioSugerido);
}

// % de descuento real contra el precio de hoy (precioOriginal) — null
// cuando falta cualquiera de los dos datos, nunca un 0% inventado.
export function porcentajeDescuento(candidato: CandidatoClienteCliente): number | null {
  const original = numero(candidato.precioOriginal);
  const conPromo = precioConPromo(candidato);
  if (original == null || original <= 0 || conPromo == null) return null;
  return ((original - conPromo) / original) * 100;
}

export type EstadoPrecioMinimo = "cumple" | "por_debajo" | "sin_dato";

// Indicador DEDICADO al piso de Finanzas — distinto de `cumpleReglas`
// (que también exige el tope de descuento de la cuenta y otros
// permisos): acá solo importa si el precio con promo quedó en o por
// encima del precio mínimo, para una lectura rápida fila por fila.
export function estadoPrecioMinimo(candidato: CandidatoClienteCliente): EstadoPrecioMinimo {
  const minimo = numero(candidato.precioMinimo);
  const conPromo = precioConPromo(candidato);
  if (minimo == null || conPromo == null) return "sin_dato";
  return conPromo >= minimo ? "cumple" : "por_debajo";
}

// La acción que corresponde mandar a la API según el estado real en
// Mercado Libre — mismo criterio ya usado en "Aceptar todas las que
// cumplen": "candidate" (todavía no se unió) es "participar"; ya
// confirmada/pendiente es "modificar" (bajar el precio al piso).
export function accionParaCandidato(candidato: CandidatoClienteCliente): "participar" | "modificar" {
  return candidato.estadoMl === "candidate" ? "participar" : "modificar";
}
