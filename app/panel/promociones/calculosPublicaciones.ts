// Tarea "Promociones real" (Refs #295) — funciones puras de la
// pantalla nueva. Issue #315 (Z-LATAM-01) — NUNCA se asume "," como
// separador de miles o "." como decimal (eso es solo es-CO): se leen
// los separadores reales del idioma de la cuenta con Intl, igual que
// formatearMoneda/formatearNumero (lib/ml/sitios.ts) ya hacen para
// mostrar números — esto es lo mismo, pero para booleanamente poder
// ESCRIBIR uno a mano en un input y volver a parsearlo.

export function separadoresDe(idioma: string): { miles: string; decimal: string } {
  const partes = new Intl.NumberFormat(idioma).formatToParts(1234.5);
  const miles = partes.find((p) => p.type === "group")?.value ?? ",";
  const decimal = partes.find((p) => p.type === "decimal")?.value ?? ".";
  return { miles, decimal };
}

function escaparRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `null` = vacío o no se pudo interpretar como número — nunca 0 a
// ciegas (un campo vacío y un campo con "0" son cosas distintas).
export function parsearNumeroLocal(texto: string, idioma: string): number | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  const { miles, decimal } = separadoresDe(idioma);
  const sinMiles = limpio.replace(new RegExp(escaparRegExp(miles), "g"), "");
  const conPuntoDecimal = decimal === "." ? sinMiles : sinMiles.replace(decimal, ".");
  const numero = Number(conPuntoDecimal);
  return Number.isFinite(numero) ? numero : null;
}

// Para mostrar un número editable en un input de texto (sin símbolo de
// moneda) — mismo idioma que formatearMoneda/formatearNumero usan para
// MOSTRAR, así lo que el usuario ve y lo que puede volver a escribir
// usan siempre el mismo separador.
export function formatoEnteroInput(valor: number, idioma: string): string {
  return new Intl.NumberFormat(idioma, { maximumFractionDigits: 0 }).format(Math.round(valor));
}

export type CalculoModalParticipar = {
  descuentoVendedorPct: number;
  precioFinal: number;
};

// El único cálculo real del modal "Confirma los detalles de la
// promoción": `deal_price` (lo que de verdad se manda a Mercado Libre)
// es el precio final que el vendedor elige — nunca se inventa un
// desglose en pesos del "aporte de Mercado Libre" (ese dato no viene
// confirmado de la API, ver el comentario en
// lib/ml/promocionesPublicaciones.ts). Por eso el modal solo pide
// "precio final" o "% de descuento", nunca dos campos que se puedan
// contradecir entre sí.
export function calcularDesdePrecioFinal(precioOriginal: number, precioFinal: number): CalculoModalParticipar {
  const descuentoVendedorPct = precioOriginal > 0 ? ((precioOriginal - precioFinal) / precioOriginal) * 100 : 0;
  return { descuentoVendedorPct, precioFinal };
}

export function calcularDesdePorcentaje(precioOriginal: number, descuentoVendedorPct: number): CalculoModalParticipar {
  const precioFinal = Math.round(precioOriginal * (1 - descuentoVendedorPct / 100));
  return { descuentoVendedorPct, precioFinal };
}

// Mismo criterio que lib/ml/promocionesPublicaciones.ts (cumpleRegla,
// descuentoVendedorPct) — se duplica a propósito en el cliente SOLO
// para mostrar en vivo si una promoción "Supera el máximo configurado"
// mientras se elige la regla (b), antes de mandar nada al servidor.
// El servidor SIEMPRE vuelve a decidir fresco con su propia copia —
// esto nunca decide si algo se ejecuta, solo informa en pantalla.
export function superaMaximoConfigurado(precioOriginal: number | null, precioSugerido: number | null, maximoPct: number): boolean {
  if (precioOriginal == null || precioOriginal <= 0 || precioSugerido == null) return false;
  const pct = ((precioOriginal - precioSugerido) / precioOriginal) * 100;
  return pct > maximoPct;
}

// Promo-C (Refs #573) — selección de promociones POR PRODUCTO. Todo lo de
// abajo es solo para pantalla: el servidor vuelve a validar piso, reglas y
// permisos con datos frescos en cada llamada (participar / salir).
export type PromocionMarcable = {
  tipoPromocion: string;
  promotionIdMl: string | null;
  estadoMl: string;
  puedeSalirApi: boolean;
  cumpleReglas: boolean;
  motivoRevisarManual: string | null;
  precioSugerido: number | null;
  precioMinimo: number | null;
};

export function claveMarcaPromocion(p: Pick<PromocionMarcable, "tipoPromocion" | "promotionIdMl">): string {
  return `${p.tipoPromocion}|${p.promotionIdMl ?? ""}`;
}

// «started» y «pending» ya están dentro: lo que se puede hacer es salir.
export function accionDePromocion(p: Pick<PromocionMarcable, "estadoMl">): "salir" | "participar" {
  return p.estadoMl === "started" || p.estadoMl === "pending" ? "salir" : "participar";
}

// null = se puede marcar. Si no, el motivo que se muestra deshabilitada.
export function motivoNoMarcable(p: PromocionMarcable): string | null {
  if (accionDePromocion(p) === "salir") {
    return p.puedeSalirApi ? null : "Solo se puede dejar desde Mercado Libre.";
  }
  if (!p.cumpleReglas) return p.motivoRevisarManual ?? "No cumple las reglas para participar.";
  return null;
}

// Participar sin un precio sugerido real no tiene qué mandar: no se inventa.
export function motivoSinPrecioParaParticipar(p: PromocionMarcable): string | null {
  return accionDePromocion(p) === "participar" && p.precioSugerido == null ? "Sin precio sugerido: se elige con «Participar» en esta promoción." : null;
}

export function quedaBajoPrecioMinimo(p: Pick<PromocionMarcable, "precioSugerido" | "precioMinimo">): boolean {
  return p.precioSugerido != null && p.precioMinimo != null && p.precioSugerido < p.precioMinimo;
}

// SOLO las marcadas y marcables, en el orden de la lista.
export function planAplicarPromociones<T extends PromocionMarcable>(promociones: T[], marcadas: ReadonlySet<string>): { promocion: T; accion: "salir" | "participar" }[] {
  return promociones
    .filter((p) => marcadas.has(claveMarcaPromocion(p)) && motivoNoMarcable(p) == null && motivoSinPrecioParaParticipar(p) == null)
    .map((promocion) => ({ promocion, accion: accionDePromocion(promocion) }));
}
