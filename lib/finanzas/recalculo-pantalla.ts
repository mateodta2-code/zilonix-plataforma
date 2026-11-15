// Issue #131 (Parte C) — filtro del panel «Recalcular costo con la tabla
// maestra» de Finanzas → Ventas. Puro (sin base ni reloj): lo usan las
// dos server actions (vista previa y confirmación) para que el filtro
// que ve la persona y el que se confirma sean el MISMO.
//
// Fechas: días de Bogotá (YYYY-MM-DD). «Desde» = inicio de ese día;
// «Hasta» = último día INCLUIDO, así que al motor va el fin exclusivo
// (inicio del día siguiente), igual que el filtro de Ventas.

import { limitesDiaBogota } from "@/lib/filtros-listado";
import type { FiltroRecalculo } from "./recalcular-costos";

export type EntradaFiltroRecalculo = { skuCodigo?: string; desde?: string; hasta?: string };

// Lo que el cliente vuelve a mandar al confirmar y lo que se muestra.
export type FiltroRecalculoNormalizado = { skuCodigo?: string; desde?: string; hasta?: string; desdeIso?: string; hastaIso?: string };

// El mismo texto de FiltroRecalculoInvalidoError (recalcular-costos.ts).
export const MENSAJE_FILTRO_VACIO = "Elige un SKU o un rango de fechas para recalcular.";

function vacioAIndefinido(valor: string | undefined): string | undefined {
  const limpio = valor?.trim();
  return limpio ? limpio : undefined;
}

export function parsearFiltroRecalculo(
  entrada: EntradaFiltroRecalculo
): { ok: true; filtro: FiltroRecalculo; normalizado: FiltroRecalculoNormalizado } | { ok: false; mensaje: string } {
  const skuCodigo = vacioAIndefinido(entrada.skuCodigo);
  const desdeTexto = vacioAIndefinido(entrada.desde);
  const hastaTexto = vacioAIndefinido(entrada.hasta);
  if (!skuCodigo && !desdeTexto && !hastaTexto) return { ok: false, mensaje: MENSAJE_FILTRO_VACIO };

  const desde = desdeTexto === undefined ? undefined : limitesDiaBogota(desdeTexto)?.inicio;
  if (desdeTexto !== undefined && !desde) return { ok: false, mensaje: "La fecha «Desde» no es válida." };
  const hasta = hastaTexto === undefined ? undefined : limitesDiaBogota(hastaTexto)?.finExclusivo;
  if (hastaTexto !== undefined && !hasta) return { ok: false, mensaje: "La fecha «Hasta» no es válida." };
  if (desde && hasta && hasta <= desde) return { ok: false, mensaje: "La fecha «Hasta» no puede ser anterior a «Desde»." };

  return {
    ok: true,
    filtro: { skuCodigo, desde, hasta },
    normalizado: { skuCodigo, desde: desdeTexto, hasta: hastaTexto, desdeIso: desde?.toISOString(), hastaIso: hasta?.toISOString() },
  };
}
