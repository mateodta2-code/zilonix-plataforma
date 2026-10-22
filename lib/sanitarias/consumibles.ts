// Issue #61 (Z-NV-03a) — port de esConsumible() de
// lib/alertas-sanitarias.js (zilonix-os, autor Frankie), con un
// cambio a propósito (pedido explícito del issue): el original tenía
// hardcodeados los prefijos de SKU propios de Zilonix (UNM de Unmerco,
// VITAL de Vitalcom) — acá la lista de dominios de Mercado Libre que
// regula el INVIMA se queda igual, pero los prefijos de SKU entran
// como configuración por empresa (cada empresa tiene los suyos, o
// ninguno), nunca hardcodeados en este paquete compartido.
export type ConfigConsumibles = {
  prefijosSkuConsumibles?: string[];
};

// Qué dominios de Mercado Libre mira esto: suplementos, tés y cosméticos
// (lo que regula el INVIMA).
const DOMINIOS_CONSUMIBLES = /SUPPLEMENT|TEA$|HAIR_TREATMENT|SHAMPOO|SKIN_CARE|COSMETIC|FOOD|PROTEIN|VITAMIN|DIET|COLLAGEN|HEALTH_CARE/i;

function skuTienePrefijo(sku: string | null | undefined, prefijos: string[]): boolean {
  const s = String(sku || "").toUpperCase();
  return prefijos.some((p) => s.startsWith(String(p).toUpperCase()));
}

export function esConsumible(
  dominio: string | null | undefined,
  sku: string | null | undefined,
  config: ConfigConsumibles = {}
): boolean {
  return DOMINIOS_CONSUMIBLES.test(dominio || "") || skuTienePrefijo(sku, config.prefijosSkuConsumibles ?? []);
}
