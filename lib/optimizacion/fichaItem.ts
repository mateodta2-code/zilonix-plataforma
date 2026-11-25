// Optimización → «Mejorar título»: arma la FICHA de la IA solo con lo que el
// vendedor ya publicó en el ítem (título, atributos y descripción). Todo con
// origen «vendedor», nunca «supuesto»: así pasa fichaConfirmada sin inventar
// datos. Puro (sin servidor), con pruebas.

import type { AtributoItemMl } from "@/lib/ml/cliente";
import { leerFicha, limpiarInfoVendedor, type Ficha } from "@/lib/publicaciones/ficha";

// Atributos que no describen el producto (códigos y datos internos).
const ATRIBUTOS_IGNORADOS = new Set(["GTIN", "EAN", "UPC", "SELLER_SKU", "ITEM_CONDITION", "PACKAGE_WEIGHT", "PACKAGE_LENGTH", "PACKAGE_WIDTH", "PACKAGE_HEIGHT", "ALPHANUMERIC_MODEL"]);
const MAXIMO_CARACTERISTICAS = 10;
export const LARGO_DESCRIPCION_PARA_IA = 800;

export function fichaDesdeItem(entrada: { titulo: string; atributos: AtributoItemMl[] }): Ficha | null {
  const nombre = entrada.titulo.trim().replace(/\s+/g, " ");
  if (!nombre) return null;
  const propios = entrada.atributos.filter((a) => !ATRIBUTOS_IGNORADOS.has(a.id));
  const valorDe = (id: string) => propios.find((a) => a.id === id)?.valor ?? null;
  const caracteristicas = propios
    .filter((a) => a.id !== "COLOR" && a.id !== "MATERIAL")
    .slice(0, MAXIMO_CARACTERISTICAS)
    .map((a) => `${a.nombre}: ${a.valor}`);
  const campo = (valor: string | string[] | null) => ({ valor, origen: "vendedor" });
  return leerFicha({
    nombre: campo(nombre),
    color: campo(valorDe("COLOR")),
    material: campo(valorDe("MATERIAL")),
    caracteristicas: campo(caracteristicas),
  });
}

// La descripción no entra a la ficha: va como «información del vendedor»
// (limpia de HTML y recortada) para que la IA y la revisión de cifras la usen.
export function infoDeDescripcion(descripcion: string | null): string {
  return limpiarInfoVendedor(descripcion, LARGO_DESCRIPCION_PARA_IA);
}
