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
// Issue #262 ("Aproximados estilo Selltrix en los 3 lugares") — UNA
// SOLA FUENTE para los 2 factores y la tabla de calibración id→fecha,
// compartida con el popup de la extensión (extension/lectores/aproximados.js,
// que porta estas mismas 4 funciones a JS plano): antes vivían como
// constantes TS acá y, aparte, el popup de la extensión no tenía
// ninguna forma de usarlas — dos lugares mostrando "aproximados" con
// fórmulas que podían desalinearse sin que nada lo avisara.
// scripts/empaquetar-extension.js regenera extension/calibracion-aproximados.js
// a partir de ESTE MISMO archivo antes de armar el ZIP — nunca se edita
// ese archivo generado a mano. lib/seguimiento/calibracion-aproximados.test.ts
// prueba que la copia de la extensión nunca queda desincronizada.
import calibracion from "./calibracion-aproximados.json";

// Etiqueta única — toda pantalla que muestre cualquiera de estos 4
// valores SIEMPRE suma esta etiqueta al lado (nunca el número solo,
// nunca mezclado sin marcar con un dato exacto real).
export const ETIQUETA_APROXIMADO = "aprox.";

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const DIAS_POR_MES = 30;
// Issue #262 (revisión de Pablo, punto menor) — tope real de
// extrapolación en antiguedadDiasPorId (abajo): nunca más de 90 días
// más allá de la fecha del punto calibrado más cercano al id buscado.
const LIMITE_EXTRAPOLACION_DIAS = 90;

// Selltrix: una publicación Full vende más rápido en la práctica
// (mejor exposición/logística) que lo que el "+N" redondeado sugiere
// — mismo ajuste real que ya usa el mercado, no un número inventado
// acá (mismos valores que lib/ml/estimacionVentas.ts, confirmados con
// el caso real de referencia: "+100 vendidos" Full → 220, exactamente
// 100 × 2.2). "+N" sin Full ajusta menos (1.55) — nunca los dos a la
// vez, son dos señales del mismo fenómeno ("vende más rápido de lo que
// el piso redondeado sugiere"). Salen de calibracion-aproximados.json
// (arriba) — ajustarlos después de correr scripts/calibrar-factor-vendidos.ts
// es cambiar ese JSON, nada más (y volver a correr `npm run extension:zip`
// para que la extensión se empaquete con el valor nuevo).
export const FACTOR_VENDIDOS_FULL: number = calibracion.factorVendidosFull;
export const FACTOR_VENDIDOS_SIN_FULL: number = calibracion.factorVendidosSinFull;

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
// PUNTOS DE SELLTRIX + UNA PROPIA CONFIRMADA (issue #251): correr
// `scripts/generar-calibracion-id-fecha.ts` (issue #262, solo lectura,
// saca pares reales de `seguimiento_fotos.publicaciones.fechaCreacion`
// y de `productos_ml.resultado[].itemId`+`publicadoTs`) contra staging
// dio 0 pares confirmados todavía — el cron de date_created (PR #261)
// recién empieza a acumular (ver el changelog de esta rama). Mientras
// tanto, estos 9 puntos salen del panel de Selltrix (el mismo
// competidor que YA estima antigüedad por id, igual que acá): Mateo
// sacó la "antigüedad" que esa pantalla muestra para 5 ids "item" y 4
// ids de catálogo "product", y la fecha de cada uno se derivó con la
// MISMA fórmula que usa Selltrix (días = vendidosEst × 30 /
// (facturaciónMes / precio) — su propia pantalla ya hace esa cuenta).
// Son referenciales, no un date_created confirmado por la API — por
// eso siguen siendo "aproximado" (ETIQUETA_APROXIMADO), igual que el
// resto de esta tabla.
// Un punto SÍ es un dato real: MCO2275587337 es una publicación propia
// de Zilonix cuya primera venta real (14 oct 2026, Mis Ventas de
// Mercado Libre) cuadra con la fecha que da Selltrix para ese id —
// ancla el resto de la serie "item" contra un punto no inferido.
// Publicaciones INTERNACIONALES (envío desde China, ej. MCO4106040446
// ≈ 2026-06-27 según Selltrix) usan OTRA serie de numeración de MCO —
// nunca entran acá como "item": mezclar las dos series tuerce la
// interpolación para TODAS las publicaciones domésticas del mismo
// rango. Esos ids se dejan afuera de PUNTOS_CALIBRACION_ID_FECHA a
// propósito; con el tope de 90 días de extrapolación
// (LIMITE_EXTRAPOLACION_DIAS, abajo) terminan en "Sin dato" en vez de
// una antigüedad inventada.
// Reemplazar por pares 100% confirmados por la API en cuanto
// `scripts/generar-calibracion-id-fecha.ts` tenga suficientes (ver el
// changelog de esta rama) — hasta entonces, agregar acá solo lo que
// venga de una fuente real (Selltrix o una venta/publicación propia
// confirmada), nunca un id o fecha inventados. Hacen falta al menos 2
// del MISMO tipo (item/product) y MISMO país para poder interpolar
// siquiera un poco.
//
// Corrección de Pablo (revisión sobre 0e22594) — `tipo` ("item" o
// "product", el mismo recurso_ml real del seguimiento, nunca "seller":
// esto es solo para producto) suma al punto: un id de ITEM
// (publicación puntual, MCOxxxxxxxxx) y uno de PRODUCT (catálogo,
// /p/MCOxxxxxxxxx) son dos numeraciones INDEPENDIENTES de Mercado
// Libre que pueden compartir el mismo prefijo de país y hasta rangos
// de números parecidos sin que eso signifique nada — interpolar un id
// de item contra puntos de product (o viceversa) daría una antigüedad
// sin sentido, aunque el país coincidiera.
export type TipoIdMl = "item" | "product";
export type PuntoCalibracionId = { id: string; tipo: TipoIdMl; fecha: Date };
type PuntoCalibracionJson = { id: string; tipo: TipoIdMl; fecha: string };
export const PUNTOS_CALIBRACION_ID_FECHA: PuntoCalibracionId[] = (calibracion.puntos as PuntoCalibracionJson[]).map((p) => ({
  id: p.id,
  tipo: p.tipo,
  fecha: new Date(p.fecha),
}));

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
// Y del MISMO tipo (item vs. product, corrección de Pablo arriba) que
// `id` — nunca mezcla prefijos ni tipos distintos. `null` con menos de
// 2 puntos calibrados de ese país+tipo, o si `id`/alguno de los puntos
// no matchea el patrón.
export function antiguedadDiasPorId(
  id: string,
  tipo: TipoIdMl,
  ahora: Date,
  puntos: PuntoCalibracionId[] = PUNTOS_CALIBRACION_ID_FECHA
): number | null {
  const objetivo = numeroYPrefijoDeId(id);
  if (!objetivo) return null;

  const delMismoPaisYTipo = puntos
    .filter((p) => p.tipo === tipo)
    .map((p) => ({ ...numeroYPrefijoDeId(p.id), fecha: p.fecha }))
    .filter((p): p is { prefijo: string; numero: number; fecha: Date } => p.prefijo === objetivo.prefijo)
    .sort((a, b) => a.numero - b.numero);
  if (delMismoPaisYTipo.length < 2) return null;

  let i = 0;
  while (i < delMismoPaisYTipo.length - 2 && delMismoPaisYTipo[i + 1].numero <= objetivo.numero) i++;
  const a = delMismoPaisYTipo[i];
  const b = delMismoPaisYTipo[i + 1];
  if (a.numero === b.numero) return null; // 2 puntos calibrados con el mismo número — no hay con qué interpolar

  const fraccion = (objetivo.numero - a.numero) / (b.numero - a.numero);
  const fechaInterpolada = new Date(a.fecha.getTime() + fraccion * (b.fecha.getTime() - a.fecha.getTime()));

  // Corrección de Pablo (revisión, punto menor) — `fraccion` fuera de
  // [0,1] significa que `id` cae AFUERA del rango calibrado: esto
  // EXTRAPOLA con la pendiente de los 2 puntos más cercanos, confiable
  // cerca del borde, cada vez menos a medida que el id se aleja (la
  // numeración de Mercado Libre nunca es perfectamente lineal en el
  // tiempo). Tope real: nunca más de LIMITE_EXTRAPOLACION_DIAS (90)
  // más allá de la fecha del punto calibrado más cercano al id
  // buscado — más lejos que eso, "Sin dato" (null) es más honesto que
  // una antigüedad sin ningún punto real cerca que la respalde.
  if (fraccion > 1) {
    const diasMasAllaDelUltimoPunto = (fechaInterpolada.getTime() - b.fecha.getTime()) / MS_POR_DIA;
    if (diasMasAllaDelUltimoPunto > LIMITE_EXTRAPOLACION_DIAS) return null;
  } else if (fraccion < 0) {
    const diasAntesDelPrimerPunto = (a.fecha.getTime() - fechaInterpolada.getTime()) / MS_POR_DIA;
    if (diasAntesDelPrimerPunto > LIMITE_EXTRAPOLACION_DIAS) return null;
  }

  const dias = (ahora.getTime() - fechaInterpolada.getTime()) / MS_POR_DIA;
  return dias > 0 ? dias : null;
}

export type OpcionesAntiguedad = {
  dateCreated: Date | string | null;
  mlId: string | null;
  // Corrección de Pablo — el recurso_ml real del seguimiento (nunca
  // "seller": esto es solo para producto), para saber contra qué tipo
  // de punto de calibración interpolar (antiguedadDiasPorId, arriba).
  // Cualquier valor que no sea "item"/"product" (incluido "seller" o
  // null) nunca interpola — no hay un concepto de antigüedad por id
  // para una tienda.
  recursoMl: "item" | "product" | "seller" | null;
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
  if (opciones.recursoMl !== "item" && opciones.recursoMl !== "product") return null;
  return antiguedadDiasPorId(opciones.mlId, opciones.recursoMl, opciones.ahora, opciones.puntos);
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
