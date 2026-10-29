import { leerItemParaPromocionMl, leerPromocionesItemMl, listarItemsActivosMl, type PromocionCrudaMl } from "@/lib/ml/cliente";

// Rama feat-promociones — motor de reglas puro, portado de
// zilonix-os-web (lib/mercadolibre-promo.js, ver
// docs/investigacion/promociones-mercado-libre.md de ese repo para la
// evidencia real de cada regla) y generalizado para cualquier empresa:
//
// - Nunca una app de Mercado Libre aparte: usa el token normal de la
//   cuenta (lib/ml/cuentas.ts), vía lib/trabajos/buscarPromocionesMultiCuenta.ts.
// - Nunca una regla global ni la clasificación suplemento/importación
//   de Zilonix OS — reglas por cuenta (promociones_reglas).
// - El piso SIEMPRE sale de costos_sku (decisión de Mateo, "el freno
//   no se puede apagar"): sin SKU o sin precio mínimo cargado, un
//   producto queda bloqueado para participar O modificar — nunca se
//   inventa un precio ni se usa el sugerido de Mercado Libre como
//   respaldo (al revés de la versión vieja de Zilonix OS, que sí lo
//   hacía cuando no había piso).

// Tipos que Mercado Libre rechaza al escribir por esta API — evidencia
// real citada en docs/investigacion/promociones-mercado-libre.md
// (§4.2 de ese documento): PRICE_DISCOUNT sin id propio ("Invalid
// promotion type"), LIGHTNING con términos fijos no editables, SMART y
// UNHEALTHY_STOCK con "Offer id is required" (48 y 399 intentos reales
// fallidos respectivamente). Confirmar de nuevo en vivo antes de
// production — Mercado Libre puede haber cambiado esto.
export const TIPOS_SIN_ESCRITURA_API = ["PRICE_DISCOUNT", "LIGHTNING", "SMART", "UNHEALTHY_STOCK"];

export type ReglasCuentaPromocion = {
  descuentoMaximoPct: number;
  participarCompartidas: boolean;
  igualarAlPiso: boolean;
};

export type ItemConPromociones = {
  itemId: string;
  cuentaMlId: string;
  nickname: string;
  tituloProducto: string | null;
  thumbnail: string | null;
  skuCodigo: string | null;
  tieneVariantes: boolean;
  promociones: PromocionCrudaMl[];
};

export type CandidatoCalculado = {
  cuentaMlId: string;
  itemId: string;
  skuCodigo: string | null;
  tituloProducto: string | null;
  thumbnail: string | null;
  tieneVariantes: boolean;
  tipoPromocion: string;
  promotionIdMl: string | null;
  estadoMl: string;
  esCompartida: boolean;
  soloEnMl: boolean;
  precioOriginal: number | null;
  precioActual: number | null;
  precioMinimo: number | null;
  precioSugerido: number | null;
  maxDiscountedPrice: number | null;
  gananciaEstimada: number | null;
  cumpleReglas: boolean;
  // Una de "participar" | "modificar" | null (nada que hacer, o
  // bloqueado — ver motivoRevisarManual para el porqué).
  accionSugerida: "participar" | "modificar" | null;
  motivoRevisarManual: string | null;
};

function precioFinal(promo: PromocionCrudaMl): number | null {
  if (Number(promo.price) > 0) return Number(promo.price);
  if (Number(promo.suggested_discounted_price) > 0) return Number(promo.suggested_discounted_price);
  return null;
}

function numeroOrNull(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Fechas en formato local Colombia (UTC-5 fijo, sin horario de verano)
// — confirmado en zilonix-os-web contra una cuenta real: "-05:00" y
// solo-fecha-sin-hora son rechazados por Mercado Libre, solo este
// formato (YYYY-MM-DDTHH:mm:ss, sin zona) funciona.
function ahoraLocalColombia(): string {
  const ahora = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return ahora.toISOString().slice(0, 10) + "T00:00:00";
}
function finDeMesLocalColombia(): string {
  const ahora = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const ultimoDia = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 0));
  return ultimoDia.toISOString().slice(0, 10) + "T23:59:59";
}

export function fechasParaParticipar(promo: PromocionCrudaMl): { fechaInicio: string; fechaFin: string } {
  const inicio = typeof promo.start_date === "string" ? promo.start_date.slice(0, 19) : null;
  const fin = typeof promo.finish_date === "string" ? promo.finish_date.slice(0, 19) : null;
  return { fechaInicio: inicio || ahoraLocalColombia(), fechaFin: fin || finDeMesLocalColombia() };
}

// El corazón de las reglas — calculado en código, NUNCA le toca a la
// IA (lib/ia/) decidir un número: esa es la causa real del bug de
// Zilonix OS donde una IA proponía descuentos por encima del tope
// permitido. La IA, si está conectada, solo EXPLICA este resultado ya
// calculado (ver lib/ia/resumenPromociones.ts).
export function calcularCandidatosItem(
  item: ItemConPromociones,
  reglas: ReglasCuentaPromocion,
  precioMinimo: number | null,
  costo: number | null
): CandidatoCalculado[] {
  const original = numeroOrNull(item.promociones.find((p) => numeroOrNull(p.original_price))?.original_price);

  return item.promociones.map((promo): CandidatoCalculado => {
    const tipoPromocion = typeof promo.type === "string" ? promo.type : "desconocido";
    const estadoMl = typeof promo.status === "string" ? promo.status : "desconocido";
    const promotionIdMl = typeof promo.id === "string" ? promo.id : null;
    const esCompartida = Number(promo.meli_percentage || 0) > 0;
    const soloEnMl = TIPOS_SIN_ESCRITURA_API.includes(tipoPromocion);
    const precioActual = precioFinal(promo);
    const maxDiscountedPrice = numeroOrNull(promo.max_discounted_price);

    const base: CandidatoCalculado = {
      cuentaMlId: item.cuentaMlId,
      itemId: item.itemId,
      skuCodigo: item.skuCodigo,
      tituloProducto: item.tituloProducto,
      thumbnail: item.thumbnail,
      tieneVariantes: item.tieneVariantes,
      tipoPromocion,
      promotionIdMl,
      estadoMl,
      esCompartida,
      soloEnMl,
      precioOriginal: original,
      precioActual,
      precioMinimo,
      precioSugerido: null,
      maxDiscountedPrice,
      gananciaEstimada: null,
      cumpleReglas: false,
      accionSugerida: null,
      motivoRevisarManual: null,
    };

    // 1) Variantes — SIEMPRE a mano, sin importar el tipo ni el estado
    // (confirmado en vivo en zilonix-os-web: ajustar por item_id solo
    // tocaba una variante y dejaba otra desactualizada).
    if (item.tieneVariantes) {
      return { ...base, motivoRevisarManual: "Este producto tiene variantes (colores/modelos) — Mercado Libre no deja ajustar todas por esta vía, se revisa a mano." };
    }

    // 2) Tipos que Mercado Libre no deja escribir por esta API.
    if (soloEnMl) {
      return { ...base, motivoRevisarManual: `El tipo "${tipoPromocion}" no se puede ajustar por la API de Mercado Libre — solo se puede desde la Central de Promociones ("Solo en ML").` };
    }

    // 3) Precio mínimo — freno real de Mateo, nunca se apaga: sin un
    // piso real de costos_sku, ni "participar" ni "modificar" se
    // calculan — nunca se inventa un precio con el sugerido de
    // Mercado Libre como respaldo.
    if (precioMinimo == null) {
      return { ...base, motivoRevisarManual: "Falta precio mínimo para este SKU en Finanzas — no se puede participar ni ajustar hasta que se cargue." };
    }

    const gananciaEstimada = costo != null ? precioMinimo - costo : null;

    // 4) Ya confirmada (started/pending) — igualar al piso si está por
    // encima, solo si la cuenta tiene esa regla prendida.
    if (estadoMl === "started" || estadoMl === "pending") {
      if (!reglas.igualarAlPiso) {
        return { ...base, cumpleReglas: true, precioSugerido: precioActual, gananciaEstimada: costo != null && precioActual != null ? precioActual - costo : null };
      }
      if (precioActual != null && precioActual > precioMinimo) {
        if (maxDiscountedPrice != null && precioMinimo > maxDiscountedPrice) {
          return {
            ...base,
            precioSugerido: precioMinimo,
            gananciaEstimada,
            motivoRevisarManual: `El piso (${precioMinimo}) está por encima del máximo que permite esta promoción puntual (${maxDiscountedPrice}) — no se puede ajustar sin quedar por encima de lo que Mercado Libre deja.`,
          };
        }
        return { ...base, cumpleReglas: true, accionSugerida: "modificar", precioSugerido: precioMinimo, gananciaEstimada };
      }
      return { ...base, cumpleReglas: true, precioSugerido: precioActual, gananciaEstimada: costo != null && precioActual != null ? precioActual - costo : null };
    }

    // 5) Candidata nueva (todavía no se unió) — "participar".
    if (estadoMl === "candidate") {
      if (esCompartida && !reglas.participarCompartidas) {
        return { ...base, motivoRevisarManual: "Promoción compartida con Mercado Libre (+Meli) — esta cuenta no tiene habilitado participar en estas. Se revisa a mano." };
      }
      if (maxDiscountedPrice != null && precioMinimo > maxDiscountedPrice) {
        return {
          ...base,
          precioSugerido: precioMinimo,
          gananciaEstimada,
          motivoRevisarManual: `El piso (${precioMinimo}) está por encima del máximo que permite esta promoción puntual (${maxDiscountedPrice}) — no hay forma de participar sin quedar por debajo del piso.`,
        };
      }
      if (original != null && original > 0) {
        const descuentoPct = ((original - precioMinimo) / original) * 100;
        if (descuentoPct > reglas.descuentoMaximoPct) {
          return {
            ...base,
            precioSugerido: precioMinimo,
            gananciaEstimada,
            motivoRevisarManual: `Igualar al piso implica ${Math.round(descuentoPct * 10) / 10}% de descuento, por encima del tope configurado para esta cuenta (${reglas.descuentoMaximoPct}%) — se revisa a mano.`,
          };
        }
      }
      return { ...base, cumpleReglas: true, accionSugerida: "participar", precioSugerido: precioMinimo, gananciaEstimada };
    }

    return { ...base, motivoRevisarManual: `Estado de Mercado Libre no reconocido ("${estadoMl}") — se revisa a mano.` };
  });
}

// Lee TODAS las publicaciones activas de una cuenta (paginado, sin
// tope fijo — al revés de la versión vieja de Zilonix OS, que paraba
// en 250) y, por cada una, sus promociones reales. El llamador
// (lib/trabajos/buscarPromocionesMultiCuenta.ts) decide la
// concurrencia y reporta progreso — esta función solo sabe leer UNA
// cuenta de punta a punta.
const TAMANO_PAGINA_ITEMS = 50;

export async function listarTodosLosItemsActivos(cuentaIdExterna: string, token: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  while (true) {
    const pagina = await listarItemsActivosMl(cuentaIdExterna, token, offset, TAMANO_PAGINA_ITEMS);
    ids.push(...pagina.ids);
    if (pagina.ids.length < TAMANO_PAGINA_ITEMS || ids.length >= pagina.totalCatalogo) break;
    offset += TAMANO_PAGINA_ITEMS;
  }
  return ids;
}

export async function leerPromocionesDeItem(
  itemId: string,
  cuentaMlId: string,
  nickname: string,
  token: string
): Promise<ItemConPromociones | null> {
  const promos = await leerPromocionesItemMl(itemId, token);
  if (!promos || promos.length === 0) return null;
  const detalle = await leerItemParaPromocionMl(itemId, token);
  return {
    itemId,
    cuentaMlId,
    nickname,
    tituloProducto: detalle?.title ?? null,
    thumbnail: detalle?.thumbnail ?? null,
    skuCodigo: detalle?.sellerCustomField ?? null,
    tieneVariantes: detalle?.tieneVariantes ?? false,
    promociones: promos,
  };
}
