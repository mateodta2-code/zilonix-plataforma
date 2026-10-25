// Issue #201 (apoya #197) — decisión real de Sharel: "Analizar" nunca
// muestra un 0 cuando en realidad falta el dato (eso se lee como "este
// producto no vende nada", cuando lo real es "no tenemos ninguna señal
// todavía") — en vez de eso, se muestra una ESTIMACIÓN, con la
// etiqueta de abajo bien visible para que nunca se confunda con un
// número confirmado real. Mismo criterio de velocidad de venta que usa
// Selltrix (público, no inventado acá): `sold_quantity` acumulado
// desde que se creó la publicación, llevado a "por mes" con un
// multiplicador según el tipo real de publicación.
//
// Puro, sin Postgres ni fetch — mismo criterio que
// lib/seguimiento/ventas.ts: nunca inventa un dato que falta (null si
// soldQuantity o dateCreated no vienen reales), nunca negativo.
//
// NO inventa visitas: Mercado Libre no deja ver el conteo real de
// visitas de una publicación ajena por la API pública/de catálogo que
// ya usa este repo (lib/ml/cliente.ts) — estimar un número de visitas
// sin ningún dato real de respaldo sería inventar, no estimar. Si algún
// día se confirma un endpoint real que las devuelva, ese dato se
// agrega aparte — nunca una fórmula inventada acá.

// Selltrix: una publicación Full vende más rápido en la práctica
// (mejor exposición/logística) — el mismo ajuste que ya se ve en el
// mercado real, no un número arbitrario. "+N" es la insignia que
// Mercado Libre muestra en vendedores de alto volumen — también ajusta
// al alza, pero menos que Full. Nunca los dos a la vez (son dos
// señales distintas del mismo fenómeno — "vende más rápido de lo que
// el acumulado crudo sugiere" — no se combinan, se usa la más fuerte).
const MULTIPLICADOR_FULL = 2.2;
const MULTIPLICADOR_MAS_N = 1.55;
const DIAS_POR_MES = 30;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

export type OpcionesVentasMesEst = {
  esFull?: boolean;
  etiquetaMasN?: boolean;
};

// Etiqueta única para marcar cualquier cifra que salga de este archivo
// — toda pantalla que muestre ventasMesEst()/facturacionEst() tiene que
// mostrarla junto al número (nunca el número solo, nunca como si fuera
// un dato confirmado real).
export const ETIQUETA_ESTIMADO = "Estimado";

// `dateCreated` es la fecha real de creación de la publicación en
// Mercado Libre (`date_created`), nunca la fecha en que Zilonix empezó
// a seguirla — son cosas distintas: una publicación puede llevar meses
// en Mercado Libre antes de que alguien la agregue a seguimiento acá.
export function ventasMesEst(soldQuantity: number | null, dateCreated: Date | string | null, opciones: OpcionesVentasMesEst = {}): number | null {
  if (soldQuantity == null || soldQuantity < 0) return null;
  if (dateCreated == null) return null;

  const creado = typeof dateCreated === "string" ? new Date(dateCreated) : dateCreated;
  if (Number.isNaN(creado.getTime())) return null;

  const diasTranscurridos = Math.max(1, Math.floor((Date.now() - creado.getTime()) / UN_DIA_MS));
  const multiplicador = opciones.esFull ? MULTIPLICADOR_FULL : opciones.etiquetaMasN ? MULTIPLICADOR_MAS_N : 1;
  const vendidosAjustados = soldQuantity * multiplicador;

  return (vendidosAjustados * DIAS_POR_MES) / diasTranscurridos;
}

// Facturación estimada = precio real de la publicación × la
// estimación de arriba — nunca una resta/comparación contra otra
// foto, esa cuenta la hace lib/seguimiento/ventas.ts con datos 100%
// reales.
export function facturacionEst(precio: number | null, ventasMes: number | null): number | null {
  if (precio == null || precio < 0) return null;
  if (ventasMes == null) return null;
  return precio * ventasMes;
}
