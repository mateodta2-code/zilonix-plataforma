// Issue #130 (Z-FIN-08), maestra de #127 — costo de los SKU combo X2/X3.
// Función pura: no lee la base ni el reloj. La usan el congelado
// (congelar.ts) y el recálculo (recalcular-costos.ts): una sola regla.
//
// Regla (Sharel, 29-oct-2026), con el SKU ya normalizado (trim +
// mayúsculas):
// - Fila exacta con costo (BASEX2): se usa esa (origen "exacto").
// - Si no, y el SKU termina en X2 o X3: costo del SKU base (BASE) × 2 o
//   × 3 (origen "combo_base"). Base sin costo: sin costo, igual que hoy.
// - Solo se multiplica el costo del producto. Empaque y envío de agencia
//   se cobran una vez por paquete: de la fila exacta si existe, si no de
//   la base.
// - No son combo: X1, X4 en adelante ni SKU sin la X (AGUJA2).

import { aCentavos, desdeCentavos } from "./utilidad-venta";

// Una fila de costos_sku con el packing de su proveedor al lado.
export type MaestraSku = {
  costo: string | null;
  empaque: string | null;
  empaqueProveedor: string | null;
  envioAgencia: string | null;
};

export type ComboSku = { base: string; multiplicador: 2 | 3 };

const PATRON_COMBO = /^(.+)X([23])$/;

// Recibe el SKU YA normalizado. null = no es combo. "BASEX2" → BASE × 2;
// "X2", "BASEX1", "BASEX4", "BASEX12", "AGUJA2" → null.
export function parsearComboSku(sku: string): ComboSku | null {
  const m = PATRON_COMBO.exec(sku);
  // X12, X22…: antes del último dígito hay otro dígito, no la X, así que
  // el patrón no calza.
  if (!m) return null;
  return { base: m[1], multiplicador: m[2] === "2" ? 2 : 3 };
}

export type OrigenCosto = "exacto" | "combo_base";

export type CostoResuelto = {
  // Ya multiplicado si es combo; null = sin costo.
  costoUnitario: string | null;
  // null cuando no hay costo.
  origen: OrigenCosto | null;
  // Fila de la que salen empaque y envío: la exacta si existe, si no la base.
  filaCargos: MaestraSku | undefined;
};

export function resolverCostoSku(sku: string | null, maestra: ReadonlyMap<string, MaestraSku>): CostoResuelto {
  if (!sku) return { costoUnitario: null, origen: null, filaCargos: undefined };
  const exacta = maestra.get(sku);
  if (exacta && exacta.costo !== null) return { costoUnitario: exacta.costo, origen: "exacto", filaCargos: exacta };
  const combo = parsearComboSku(sku);
  const base = combo ? maestra.get(combo.base) : undefined;
  if (combo && base && base.costo !== null) {
    return {
      costoUnitario: desdeCentavos(aCentavos(base.costo) * BigInt(combo.multiplicador)),
      origen: "combo_base",
      filaCargos: exacta ?? base,
    };
  }
  return { costoUnitario: null, origen: null, filaCargos: exacta ?? base };
}

// Los códigos que hay que leer de costos_sku: cada SKU y, si es combo,
// su base. Sin repetidos.
export function codigosParaMaestra(skus: string[]): string[] {
  const codigos = new Set<string>();
  for (const sku of skus) {
    codigos.add(sku);
    const combo = parsearComboSku(sku);
    if (combo) codigos.add(combo.base);
  }
  return [...codigos];
}
