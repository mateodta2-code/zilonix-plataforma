import { aCentavos, desdeCentavos } from "./utilidad-venta";

// Inicio (Sharel y el equipo, 13-nov; #125/#126) — avance de la meta
// mensual de utilidad DESPUÉS de publicidad. Puro: sin base ni reloj.
// Plata en centavos BigInt; los porcentajes con 1 decimal como texto.

export type AvanceMeta = {
  meta: string;
  logrado: string;
  // logrado ÷ meta × 100, 1 decimal ("54.3"). Puede pasar de 100 o ser
  // negativo; null si la meta es 0.
  porcentaje: string | null;
  // Para la barra: 0 a 100.
  porcentajeBarra: number;
  // meta − logrado, nunca negativo ("0.00" si ya se cumplió).
  faltante: string;
  diasTranscurridos: number;
  diasRestantes: number;
  // Utilidad por día que se lleva (logrado ÷ días transcurridos).
  ritmoActual: string;
  // Lo que hay que hacer por día en lo que queda del mes; null si ya
  // se cumplió o no quedan días.
  ritmoNecesario: string | null;
  // Regla de tres: ritmo actual × días del mes (#143).
  proyeccion: string;
};

function dividir(centavos: bigint, divisor: bigint): bigint {
  const negativo = centavos < BigInt(0);
  const abs = negativo ? -centavos : centavos;
  const q = (abs * BigInt(2) + divisor) / (divisor * BigInt(2));
  return negativo ? -q : q;
}

export function avanceMeta(entrada: { meta: string; logrado: string; diasTranscurridos: number; diasMes: number }): AvanceMeta {
  const meta = aCentavos(entrada.meta);
  const logrado = aCentavos(entrada.logrado);
  const transcurridos = Math.max(1, entrada.diasTranscurridos);
  const restantes = Math.max(0, entrada.diasMes - entrada.diasTranscurridos);

  let porcentaje: string | null = null;
  let barra = 0;
  if (meta > BigInt(0)) {
    const decimas = dividir(logrado * BigInt(1000), meta);
    const neg = decimas < BigInt(0);
    const abs = neg ? -decimas : decimas;
    porcentaje = `${neg ? "-" : ""}${abs / BigInt(10)}.${abs % BigInt(10)}`;
    barra = neg ? 0 : Math.min(100, Number(abs / BigInt(10)));
  }

  const faltanteCent = meta - logrado > BigInt(0) ? meta - logrado : BigInt(0);
  const ritmoActual = dividir(logrado, BigInt(transcurridos));
  return {
    meta: desdeCentavos(meta),
    logrado: desdeCentavos(logrado),
    porcentaje,
    porcentajeBarra: barra,
    faltante: desdeCentavos(faltanteCent),
    diasTranscurridos: entrada.diasTranscurridos,
    diasRestantes: restantes,
    ritmoActual: desdeCentavos(ritmoActual),
    ritmoNecesario: faltanteCent > BigInt(0) && restantes > 0 ? desdeCentavos(dividir(faltanteCent, BigInt(restantes))) : null,
    proyeccion: desdeCentavos(ritmoActual * BigInt(entrada.diasMes)),
  };
}

// Días del mes de una fecha AAAA-MM-DD.
export function diasDelMes(fecha: string): number {
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}
