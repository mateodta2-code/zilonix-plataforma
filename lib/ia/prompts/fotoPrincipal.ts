// Foto del producto solo sobre blanco: tipo OPCIONAL común a los tres
// estilos, APAGADO por defecto (decisión de Mateo, 19-nov-2026: la
// portada Zilonix con escena de uso puede ser la foto 1). Quitar el fondo
// lo hace la misma IA de imágenes de la empresa, en la instrucción.

import { bloqueDatosProducto, type DatosProducto } from "./datosProducto";

export const FOTO_PRINCIPAL_POR_DEFECTO = false;

export const TEXTO_FOTO_PRINCIPAL =
  "Esta es la FOTO PRINCIPAL de una publicación de Mercado Libre: el mismo producto de las fotos de referencia, recortado del fondo original, sobre fondo blanco puro (#FFFFFF), sin ningún texto, logo, marco, ícono, escena ni marca de agua. El producto completo ocupa cerca del 95 % del cuadro, centrado, con sombra suave natural, sin otros objetos salvo accesorios incluidos confirmados. Formato cuadrado 1:1, salida final de 500 × 500 px.";

export function promptFotoPrincipal(datos: DatosProducto): string {
  return [bloqueDatosProducto(datos), "", TEXTO_FOTO_PRINCIPAL].join("\n");
}

// Nota informativa junto a la foto 1 (nunca bloquea).
export const NOTA_FOTO_UNO = "Mercado Libre recomienda la primera foto sobre fondo blanco; el diagnóstico te avisará si la modera.";
