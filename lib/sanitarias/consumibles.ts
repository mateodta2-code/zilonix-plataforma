// Qué publicaciones se miran: suplementos, tés y cosméticos (lo que regula
// el INVIMA). En el OS de un solo negocio también entraba todo lo de
// Unmerco y Vitalcom (`UNM…`, `VITAL…`) aunque Mercado Libre lo tuviera en
// otra categoría. Esos prefijos son el catálogo de ESA empresa, no una
// regla del producto: cada empresa pasa los suyos. Sin el parámetro, un
// SKU `UNM…` en un dominio que no es consumible no cuenta.

const DOMINIOS_CONSUMIBLES = /SUPPLEMENT|TEA$|HAIR_TREATMENT|SHAMPOO|SKIN_CARE|COSMETIC|FOOD|PROTEIN|VITAMIN|DIET|COLLAGEN|HEALTH_CARE/i;

export type ConfigConsumibles = {
  prefijosSku?: readonly string[];
};

export function esConsumible(dominio: unknown, sku: unknown, config: ConfigConsumibles = {}): boolean {
  if (DOMINIOS_CONSUMIBLES.test(String(dominio || ""))) return true;
  const codigo = String(sku || "");
  for (const prefijo of config.prefijosSku ?? []) {
    const limpio = String(prefijo ?? "").trim();
    // Un prefijo vacío armaría un «empieza por nada» y marcaría todo.
    if (!limpio) continue;
    if (codigo.toLowerCase().startsWith(limpio.toLowerCase())) return true;
  }
  return false;
}
