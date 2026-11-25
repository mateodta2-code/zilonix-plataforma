// Optimización → «Mejorar título»: la ficha del producto armada SOLO con lo
// que el vendedor ya publicó en el ítem (título, atributos y descripción).
// Todo con origen «vendedor» y nada «supuesto», así pasa fichaConfirmada sin
// inventar datos. Puro (sin servidor).

import { fichaVacia, leerFicha, limpiarInfoVendedor, type Ficha } from "@/lib/publicaciones/ficha";

export type AtributoPublicado = { id: string; nombre: string; valor: string };

const IDS_COLOR = ["COLOR", "MAIN_COLOR"];
const IDS_MATERIAL = ["MATERIAL", "MAIN_MATERIAL"];
// Códigos y datos internos que no sirven para un título.
const IDS_OMITIDOS = new Set(["GTIN", "EAN", "UPC", "ISBN", "MPN", "SELLER_SKU", "ITEM_CONDITION", "EMPTY_GTIN_REASON", "PACKAGE_WEIGHT", "PACKAGE_LENGTH", "PACKAGE_WIDTH", "PACKAGE_HEIGHT"]);
const MAXIMO_CARACTERISTICAS = 10;
export const LARGO_DESCRIPCION_FICHA = 1_000;

export function fichaDesdeItem(entrada: { titulo: string | null; atributos: AtributoPublicado[]; descripcion?: string | null }): { ficha: Ficha; info: string } | null {
  const titulo = limpiarInfoVendedor(entrada.titulo, 160);
  if (!titulo) return null;
  const ficha = fichaVacia();
  const buscar = (ids: string[]) => entrada.atributos.find((a) => ids.includes(a.id))?.valor ?? null;
  const caracteristicas = entrada.atributos
    .filter((a) => !IDS_OMITIDOS.has(a.id) && !IDS_COLOR.includes(a.id) && !IDS_MATERIAL.includes(a.id))
    .map((a) => `${a.nombre}: ${a.valor}`)
    .slice(0, MAXIMO_CARACTERISTICAS);
  // leerFicha limpia y recorta; fichaVacia ya trae origen «vendedor» en todo.
  const leida = leerFicha({
    ...ficha,
    nombre: { valor: titulo, origen: "vendedor" },
    color: { valor: buscar(IDS_COLOR), origen: "vendedor" },
    material: { valor: buscar(IDS_MATERIAL), origen: "vendedor" },
    caracteristicas: { valor: caracteristicas, origen: "vendedor" },
  });
  return { ficha: leida, info: limpiarInfoVendedor(entrada.descripcion, LARGO_DESCRIPCION_FICHA) };
}
