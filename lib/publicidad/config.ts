// Issue #255 — umbrales del tablero de Product Ads. Un solo lugar, con
// nombre, para que la Fase 4 pueda cambiarlos por empresa sin cazar
// números en la pantalla.
//
// Son textos decimales, no number: 0.2, 0.05 y 1.2 no son exactos en
// float y estos topes se comparan contra plata. El valor es el que
// pidió la tarea (20 %, 5 % del precio, 7 días, 1,2×).

export const ACOS_MAXIMO = "0.20";
export const TOPE_GASTO_SIN_VENTAS = "0.05";
export const DIAS_APRENDIZAJE = 7;
// Pendiente de confirmar con Melisa. 1,2× es el valor inicial de la tarea.
export const FACTOR_EXCELENTE = "1.2";
export const PERIODO_POR_DEFECTO = "mes_en_curso" as const;

// La URL del panel de Product Ads no está en el repo. No se inventa:
// queda pendiente de confirmar con Mateo. Mientras sea null, la pantalla
// muestra el texto "Verificar en Mercado Libre" sin un href falso.
export const URL_PUBLICIDAD_ML: string | null = null;

export type ConfigPublicidad = {
  acosMaximo: string;
  topeGastoSinVentas: string;
  diasAprendizaje: number;
  factorExcelente: string;
  periodoPorDefecto: typeof PERIODO_POR_DEFECTO;
};

const DEFECTO: ConfigPublicidad = {
  acosMaximo: ACOS_MAXIMO,
  topeGastoSinVentas: TOPE_GASTO_SIN_VENTAS,
  diasAprendizaje: DIAS_APRENDIZAJE,
  factorExcelente: FACTOR_EXCELENTE,
  periodoPorDefecto: PERIODO_POR_DEFECTO,
};

// Hoy no existe una tabla de ajustes de publicidad.
// `configuracion_finanzas` solo tiene `iva_publicidad` y no sirve para
// estos topes. `overrides` ya entra para que la Fase 4 no cambie la firma.
// TODO(Fase 4): UI para editar topes por empresa, sin migración en esta PR.
export function obtenerConfigPublicidad(empresaId: string, overrides?: Partial<ConfigPublicidad>): ConfigPublicidad {
  void empresaId;
  return { ...DEFECTO, ...overrides };
}
