// Issue #255 — cómo se ve un número del tablero. Reusa los formateadores
// que ya existen (mostrarMonto, mostrarPorcentaje) en vez de armar otro.
// La cuenta sigue en kpis.ts; acá solo entra y sale texto.

import { mostrarPorcentaje } from "@/components/finanzas/formato";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { aEscala } from "@/lib/numeros/normalizar-decimal";
import { porcentajeDeRazon } from "@/lib/publicidad/kpis";

const GUION = "—";

export function mostrarDinero(monto: string | null): string {
  if (monto === null) return GUION;
  return mostrarMonto(aEscala(monto, 2));
}

// Tarjetas: COP sin decimales. El redondeo es el de aEscala (mitad hacia arriba), no un float.
export function mostrarDineroTarjeta(monto: string | null): string {
  if (monto === null) return GUION;
  return mostrarMonto(aEscala(monto, 0));
}

export function mostrarRoas(ratio: string | null): string {
  if (ratio === null) return GUION;
  return `${aEscala(ratio, 2).replace(".", ",")}x`;
}

export function mostrarFraccion(fraccion: string | null): string {
  if (fraccion === null) return GUION;
  const porcentaje = porcentajeDeRazon(fraccion, "1");
  return porcentaje === null ? GUION : mostrarPorcentaje(porcentaje);
}

export function mostrarEntero(valor: string | null): string {
  if (valor === null) return GUION;
  return new Intl.NumberFormat("es-CO").format(BigInt(valor));
}

export function mostrarObjetivoRoas(real: string | null, objetivo: string | null): string {
  if (objetivo === null) return mostrarRoas(real);
  return `${mostrarRoas(real)} · objetivo ${mostrarRoas(objetivo)}`;
}

export function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString("es-CO", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function nombreMes(anio: number, mes: number): string {
  return new Date(Date.UTC(anio, mes - 1, 1)).toLocaleDateString("es-CO", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}
