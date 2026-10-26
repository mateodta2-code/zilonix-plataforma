// Issue #251, puntos 8/10/12/14 — "vendidos estimados" a partir de la
// CAÍDA de inventario entre dos lecturas de la página (nunca del
// sold_quantity de la API — Mercado Libre no lo deja ver de forma
// confiable para un competidor). Puro, sin Postgres ni fetch (el único
// import, rangoDiaBogota, es también puro — pura cuenta de huso
// horario, sin tocar la base), para poder probar reposición/
// cobertura/una sola lectura con datos inventados — mismo criterio
// que lib/seguimiento/comparativa.ts y ventas.ts.
import { fechaDiaBogota } from "@/lib/filtros-listado";

export type LecturaProducto = {
  fecha: Date;
  // Mercado Libre nunca deja ver el disponible exacto de un
  // competidor por la API (issue #251) — esto es lo que la extensión
  // leyó del selector de cantidad de la ficha ese día, o null si esa
  // foto no tiene lectura de página.
  inventario: number | null;
  // Issue #251 (corrección de Pablo, punto 9) — si el inventario de
  // ESTA lectura viene aproximado (seguimiento_fotos.inventarioAproximado),
  // compararProductoDiaADia nunca lo resta contra la otra punta: un
  // "+10 disponibles" no es un número exacto, restar dos aproximados
  // (o uno aproximado contra uno exacto) podría inventar una caída que
  // nunca pasó.
  aproximado: boolean;
  // "+N vendidos" de la ficha — piso redondeado, respaldo cuando no
  // hay inventario CONFIABLE para comparar (nunca se usa si el
  // inventario SÍ está disponible y es exacto en las dos puntas: la
  // caída de inventario es la señal primaria, pedida explícita por el
  // issue).
  vendidosTexto: number | null;
};

export type ComparativaProducto = {
  // null = ninguna de las dos señales (inventario o "+N vendidos")
  // alcanzó para comparar — nunca un 0 inventado en su lugar.
  ventasEstimadas: number | null;
  // El inventario subió respecto a la lectura anterior — se interpreta
  // como reposición de stock, nunca como "venta negativa".
  reposicion: boolean;
  fechaAnterior: Date;
  fechaActual: Date;
  etiqueta: "estimado";
};

// Comparación entre DOS lecturas consecutivas — inventario primero,
// "+N vendidos" como respaldo solo si falta cualquiera de los dos
// inventarios (issue #251, punto 8: "caída de inventario ... y el
// cambio del texto '+N vendidos' como respaldo").
export function compararProductoDiaADia(anterior: LecturaProducto, actual: LecturaProducto): ComparativaProducto {
  const base = { fechaAnterior: anterior.fecha, fechaActual: actual.fecha, etiqueta: "estimado" as const };

  // Issue #251 (corrección de Pablo, punto 9) — la caída de inventario
  // solo es una señal confiable cuando NINGUNA de las dos puntas es
  // aproximada: un "+10 disponibles" (inventarioAproximado) no es un
  // número exacto, restarlo (contra otro aproximado o contra uno
  // exacto) podría inventar una caída que nunca pasó. Con cualquiera
  // de las dos puntas aproximada, se cae al respaldo de "+N vendidos"
  // (si existe) o a null — nunca se adivina.
  if (anterior.inventario != null && actual.inventario != null && !anterior.aproximado && !actual.aproximado) {
    const caida = anterior.inventario - actual.inventario;
    if (caida < 0) return { ...base, ventasEstimadas: 0, reposicion: true };
    return { ...base, ventasEstimadas: caida, reposicion: false };
  }

  if (anterior.vendidosTexto != null && actual.vendidosTexto != null) {
    const diferencia = actual.vendidosTexto - anterior.vendidosTexto;
    // El piso de "+N vendidos" es un contador acumulado — nunca debería
    // bajar. Si baja, es un dato dudoso (reinicio del lado de ML,
    // lecturas fuera de orden) — se trata igual que "sin dato", nunca
    // una venta negativa fabricada.
    if (diferencia < 0) return { ...base, ventasEstimadas: null, reposicion: false };
    return { ...base, ventasEstimadas: diferencia, reposicion: false };
  }

  return { ...base, ventasEstimadas: null, reposicion: false };
}

export type ResumenPeriodoVentas = {
  ventasEstimadas: number;
  promedioPorDia: number;
  diasConLectura: number;
  diasPeriodo: number;
  etiqueta: "estimado";
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function redondear1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Issue #251 (revisión de Pablo) — mismo criterio que
// seguimiento_fotos.fecha: medianoche de BOGOTÁ, no de UTC (una
// persona que lee una ficha de noche en Colombia ya está en el día
// siguiente en UTC) — trunca `ahora` ANTES de calcular la ventana,
// para que el resultado no cambie según la hora real del día en que
// se consulte. Corrección de Pablo — `fechaDiaBogota` (no
// `rangoDiaBogota().inicio`, que da el instante real de la medianoche
// de Bogotá, 05:00 UTC): esta cuenta tiene que coincidir dígito a
// dígito con cómo se guardan las fechas en `seguimiento_fotos.fecha`
// (00:00Z del día de Bogotá), o las lecturas nunca calzarían con las
// fotos reales al comparar fechas.
function hoyBogota(ahora: Date): Date {
  return fechaDiaBogota(ahora);
}

// Issue #251 (corrección de Pablo, punto 9) — "Ayer vs hoy" es un
// caso aparte, no el caso general de resumenPeriodoVentas(lecturas, 1,
// ahora): acá SOLO cuenta si existe, de verdad, una foto fechada
// exactamente HOY (Bogotá) y otra fechada exactamente AYER, las DOS
// con inventario — nunca "las dos lecturas más recientes que hubiera"
// (que podrían ser de hace varios días si el cron se saltó alguno), y
// nunca el respaldo de "+N vendidos" para esta tarjeta puntual (ese
// respaldo sigue existiendo dentro de compararProductoDiaADia para el
// caso general de resumenPeriodoVentas). `null` = "Falta lectura de
// hoy o de ayer", un mensaje DISTINTO de "Falta otra lectura para
// comparar" (que sí puede pasar incluso con las dos fechas presentes,
// si compararProductoDiaADia no logra comparar nada real — ver el
// llamador en [id]/page.tsx).
export function calcularComparativaAyerHoy(lecturas: LecturaProducto[], ahora: Date): ComparativaProducto | null {
  const hoy = hoyBogota(ahora);
  const ayer = new Date(hoy.getTime() - MS_POR_DIA);
  const lecturaHoy = lecturas.find((l) => l.fecha.getTime() === hoy.getTime());
  const lecturaAyer = lecturas.find((l) => l.fecha.getTime() === ayer.getTime());
  if (!lecturaHoy || !lecturaAyer || lecturaHoy.inventario == null || lecturaAyer.inventario == null) return null;
  return compararProductoDiaADia(lecturaAyer, lecturaHoy);
}

// Ventas estimadas en una ventana de `diasPeriodo` días — suma de las
// caídas de inventario entre lecturas CONSECUTIVAS dentro de la
// ventana (nunca contando reposiciones), con el promedio por día del
// período completo (no solo de los días con lectura) y la cobertura
// real ("5 de 7 días con lectura", issue #251 punto 12). `null` si hay
// menos de 2 lecturas usables en la ventana — "falta otra lectura para
// comparar", nunca un 0 inventado.
export function resumenPeriodoVentas(lecturas: LecturaProducto[], diasPeriodo: number, ahora: Date): ResumenPeriodoVentas | null {
  const hoy = hoyBogota(ahora);
  // Issue #251 (corrección de Pablo, punto 9) — "7 días calendario
  // CONTANDO hoy": [hoy-(diasPeriodo-1), hoy] son exactamente
  // diasPeriodo días (hoy, hoy-1, ..., hoy-(diasPeriodo-1)). Antes
  // `desde = hoy - diasPeriodo` dejaba la ventana en diasPeriodo+1
  // días (ej. 8 días reales para "los últimos 7") — un día de más que
  // nadie pidió.
  const desde = new Date(hoy.getTime() - (diasPeriodo - 1) * MS_POR_DIA);
  const enVentana = lecturas
    .filter((l) => l.fecha >= desde && l.fecha <= hoy && (l.inventario != null || l.vendidosTexto != null))
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  if (enVentana.length < 2) return null;

  let ventasEstimadas = 0;
  let algunaComparacionReal = false;
  for (let i = 1; i < enVentana.length; i++) {
    const comparativa = compararProductoDiaADia(enVentana[i - 1], enVentana[i]);
    if (comparativa.ventasEstimadas != null) {
      ventasEstimadas += comparativa.ventasEstimadas;
      algunaComparacionReal = true;
    }
  }
  // Las lecturas existen, pero ninguna CONSECUTIVA pudo compararse de
  // verdad (ej. una tiene solo inventario y la siguiente solo "+N
  // vendidos", sin ningún par compatible) — sigue siendo "falta otra
  // lectura para comparar", nunca un 0 a medias.
  if (!algunaComparacionReal) return null;

  return {
    ventasEstimadas,
    promedioPorDia: redondear1(ventasEstimadas / diasPeriodo),
    diasConLectura: enVentana.length,
    diasPeriodo,
    etiqueta: "estimado",
  };
}

export type LecturaConteo = { fecha: Date; valor: number | null };

export type ResumenPeriodoConteo = {
  diferencia: number;
  promedioPorDia: number;
  diasConLectura: number;
  diasPeriodo: number;
  etiqueta: "estimado";
};

// Issue #251, punto 13 — "mismo esquema para el total de
// publicaciones". A diferencia de las ventas (que nunca deben restarse
// de punta a punta porque una reposición a mitad de camino esconde
// ventas reales), el total de publicaciones de una tienda es un
// conteo que puede subir o bajar libremente — el cambio del período
// completo es, matemáticamente, la lectura más vieja contra la más
// nueva de la ventana (la suma de los cambios día a día entre medio
// siempre da lo mismo, pero sin tener que sumarlos uno por uno).
export function resumenPeriodoConteo(lecturas: LecturaConteo[], diasPeriodo: number, ahora: Date): ResumenPeriodoConteo | null {
  const hoy = hoyBogota(ahora);
  // Issue #251 (corrección de Pablo, punto 9) — mismo ajuste de
  // resumenPeriodoVentas, arriba: diasPeriodo días calendario
  // contando hoy, nunca diasPeriodo+1.
  const desde = new Date(hoy.getTime() - (diasPeriodo - 1) * MS_POR_DIA);
  const enVentana = lecturas
    .filter((l) => l.fecha >= desde && l.fecha <= hoy && l.valor != null)
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  if (enVentana.length < 2) return null;

  const primera = enVentana[0].valor as number;
  const ultima = enVentana[enVentana.length - 1].valor as number;
  const diferencia = ultima - primera;

  return {
    diferencia,
    promedioPorDia: redondear1(diferencia / diasPeriodo),
    diasConLectura: enVentana.length,
    diasPeriodo,
    etiqueta: "estimado",
  };
}

// Issue #251, punto 10 — "si no hay lectura de la página en las
// últimas 24h, mostrar 'Actualiza hoy para ver cuánto vendieron'".
// Sin columna "fuente" (decisión de Mateo, sin migración): esta
// función nunca intenta distinguir CUÁL fuente llenó un campo, solo
// si TODAVÍA falta el dato que la página aportaría — honesto con lo
// que se puede saber hoy, sin inventar una certeza que no existe.
// Granularidad de DÍA calendario (no de 24h exactas, mismo criterio
// que el resto de seguimiento_fotos.fecha) — una simplificación
// documentada, no un error: el aviso puede aparecer un poco antes o
// después de las 24h exactas según la hora del día, nunca al revés de
// lo que de verdad pasó (sin lectura hoy = sin lectura, seguro).
// Nunca aplica a un seguimiento propio (esCompetidor=false): esos ya
// tienen datos reales por la API, no dependen de esta extensión.
export function necesitaLecturaDePagina(params: {
  esCompetidor: boolean;
  tipo: "producto" | "tienda";
  ultimaFoto: {
    fecha: Date;
    inventarioDisponible: number | null;
    vendidos: number | null;
    publicaciones: { total: number | null; visibles: unknown[] } | null;
  } | null;
  ahora: Date;
}): boolean {
  if (!params.esCompetidor) return false;
  const hoy = hoyBogota(params.ahora);
  if (!params.ultimaFoto || params.ultimaFoto.fecha.getTime() !== hoy.getTime()) return true;
  if (params.tipo === "tienda") return params.ultimaFoto.publicaciones == null || params.ultimaFoto.publicaciones.total == null;
  return params.ultimaFoto.inventarioDisponible == null && params.ultimaFoto.vendidos == null;
}
