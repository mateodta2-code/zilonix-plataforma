// Optimización · Análisis — por qué cambiaron los ingresos.
//
// Identidad: ingresos = visitas × conversión × ticket, con conversión =
// ventas ÷ visitas y ticket = ingresos ÷ ventas. El cambio de ingresos se
// reparte entre los tres factores con el valor de Shapley exacto: el
// promedio de los 6 órdenes posibles de cambiar un factor a la vez. Así el
// resultado NO depende del orden (una descomposición en cadena sí) y los
// tres aportes suman exactamente R1 − R0.
//
//   φX = ΔX · [ (Y0·Z0 + Y1·Z1) / 3 + (Y0·Z1 + Y1·Z0) / 6 ]
//
// Ceros (nunca un reparto fijo tipo 20/70/10):
// - Un período con 0 ventas: su ticket se toma igual al del otro período
//   (el efecto del ticket es 0) y su conversión es 0.
// - Los dos con 0 ventas: no hay atribución (null).
// - Un período con 0 visitas pero con ventas: la conversión no existe y la
//   identidad no cierra; no se inventa un reparto (null).
//
// Puro. Montos como string decimal de 2 decimales (centavos con bigint por
// dentro, como resumenTienda.ts); los aportes se redondean a centavos y el
// residuo de redondeo se lo lleva el factor de mayor valor absoluto, para
// que la suma sea exacta.

import { aCentavos, desdeCentavos } from "@/lib/finanzas/utilidad-venta";

export type PeriodoAtribucion = { visitas: number; ventas: number; ingresos: string };

export type FactorIngresos = "visitas" | "conversion" | "ticket";

export type Aportes = Record<FactorIngresos, string>;

export type Atribucion = {
  ingresosAnterior: string;
  ingresosActual: string;
  cambio: string; // R1 − R0
  // Valores de cada factor antes y ahora. Conversión como fracción (0.05 = 5 %).
  visitas: { antes: number; ahora: number };
  conversion: { antes: number; ahora: number };
  ticket: { antes: string; ahora: string }; // ticket tomado del otro período si no hubo ventas
  aportes: Aportes; // φV, φC, φT; suman exactamente `cambio`
};

export const MINIMO_VENTAS_MUESTRA = 3;
export const MINIMO_VISITAS_MUESTRA = 50;
// Publicaciones por llamada a ML (vive aquí: un archivo "use server" solo puede exportar funciones async).
export const PUBLICACIONES_POR_TANDA = 3;
export const ETIQUETA_POCAS_VENTAS = "Pocas ventas para concluir";

const CERO = BigInt(0);

// ≥ 3 ventas o ≥ 50 visitas en algún período.
export function muestraSuficiente(ant: PeriodoAtribucion, act: PeriodoAtribucion): boolean {
  return [ant, act].some((p) => p.ventas >= MINIMO_VENTAS_MUESTRA || p.visitas >= MINIMO_VISITAS_MUESTRA);
}

// Shapley de un factor X con los otros dos (Y, Z), cada uno [antes, ahora].
function shapley(x: [number, number], y: [number, number], z: [number, number]): number {
  return (x[1] - x[0]) * ((y[0] * z[0] + y[1] * z[1]) / 3 + (y[0] * z[1] + y[1] * z[0]) / 6);
}

// Reparto crudo (en la unidad de los factores) — expuesto para el test de permutación.
export function shapleyTresFactores(v: [number, number], c: [number, number], t: [number, number]): [number, number, number] {
  return [shapley(v, c, t), shapley(c, v, t), shapley(t, v, c)];
}

function esEnteroNoNegativo(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export function atribuir(ant: PeriodoAtribucion, act: PeriodoAtribucion): Atribucion | null {
  if (![ant.visitas, ant.ventas, act.visitas, act.ventas].every(esEnteroNoNegativo)) return null;
  if (ant.ventas === 0 && act.ventas === 0) return null;
  // Con ventas pero sin visitas la conversión no existe: no se inventa.
  if ((ant.ventas > 0 && ant.visitas === 0) || (act.ventas > 0 && act.visitas === 0)) return null;

  const ingresos0 = aCentavos(ant.ingresos);
  const ingresos1 = aCentavos(act.ingresos);
  const cambio = ingresos1 - ingresos0;

  const ticketCentavos = (ingresos: bigint, ventas: number): number => Number(ingresos) / ventas;
  const t0 = ant.ventas > 0 ? ticketCentavos(ingresos0, ant.ventas) : ticketCentavos(ingresos1, act.ventas);
  const t1 = act.ventas > 0 ? ticketCentavos(ingresos1, act.ventas) : t0;
  const c0 = ant.visitas > 0 ? ant.ventas / ant.visitas : 0;
  const c1 = act.visitas > 0 ? act.ventas / act.visitas : 0;

  const [fv, fc, ft] = shapleyTresFactores([ant.visitas, act.visitas], [c0, c1], [t0, t1]);
  const redondeados = [fv, fc, ft].map((f) => BigInt(Math.round(f)));
  // El residuo de redondeo (a lo sumo unos centavos) va al factor más grande.
  const residuo = cambio - redondeados.reduce((a, b) => a + b, CERO);
  if (residuo !== CERO) {
    let mayor = 0;
    for (let i = 1; i < 3; i++) {
      const a = redondeados[i] < CERO ? -redondeados[i] : redondeados[i];
      const m = redondeados[mayor] < CERO ? -redondeados[mayor] : redondeados[mayor];
      if (a > m) mayor = i;
    }
    redondeados[mayor] += residuo;
  }

  return {
    ingresosAnterior: desdeCentavos(ingresos0),
    ingresosActual: desdeCentavos(ingresos1),
    cambio: desdeCentavos(cambio),
    visitas: { antes: ant.visitas, ahora: act.visitas },
    conversion: { antes: c0, ahora: c1 },
    ticket: { antes: desdeCentavos(BigInt(Math.round(t0))), ahora: desdeCentavos(BigInt(Math.round(t1))) },
    aportes: { visitas: desdeCentavos(redondeados[0]), conversion: desdeCentavos(redondeados[1]), ticket: desdeCentavos(redondeados[2]) },
  };
}

const ROTULO_FACTOR: Record<FactorIngresos, string> = { visitas: "tráfico", conversion: "conversión", ticket: "ticket" };

export function rotuloFactor(f: FactorIngresos): string {
  return ROTULO_FACTOR[f];
}

// El factor de mayor peso EN LA DIRECCIÓN del cambio: si los ingresos
// bajaron, el aporte más negativo; si subieron, el más positivo.
export function factorPrincipal(aportes: Aportes, cambio: string): FactorIngresos | null {
  const sentido = aCentavos(cambio);
  if (sentido === CERO) return null;
  let mejor: FactorIngresos | null = null;
  let valorMejor = CERO;
  for (const f of ["visitas", "conversion", "ticket"] as const) {
    const v = aCentavos(aportes[f]);
    const enSentido = sentido > CERO ? v : -v;
    if (enSentido > valorMejor) {
      valorMejor = enSentido;
      mejor = f;
    }
  }
  return mejor;
}

const ETIQUETAS_BAJA: Record<FactorIngresos, string> = { visitas: "Caída por tráfico", conversion: "Caída por conversión", ticket: "Caída por ticket" };
const ETIQUETAS_SUBE: Record<FactorIngresos, string> = { visitas: "Impulso por visibilidad", conversion: "Mejora en cierre", ticket: "Mejora por ticket" };

// Sin muestra suficiente: «Pocas ventas para concluir» y sin reparto.
export function etiquetaCambio(aportes: Aportes, cambio: string, suficiente: boolean): string {
  if (!suficiente) return ETIQUETA_POCAS_VENTAS;
  const f = factorPrincipal(aportes, cambio);
  if (!f) return "Sin cambio";
  return aCentavos(cambio) < CERO ? ETIQUETAS_BAJA[f] : ETIQUETAS_SUBE[f];
}
