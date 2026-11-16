// Historial de cambios de presupuesto diario y ROAS objetivo. Lógica
// pura: compara la lectura guardada con la nueva que trajo la sync.

export type CampoCambio = "presupuesto_diario" | "roas_objetivo";

export type ValoresCampana = {
  presupuestoDiario: string | null;
  roasObjetivo: string | null;
};

export type CambioDetectado = {
  campo: CampoCambio;
  valorAnterior: string | null;
  valorNuevo: string | null;
};

// Compara en centésimas: Postgres devuelve "50000.00" y Mercado Libre
// puede mandar "50000". Un texto que no es número se trata como sin dato.
function centesimas(valor: string | null): bigint | null {
  if (valor === null) return null;
  const limpio = valor.trim();
  const partes = /^(-?)(\d+)(?:\.(\d+))?$/.exec(limpio);
  if (!partes) return null;
  const [, signo, entero, decimales = ""] = partes;
  const total = BigInt(entero) * BigInt(100) + BigInt((decimales + "00").slice(0, 2));
  return signo === "-" ? -total : total;
}

function igual(a: string | null, b: string | null): boolean {
  return centesimas(a) === centesimas(b);
}

// null si no había lectura anterior (campaña nueva): no hay "antes" que
// mostrar. Si cambió de un número a sin dato (o al revés) también se
// anota: pasar a presupuesto automático es un cambio que importa.
export function detectarCambios(anterior: ValoresCampana | null, nueva: ValoresCampana): CambioDetectado[] {
  if (!anterior) return [];
  const cambios: CambioDetectado[] = [];
  if (!igual(anterior.presupuestoDiario, nueva.presupuestoDiario)) {
    cambios.push({ campo: "presupuesto_diario", valorAnterior: anterior.presupuestoDiario, valorNuevo: nueva.presupuestoDiario });
  }
  if (!igual(anterior.roasObjetivo, nueva.roasObjetivo)) {
    cambios.push({ campo: "roas_objetivo", valorAnterior: anterior.roasObjetivo, valorNuevo: nueva.roasObjetivo });
  }
  return cambios;
}

export type DireccionCambio = "subio" | "bajo" | "otro";

// "otro" cuando uno de los dos lados no tiene dato.
export function direccionCambio(anterior: string | null, nuevo: string | null): DireccionCambio {
  const a = centesimas(anterior);
  const n = centesimas(nuevo);
  if (a === null || n === null) return "otro";
  return n > a ? "subio" : n < a ? "bajo" : "otro";
}

export function esCampoCambio(valor: string): valor is CampoCambio {
  return valor === "presupuesto_diario" || valor === "roas_objetivo";
}
