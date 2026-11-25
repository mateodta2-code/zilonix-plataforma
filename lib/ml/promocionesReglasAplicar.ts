import { formatearMoneda } from "@/lib/ml/sitios";
import {
  aplicaToleranciaCompartida,
  describirExclusion,
  describirMaximoGlobal,
  describirMaximoSku,
  describirVentana,
  normalizarTextoComparable,
  type ReglasAdicionales,
} from "@/lib/ml/promocionesReglasTexto";

// PR 2 de Promociones — aplica las «Reglas adicionales» ya guardadas con
// FUNCIONES PURAS (sin IA, sin red, sin base de datos). Solo se llama
// con la regla «tabla-maestra» (aplicarReglaALote); nunca con «todas»
// (sin piso, decisión de Mateo), «maximo» ni «salir-todas».
//
// El piso de la tabla maestra (costos_sku) SIEMPRE gana: ninguna regla
// adicional puede bajar el precio por debajo de él. Cada regla de % solo
// puede SUBIR el precio (menos descuento), y el precio final es
// max(precio por regla, piso); además validarCalculado
// (lib/ml/promocionesEjecucion.ts) vuelve a exigir deal >= piso antes de
// escribir en Mercado Libre.
//
// ÚNICA excepción (decisión de Mateo): la tolerancia en promociones
// compartidas (toleranciaCompartidaBajoPiso). Solo si la promoción es
// compartida, el piso supera a max_discounted_price por <= monto y el
// precio es exactamente ese máximo (aplicaToleranciaCompartida). Acá solo
// se respeta (no se vuelve a subir al piso) y se explica; quien decide el
// precio es el motor y quien lo autoriza es validarCalculado.

export type PromocionParaReglas = {
  skuCodigo: string | null;
  tipoPromocion: string;
  // Nombre de la promoción SI Mercado Libre lo mandó; null si no vino.
  nombrePromocion: string | null;
  esCompartida: boolean;
  fechaInicio: string | null; // hora local del sitio, sin zona
  fechaFin: string | null;
  precioOriginal: number | null;
  // Precio con el que el motor entraría (con piso: el precio mínimo).
  precioSugerido: number | null;
  precioMinimo: number | null;
  maxDiscountedPrice: number | null;
  // Sitio de la cuenta, solo para mostrar montos con su moneda.
  siteId?: string;
};

export type EvaluacionReglasAdicionales = {
  excluida: boolean;
  // Tope de descuento (%) más estricto que aplica, o null.
  maxPctEfectivo: number | null;
  // Precio con el que se entraría; null si excluida o no se puede calcular.
  precioFinal: number | null;
  // Una línea por regla que la excluyó o la limitó.
  motivos: string[];
  // Texto corto para la lista (la primera razón), o null si no afectó.
  motivoVisible: string | null;
};

function recortarFecha(fecha: string | null): string | null {
  return typeof fecha === "string" && fecha.length >= 19 ? fecha.slice(0, 19) : null;
}

export function evaluarReglasAdicionales(reglas: ReglasAdicionales | null, promo: PromocionParaReglas): EvaluacionReglasAdicionales {
  if (!reglas) return { excluida: false, maxPctEfectivo: null, precioFinal: promo.precioSugerido, motivos: [], motivoVisible: null };

  // ¿El motor entró bajo el piso por la tolerancia? (compartida, regla
  // guardada, diferencia <= monto y precio = max_discounted_price.)
  const monto = reglas.toleranciaCompartidaBajoPiso?.monto ?? null;
  const usoTolerancia = promo.precioSugerido != null && promo.precioSugerido === promo.maxDiscountedPrice && aplicaToleranciaCompartida(promo, monto);
  const motivoTolerancia =
    usoTolerancia && monto != null && promo.precioMinimo != null && promo.precioSugerido != null
      ? `Compartida: participa ${formatearMoneda(promo.precioMinimo - promo.precioSugerido, promo.siteId)} por debajo del piso (tolerancia ${formatearMoneda(monto, promo.siteId)}, ML aporta la diferencia)`
      : null;
  const sinCambios: EvaluacionReglasAdicionales = { excluida: false, maxPctEfectivo: null, precioFinal: promo.precioSugerido, motivos: motivoTolerancia ? [motivoTolerancia] : [], motivoVisible: motivoTolerancia };

  const excluidaPor = (motivo: string): EvaluacionReglasAdicionales => ({
    excluida: true,
    maxPctEfectivo: null,
    precioFinal: null,
    motivos: [motivo],
    motivoVisible: motivo,
  });

  // 1) Exclusiones.
  for (const e of reglas.exclusiones) {
    const texto = `Excluida por: ${describirExclusion(e)}`;
    if (e.tipo === "compartida" && promo.esCompartida) return excluidaPor(texto);
    if (e.tipo === "tipo_promocion" && e.valor && normalizarTextoComparable(promo.tipoPromocion).includes(e.valor)) return excluidaPor(texto);
    if (e.tipo === "nombre_promocion" && e.valor) {
      // Nunca se adivina: si ML no mandó el nombre, no se puede descartar
      // que sea la promoción excluida — se queda afuera, con motivo claro.
      if (promo.nombrePromocion == null) return excluidaPor(`Excluida: no se pudo leer el nombre de la promoción para verificar «${e.valor}»`);
      if (normalizarTextoComparable(promo.nombrePromocion).includes(e.valor)) return excluidaPor(texto);
    }
  }

  // 2) Ventanas de fechas: la promoción se cruza con la ventana si
  // empieza antes de que termine y termina después de que empiece.
  const inicio = recortarFecha(promo.fechaInicio);
  const fin = recortarFecha(promo.fechaFin);
  for (const v of reglas.ventanasFecha) {
    const texto = `Excluida por: ${describirVentana(v)}`;
    if (!inicio || !fin) return excluidaPor(`Excluida: no se pudieron leer las fechas de la promoción para verificar «${describirVentana(v)}»`);
    if (inicio <= v.hasta && fin >= v.desde) return excluidaPor(texto);
  }

  // 3) Máximos de descuento — gana el más estricto (el menor %).
  let maxPct: number | null = null;
  let razonMax: string | null = null;
  if (reglas.maximoDescuentoPct !== null) {
    maxPct = reglas.maximoDescuentoPct;
    razonMax = describirMaximoGlobal(reglas.maximoDescuentoPct);
  }
  const sku = promo.skuCodigo ? promo.skuCodigo.trim().toLowerCase() : null;
  if (sku) {
    for (const m of reglas.maximoPorSku) {
      if (m.sku.trim().toLowerCase() === sku && (maxPct === null || m.maximoPct < maxPct)) {
        maxPct = m.maximoPct;
        razonMax = describirMaximoSku(m);
      }
    }
  }

  if (maxPct === null || promo.precioSugerido == null) {
    return { ...sinCambios, maxPctEfectivo: maxPct };
  }
  if (promo.precioOriginal == null || promo.precioOriginal <= 0) {
    return excluidaPor(`Excluida: sin precio original no se puede aplicar «${razonMax}»`);
  }

  // Precio mínimo que respeta el tope de descuento (redondeo hacia arriba:
  // nunca queda más descuento del permitido).
  const precioPorRegla = Math.ceil(promo.precioOriginal * (1 - maxPct / 100));
  // Con la tolerancia el "piso" efectivo es el máximo de la promoción (el
  // precio al que ya entró el motor): nunca se vuelve a subir al piso real.
  const piso = usoTolerancia && promo.maxDiscountedPrice != null ? promo.maxDiscountedPrice : promo.precioMinimo ?? 0;
  const precioFinal = Math.max(promo.precioSugerido, precioPorRegla, piso);

  if (promo.maxDiscountedPrice != null && precioFinal > promo.maxDiscountedPrice) {
    return excluidaPor(`Excluida: «${razonMax}» exige un precio que esta promoción no permite`);
  }
  if (precioFinal > promo.precioSugerido) {
    const motivo = `Limitada a ${maxPct}% por: ${razonMax}`;
    return { excluida: false, maxPctEfectivo: maxPct, precioFinal, motivos: motivoTolerancia ? [motivo, motivoTolerancia] : [motivo], motivoVisible: motivo };
  }
  return { ...sinCambios, maxPctEfectivo: maxPct, precioFinal };
}
