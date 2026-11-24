// Estilo «Portadas Zilonix»: datos del producto + texto ORIGINAL de Mateo
// (sin tocar) + «AJUSTES DE ZILONIX SELLER» al final. Una portada por
// cada cuenta destino, cada una con su pareja composición + escena.

import { COMPOSICIONES_PORTADA_ZILONIX, ESCENAS_USO, type Asignacion } from "./composiciones";
import { bloqueDatosProducto, type DatosProducto } from "./datosProducto";
import { TEXTO_ORIGINAL_PORTADAS } from "./textoPortadasZilonix";

export { TEXTO_ORIGINAL_PORTADAS };

export const ESTILO_ZILONIX_PORTADAS = { id: "zilonix_portadas", etiqueta: "Portadas Zilonix" } as const;

export function promptZilonixPortada(datos: DatosProducto, cuenta: { indice: number; cantidad: number; asignacion: Asignacion }): string {
  const composicion = COMPOSICIONES_PORTADA_ZILONIX[cuenta.asignacion.composicion % COMPOSICIONES_PORTADA_ZILONIX.length];
  const escena = ESCENAS_USO[cuenta.asignacion.escena % ESCENAS_USO.length];
  const ajustes = [
    "AJUSTES DE ZILONIX SELLER (tienen prioridad sobre lo anterior):",
    `1. Genera UNA sola portada: la número ${cuenta.indice} de ${cuenta.cantidad}; ignora la cantidad que diga el texto anterior.`,
    `2. Composición de esta portada: ${composicion} Escena de uso: ${escena}.`,
    "3. Formato cuadrado 1:1. La salida final se lleva a 500 × 500 px.",
    `4. Idioma de cualquier elemento visual: ${datos.idioma}. País: ${datos.nombrePais}.`,
    datos.registroSanitario
      ? `5. Registro sanitario confirmado: ${datos.registroSanitario}. No inventes ningún otro sello ni certificación.`
      : "5. No hay registro sanitario confirmado: no muestres ni menciones ningún registro, sello o certificación.",
  ];
  return [bloqueDatosProducto(datos), "", TEXTO_ORIGINAL_PORTADAS, "", ...ajustes].join("\n");
}
