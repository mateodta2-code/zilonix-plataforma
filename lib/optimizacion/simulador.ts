// Optimización, Fase 3 — simulador de precio: "si bajas a X, ganas Y por
// unidad y quedas Ganando o Compitiendo". Puro (lo usa la pantalla en el
// navegador): plata en centavos BigInt, sin float.
//
// La base sale del detalle (Fase 2) de los últimos 30 días: lo fijo por
// unidad (costo, empaque, envío y publicidad) y la comisión como parte
// del precio. Es una estimación: la comisión real depende del tipo de
// publicación y del envío, y la competencia también mira reputación,
// envío y cuotas, no solo el precio.

import { aCentavos, desdeCentavos, porcentaje } from "@/lib/finanzas/utilidad-venta";
import { aEscala, DecimalInvalidoError } from "@/lib/numeros/normalizar-decimal";

const CERO = BigInt(0);

// Sitios cuya moneda se usa sin decimales en Mercado Libre: "1.234" son
// mil doscientos treinta y cuatro, no uno con decimales.
const SITIOS_SIN_DECIMALES: ReadonlySet<string> = new Set(["MCO", "MLC"]);

export type BaseSimulacion = {
  // null = no hay ventas en 30 días con costos completos para estimar.
  fijoPorUnidad: string | null;
  comision: string | null;
  ventas: string | null;
  // price_to_win de Mercado Libre (solo catálogo).
  precioParaGanar: string | null;
};

export type Simulacion = {
  ganancia: string | null;
  margen: string | null;
  competencia: "ganando" | "compitiendo" | null;
};

// Texto que escribió la persona -> monto con 2 decimales. null si no es
// un precio válido (vacío, negativo, ambiguo).
export function leerPrecioEscrito(texto: string, siteId: string): string | null {
  try {
    const monto = aEscala(texto.replace(/[\s$]/g, ""), 2, { copSinDecimales: SITIOS_SIN_DECIMALES.has(siteId) });
    return aCentavos(monto) > CERO ? monto : null;
  } catch (error) {
    if (error instanceof DecimalInvalidoError) return null;
    throw error;
  }
}

export function simularPrecio(precio: string, base: BaseSimulacion): Simulacion {
  const p = aCentavos(precio);
  let ganancia: bigint | null = null;
  if (base.fijoPorUnidad !== null && base.comision !== null && base.ventas !== null) {
    const ventas = aCentavos(base.ventas);
    if (ventas > CERO) {
      const comision = (p * aCentavos(base.comision)) / ventas;
      ganancia = p - comision - aCentavos(base.fijoPorUnidad);
    }
  }
  const competencia = base.precioParaGanar === null ? null : p <= aCentavos(base.precioParaGanar) ? "ganando" : "compitiendo";
  return {
    ganancia: ganancia === null ? null : desdeCentavos(ganancia),
    margen: ganancia === null ? null : porcentaje(ganancia, p),
    competencia,
  };
}

// Frase del simulador bajo el campo de precio. `plata` formatea según el
// sitio (sitios.ts); `vendidas` es el total histórico de la publicación.
export function textoSimulacion(
  precio: string | null,
  sim: Simulacion | null,
  vendidas: number,
  plata: (v: string) => string,
  idioma: string,
): string {
  if (!precio || !sim) return "Escribe un precio para simular.";
  const conPrecio = plata(precio);
  const estado = sim.competencia === "ganando" ? "Ganando" : "Compitiendo";
  if (sim.ganancia === null || sim.margen === null) {
    const motivo =
      vendidas === 0
        ? `Con ${conPrecio}: esta publicación todavía no tiene ventas, así que no hay costos para estimar la ganancia. Se calculará cuando venda.`
        : `Con ${conPrecio}: no hay ventas con costos completos en este período para estimar la ganancia.`;
    return sim.competencia ? `${motivo} Con ese precio quedarías ${estado} en el catálogo.` : motivo;
  }
  const margen = Number(sim.margen).toLocaleString(idioma, { maximumFractionDigits: 1 });
  const base = `Si lo dejas en ${conPrecio}, ganas ${plata(sim.ganancia)} por unidad (${margen} %)`;
  return sim.competencia ? `${base} y quedas ${estado} en el catálogo.` : `${base}.`;
}
