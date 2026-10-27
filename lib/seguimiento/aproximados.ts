// Issue #251 — "Seguimiento muestra aproximados como Selltrix":
// vendidos estimados, antigüedad, ventas/mes y facturación/mes para un
// competidor cuyo sold_quantity real Mercado Libre no deja ver por la
// API (confirmado en #250) — solo queda el piso redondeado "+N
// vendidos" que trae la ficha. Puro, sin Postgres ni fetch, para poder
// probar los 4 cálculos con datos inventados (mismo criterio que
// lib/ml/estimacionVentas.ts/lib/seguimiento/ventas.ts/comparativa.ts).
//
// Relación con lib/ml/estimacionVentas.ts (Investigación/"Analizar",
// NO Seguimiento): ese módulo ya hace una cuenta parecida
// (soldQuantity × multiplicador → ventas/mes) pero la colapsa en un
// solo paso — nunca expone "vendidos estimados" como su propio número
// (Selltrix SÍ lo muestra aparte, "+100 vendidos → 220") — y nunca
// tiene este fallback de antigüedad por id cuando falta date_created
// (ahí, sin date_created, todo es null). Mismos 2 multiplicadores
// (2.2 Full / 1.55 "+N", el mismo origen real: Selltrix), pero
// constantes separadas a propósito — son dos módulos para dos
// pantallas distintas (Investigación vs. Seguimiento), cada uno con su
// propio script de calibración si hace falta ajustarlos por separado
// el día de mañana (ver scripts/calibrar-factor-vendidos.ts, de este
// módulo).
//
// Etiqueta única — toda pantalla que muestre cualquiera de estos 4
// valores SIEMPRE suma esta etiqueta al lado (nunca el número solo,
// nunca mezclado sin marcar con un dato exacto real).
export const ETIQUETA_APROXIMADO = "aprox.";

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const DIAS_POR_MES = 30;

// Selltrix: una publicación Full vende más rápido en la práctica
// (mejor exposición/logística) que lo que el "+N" redondeado sugiere
// — mismo ajuste real que ya usa el mercado, no un número inventado
// acá (mismos valores que lib/ml/estimacionVentas.ts, confirmados con
// el caso real de referencia: "+100 vendidos" Full → 220, exactamente
// 100 × 2.2). "+N" sin Full ajusta menos (1.55) — nunca los dos a la
// vez, son dos señales del mismo fenómeno ("vende más rápido de lo que
// el piso redondeado sugiere"). Un solo lugar para los dos — ajustarlos
// después de correr scripts/calibrar-factor-vendidos.ts es cambiar
// estas 2 líneas, nada más.
export const FACTOR_VENDIDOS_FULL = 2.2;
export const FACTOR_VENDIDOS_SIN_FULL = 1.55;

export type OpcionesVendidosEstimados = {
  // true = `vendidos` ya es sold_quantity real (confirmado por la API
  // o por el JSON incrustado de la ficha, nunca por el piso "+N" de
  // texto) — se usa tal cual, sin multiplicar. false = `vendidos` es
  // el número que acompaña al "+" del piso redondeado ("+100
  // vendidos" → vendidos=100), hay que ajustarlo.
  exacto: boolean;
  esFull: boolean;
};

// 1. Vendidos estimados — issue #251: si el dato es exacto, se usa tal
// cual (nunca se multiplica un número ya real); si es el piso "+N", se
// ajusta por el factor de Full/no-Full de arriba. `null` si no hay
// ningún vendidos que mostrar (nunca 0 inventado).
export function vendidosEstimados(vendidos: number | null, opciones: OpcionesVendidosEstimados): number | null {
  if (vendidos == null || !Number.isFinite(vendidos) || vendidos < 0) return null;
  if (opciones.exacto) return vendidos;
  return vendidos * (opciones.esFull ? FACTOR_VENDIDOS_FULL : FACTOR_VENDIDOS_SIN_FULL);
}

// 2. Antigüedad — tabla de calibración id → fecha, para cuando todavía
// no tenemos date_created real de la lectura de la API (ver el
// hallazgo del punto (a) del issue: hoy ningún seguimiento lo guarda
// — lib/ml/cliente.ts no lo pedía, y la extensión nunca lo manda).
// Interpolación lineal sobre el número que trae el id real de Mercado
// Libre (MCOxxxxxxxxx, MLAxxxxxxxxx, etc.) — Mercado Libre reparte
// estos números de forma aproximadamente secuencial en el tiempo
// dentro de cada país (un id más alto = publicado más tarde), nunca
// garantizado exacto para una publicación puntual, por eso es
// "aproximado" y nunca se usa si hay un date_created real disponible.
//
// SIN PUNTOS TODAVÍA (ver el hallazgo del punto (a), changelog de esta
// rama): nada en la base de hoy guarda date_created, así que no hay
// ningún par real confirmado para calibrar. Agregar acá pares REALES
// únicamente (mlIdExterno real + date_created real que la API de
// Mercado Libre confirmó, nunca un id o fecha inventados) apenas haya
// evidencia — scripts/calibrar-factor-vendidos.ts (de este mismo
// issue) no arma esta tabla (esa calibra los 2 factores de arriba, no
// esto), pero una vez que obtenerFotoItemMl empiece a guardar
// date_created (este PR ya lo agrega del lado del cron), cualquier
// seguimiento con 2+ fotos con date_created real sirve como punto.
// Hacen falta al menos 2 para poder interpolar.
export type PuntoCalibracionId = { id: string; fecha: Date };
export const PUNTOS_CALIBRACION_ID_FECHA: PuntoCalibracionId[] = [];

// Mismo patrón de prefijo+dígitos que PATRON_ID_PRODUCTO_O_ITEM
// (lib/ml/cliente.ts) — nunca duplicado de ahí porque ese patrón
// valida el id completo (para confiar en él antes de llamar a
// Mercado Libre); acá solo hace falta el número para poder comparar
// posiciones entre ids del MISMO país — nunca se compara un MCO
// contra un MLA, cada país tiene su propia numeración.
function numeroYPrefijoDeId(id: string): { prefijo: string; numero: number } | null {
  const m = id.match(/^([A-Z]{3})(\d+)$/);
  if (!m) return null;
  const numero = Number(m[2]);
  return Number.isFinite(numero) ? { prefijo: m[1], numero } : null;
}

// Interpolación (o extrapolación con los 2 puntos más cercanos, si el
// id cae afuera del rango calibrado) entre los puntos del MISMO país
// que `id` — nunca mezcla prefijos distintos (MCO vs. MLA son
// numeraciones independientes de Mercado Libre). `null` con menos de 2
// puntos calibrados de ese país, o si `id`/alguno de los puntos no
// matchea el patrón.
export function antiguedadDiasPorId(id: string, ahora: Date, puntos: PuntoCalibracionId[] = PUNTOS_CALIBRACION_ID_FECHA): number | null {
  const objetivo = numeroYPrefijoDeId(id);
  if (!objetivo) return null;

  const delMismoPais = puntos
    .map((p) => ({ ...numeroYPrefijoDeId(p.id), fecha: p.fecha }))
    .filter((p): p is { prefijo: string; numero: number; fecha: Date } => p.prefijo === objetivo.prefijo)
    .sort((a, b) => a.numero - b.numero);
  if (delMismoPais.length < 2) return null;

  let i = 0;
  while (i < delMismoPais.length - 2 && delMismoPais[i + 1].numero <= objetivo.numero) i++;
  const a = delMismoPais[i];
  const b = delMismoPais[i + 1];
  if (a.numero === b.numero) return null; // 2 puntos calibrados con el mismo número — no hay con qué interpolar

  const fraccion = (objetivo.numero - a.numero) / (b.numero - a.numero);
  const fechaInterpolada = new Date(a.fecha.getTime() + fraccion * (b.fecha.getTime() - a.fecha.getTime()));
  const dias = (ahora.getTime() - fechaInterpolada.getTime()) / MS_POR_DIA;
  return dias > 0 ? dias : null;
}

export type OpcionesAntiguedad = {
  dateCreated: Date | string | null;
  mlId: string | null;
  ahora: Date;
  puntos?: PuntoCalibracionId[];
};

// date_created real siempre gana cuando lo tenemos (nunca se
// interpola un dato real) — la interpolación por id es solo un
// respaldo mientras no lo tengamos.
export function antiguedadDias(opciones: OpcionesAntiguedad): number | null {
  if (opciones.dateCreated != null) {
    const creado = typeof opciones.dateCreated === "string" ? new Date(opciones.dateCreated) : opciones.dateCreated;
    if (!Number.isNaN(creado.getTime())) {
      const dias = (opciones.ahora.getTime() - creado.getTime()) / MS_POR_DIA;
      return dias > 0 ? dias : null;
    }
  }
  if (opciones.mlId == null) return null;
  return antiguedadDiasPorId(opciones.mlId, opciones.ahora, opciones.puntos);
}

// 3. Ventas/mes — issue #251: vendidos estimados × min(30, días) /
// días. El min(30, días) es a propósito, distinto del "× 30 / días"
// simple de lib/ml/estimacionVentas.ts: sin el tope, una publicación
// de pocos días (ej. 5 días, 3 vendidos) proyectaría "3 × 30 / 5 = 18
// ventas/mes" — una extrapolación agresiva sobre casi nada de
// historial real. Con el tope, una publicación de MENOS de un mes
// muestra su ritmo real tal cual (sin inflar), y una de 30+ días sigue
// la misma cuenta de siempre (min(30, días) = 30).
export function ventasMes(vendidosEst: number | null, dias: number | null): number | null {
  if (vendidosEst == null || !Number.isFinite(vendidosEst) || vendidosEst < 0) return null;
  if (dias == null || !Number.isFinite(dias) || dias <= 0) return null;
  return (vendidosEst * Math.min(DIAS_POR_MES, dias)) / dias;
}

// 4. Facturación/mes — ventas/mes × precio actual (nunca el precio de
// cuando se creó la publicación, que no se guarda en ningún lado y de
// todas formas no es lo que Selltrix muestra).
export function facturacionMes(ventasMesValor: number | null, precio: number | null): number | null {
  if (ventasMesValor == null || !Number.isFinite(ventasMesValor)) return null;
  if (precio == null || !Number.isFinite(precio) || precio < 0) return null;
  return ventasMesValor * precio;
}
