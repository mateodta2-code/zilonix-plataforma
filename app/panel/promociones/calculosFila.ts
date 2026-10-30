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

// Bug real (rama feat-promociones-editar-precio, reportado con
// VITALBISGLICINATO: precio hoy 65.900, mínimo 65.900, promo 56.015
// mostrando "CUMPLE" y "QUEDA POR DEBAJO" a la vez) — esta función
// antes prefería candidato.precioActual (lo que ML reporta como
// "sugerido" para un candidato que TODAVÍA no se unió, un número
// crudo de ML que puede venir por DEBAJO del piso) por encima de
// candidato.precioSugerido (el que el motor YA calculó respetando el
// piso — nunca puede quedar por debajo de precioMinimo, por
// construcción: lib/ml/promociones.ts siempre fija precioSugerido =
// precioMinimo cuando hay que participar/modificar). cumpleReglas se
// calcula con precioSugerido — mostrar otro número distinto es
// exactamente la causa del contradicho "Cumple" + "Queda por debajo".
// Ahora precioSugerido manda; precioActual queda SOLO de respaldo
// para cuando el motor nunca llegó a calcular nada (precioSugerido
// null, ej. bloqueado por variantes/sin SKU — ahí no hay nada "con
// promo" que proponer, se muestra el precio real tal cual venía).
export function precioConPromo(candidato: CandidatoClienteCliente): number | null {
  return numero(candidato.precioSugerido) ?? numero(candidato.precioActual);
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

// Rama feat-promociones-editar-precio, punto 1 — rango permitido para
// editar "Precio con promo"/"% desc" a mano. El piso de Finanzas
// (precioMinimo) es el mínimo, SIEMPRE — nunca se negocia acá
// tampoco (el servidor lo vuelve a exigir, ver
// lib/ml/promocionesEjecucion.ts). El techo es lo más chico entre lo
// que Mercado Libre deja para ESTA promoción puntual
// (maxDiscountedPrice, cuando lo manda) y el precio de hoy (nunca
// tiene sentido un "descuento" que termine costando más que el
// precio original). null = no hay rango válido, no se puede editar.
export type RangoEdicionPrecio = { min: number; max: number };

export function rangoEdicion(candidato: CandidatoClienteCliente): RangoEdicionPrecio | null {
  const min = numero(candidato.precioMinimo);
  if (min == null) return null;
  const techoMl = numero(candidato.maxDiscountedPrice);
  const original = numero(candidato.precioOriginal);
  const techos = [techoMl, original].filter((v): v is number => v != null);
  if (techos.length === 0) return null;
  const max = Math.min(...techos);
  if (max < min) return null;
  return { min, max };
}

// Punto 2 (rama fix-promociones-aprobadas-participando) — bug real
// reportado por Mateo: en las filas donde el techo real (lo que deja
// Mercado Libre para esta promoción puntual, o el precio de hoy si no
// hay techo propio) queda EN o POR DEBAJO del piso de Finanzas, "Sí"
// quedaba gris sin ninguna explicación — no hay ningún precio por
// encima del piso que además sea un descuento real, así que no hay
// nada que aprobar. Distinto de "fuera de rango" (calculosFila.ts,
// `fueraDeRango`): ahí existe un rango real y la persona escribió algo
// afuera; acá el rango nunca existió (o es un solo punto) porque el
// piso y el techo quedaron pegados.
export function sinMargen(candidato: CandidatoClienteCliente): boolean {
  const piso = numero(candidato.precioMinimo);
  if (piso == null) return false; // eso es "Falta precio mínimo" — otro caso, otro mensaje
  const techoMl = numero(candidato.maxDiscountedPrice);
  const original = numero(candidato.precioOriginal);
  const techos = [techoMl, original].filter((v): v is number => v != null);
  if (techos.length === 0) return false;
  return Math.min(...techos) <= piso;
}

// Punto 1 — "los tipos que ML no deja editar... se ven como solo
// lectura": `soloEnMl` YA ES exactamente esa lista
// (TIPOS_SIN_ESCRITURA_API, lib/ml/promociones.ts), calculada del
// lado del servidor — nunca se duplica acá para no arrastrar código
// de servidor (ni DATABASE_URL_APP) al bundle del cliente.
export function puedeEditarPrecio(candidato: CandidatoClienteCliente): boolean {
  if (candidato.soloEnMl || candidato.tieneVariantes) return false;
  return rangoEdicion(candidato) != null;
}

// Redondea a pesos enteros (punto 1 — "Redondea a pesos enteros").
export function precioDesdeDescuento(original: number, porcentajeDescuentoElegido: number): number {
  return Math.round(original * (1 - porcentajeDescuentoElegido / 100));
}

export function descuentoDesdePrecio(original: number, precioElegido: number): number {
  if (original <= 0) return 0;
  return ((original - precioElegido) / original) * 100;
}

// Punto 3 (rama fix-promociones-edicion) — bug real reportado por
// Mateo en staging: "27.557278635919...%" salía crudo, sin redondear,
// en las filas de SOLO LECTURA (`porcentajeDescuento` nunca redondea a
// propósito, para no perder precisión en el cálculo — mostrarlo crudo
// en pantalla es un error de presentación distinto). Formato es-CO
// (coma decimal), siempre a 1 decimal, en todas las columnas.
export function formatoPorcentaje(valor: number | null): string {
  if (valor == null) return "—";
  return `${valor.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// Mismo formato que `formatoPorcentaje`, sin el símbolo "%" — para el
// valor de un input editable (el signo ya lo da el encabezado de la
// columna, ponerlo dentro del texto que se edita solo complica parsear
// de vuelta lo que la persona escribió).
export function formatoPorcentajeInput(valor: number): string {
  return valor.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// Precio entero en formato es-CO (puntos de miles), sin el signo "$" —
// para el valor de un input editable de precio.
export function formatoEnteroEsCo(valor: number): string {
  return Math.round(valor).toLocaleString("es-CO");
}

// Punto 1 (rama fix-promociones-edicion) — bug real: los inputs de
// "Precio con promo"/"% desc." redondeaban y CLAMPEABAN en cada tecla
// (cada onChange llamaba de inmediato a algo como esta misma función
// con el valor a medio escribir) — borrar un dígito o escribir un
// número más chico que el mínimo saltaba al instante al piso, nunca
// dejaba terminar de escribir. La corrección real es no tocar nada
// mientras se escribe: se guarda un borrador de texto libre
// (PaginaPromociones.tsx) y esto solo corre al confirmar (blur/Enter).
// Acepta el formato es-CO real que alguien tipearía a mano: puntos de
// miles, coma como separador decimal.
export function parsearNumeroEsCo(texto: string): number | null {
  const limpio = texto.trim().replace(/\./g, "").replace(",", ".");
  if (limpio === "" || limpio === "-") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// Un precio ya confirmado (redondeado) que quedó fuera del rango real
// de ML (`rangoEdicion`) — a propósito, esto YA NO lo fuerza de vuelta
// al rango (ese forzado automático era exactamente el bug de arriba):
// se deja tal cual se escribió, con un aviso, y bloquea "Sí" hasta que
// se corrija a mano. El piso de Finanzas y el techo de ML los vuelve a
// exigir el servidor siempre, sin excepción (lib/ml/promocionesEjecucion.ts).
export function fueraDeRango(candidato: CandidatoClienteCliente, precio: number): boolean {
  const rango = rangoEdicion(candidato);
  if (!rango) return false;
  return precio < rango.min || precio > rango.max;
}

// Utilidad estimada para un precio DISTINTO del sugerido por el motor.
// `costo` nunca se guarda en promociones_candidatos (sin migración,
// solo gananciaEstimada — ya calculada para precioSugerido) así que
// se deriva acá: costo = precioSugerido - gananciaEstimada (válido
// mientras gananciaEstimada se haya calculado CONTRA precioSugerido,
// el caso real de toda fila editable). Es un estimado solo para
// pantalla — el servidor nunca usa este número, revalida todo fresco.
export function gananciaEstimadaParaPrecio(candidato: CandidatoClienteCliente, precioElegido: number): number | null {
  const sugerido = numero(candidato.precioSugerido);
  const gananciaSugerida = numero(candidato.gananciaEstimada);
  if (sugerido == null || gananciaSugerida == null) return null;
  const costoDerivado = sugerido - gananciaSugerida;
  return precioElegido - costoDerivado;
}
