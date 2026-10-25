// Issue #195 — "comparativa" entre la foto de hoy y una anterior, para
// enriquecer /panel/investigacion/seguimiento sin volver a llamar a
// Mercado Libre (todo esto ya lo guardó la revisión diaria). Funciones
// puras, sin DB ni fetch, para poder probarlas con fotos de ejemplo.

export type FotoParaComparar = {
  fecha: Date;
  vendidos: number | null;
};

// Diferencia simple — null si falta cualquiera de los dos valores
// (nunca una resta con un null adentro, que daría NaN).
export function calcularDelta(actual: number | string | null, anterior: number | string | null): number | null {
  if (actual == null || anterior == null) return null;
  return Number(actual) - Number(anterior);
}

// "Ventas hoy" — nunca negativo: un vendidos (acumulado histórico de
// Mercado Libre) que BAJA de un día a otro es una inconsistencia de
// datos, no una "venta negativa" real.
export function calcularVentasHoy(actual: number | null, anterior: number | null): number | null {
  const delta = calcularDelta(actual, anterior);
  return delta == null ? null : Math.max(0, delta);
}

export type PeriodoVentas = "parcial" | "diario";

// Issue #244 — "etiqueta honesta": listarSeguimientosConFotosParaVentas
// siempre entrega las DOS fotos más recientes como "ultimaFoto"/
// "fotoAnterior", pero desde que hay 2 fotos al día esas dos pueden
// ser del MISMO día (mañana y tarde de hoy) — ahí calcularVentasHoy()
// da una venta PARCIAL de la jornada en curso, no el cierre de un día
// completo contra el anterior. Nunca se decide comparando por hora o
// por franja: alcanza con la MISMA `fecha` en las dos fotos (mismo
// criterio que usa el propio Postgres para "mismo día", ver
// seguimiento_fotos.fecha en db/schema.ts) — null si falta cualquiera
// de las dos fechas (nunca hay venta que etiquetar sin las dos fotos).
export function periodoVentas(fechaUltima: Date | null, fechaAnterior: Date | null): PeriodoVentas | null {
  if (fechaUltima == null || fechaAnterior == null) return null;
  return fechaUltima.getTime() === fechaAnterior.getTime() ? "parcial" : "diario";
}

const DIAS_MINIMO_VENTANA_MES = 25;
const DIAS_OBJETIVO_VENTANA_MES = 30;
const MS_POR_DIA = 1000 * 60 * 60 * 24;

function diasEntre(masReciente: Date, masVieja: Date): number {
  return Math.round((masReciente.getTime() - masVieja.getTime()) / MS_POR_DIA);
}

// Entre las fotos ANTERIORES a la más reciente (nunca la incluye a
// ELLA misma), la más cercana a 30 días atrás — pero solo si hay
// alguna con AL MENOS 25 días de antigüedad; si no, null (todavía no
// hay suficiente historial — nunca se inventa con una foto más nueva
// que eso nada más para tener "algún" dato).
export function buscarFotoDeHaceUnMes<T extends FotoParaComparar>(fotosAnteriores: T[], fechaMasReciente: Date): T | null {
  const candidatas = fotosAnteriores.filter((f) => diasEntre(fechaMasReciente, f.fecha) >= DIAS_MINIMO_VENTANA_MES);
  if (candidatas.length === 0) return null;
  return candidatas.reduce((mejor, actual) =>
    Math.abs(diasEntre(fechaMasReciente, actual.fecha) - DIAS_OBJETIVO_VENTANA_MES) <
    Math.abs(diasEntre(fechaMasReciente, mejor.fecha) - DIAS_OBJETIVO_VENTANA_MES)
      ? actual
      : mejor
  );
}
