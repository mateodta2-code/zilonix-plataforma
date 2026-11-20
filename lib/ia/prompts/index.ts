// Estilos de imagen de Publicar → «Crear con IA» (PR2). Lista extensible.
// `promptImagenIA` de lib/ia/imagen.ts NO se toca: Optimización lo usa.

import { ESTILO_EXPERTO_ML } from "./estiloExpertoML";
import { ESTILO_ZILONIX_CONTENIDO } from "./zilonix-contenido";
import { ESTILO_ZILONIX_PORTADAS } from "./zilonix-portadas";

export const ESTILOS_PROMPT_IMAGEN = [ESTILO_ZILONIX_PORTADAS, ESTILO_ZILONIX_CONTENIDO, ESTILO_EXPERTO_ML] as const;
export type EstiloImagen = (typeof ESTILOS_PROMPT_IMAGEN)[number]["id"];

// Tamaño de salida. Mercado Libre recomienda 1200 × 1200; Mateo eligió
// 500 × 500 el 19-nov-2026 (con zoom puede verse peor).
export const TAMANO_SALIDA_PX = 500;

export function esEstiloImagen(valor: unknown): valor is EstiloImagen {
  return ESTILOS_PROMPT_IMAGEN.some((e) => e.id === valor);
}

export { promptZilonixPortada } from "./zilonix-portadas";
export { promptFinalContenido, promptPropuestaContenidoZilonix, revisarCopySeguro } from "./zilonix-contenido";
export { promptExpertoML } from "./estiloExpertoML";
export { promptFotoPrincipal } from "./fotoPrincipal";
