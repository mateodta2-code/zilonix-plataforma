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
// ROAS bajo este factor del objetivo: apagar y crear otra. 8,40 sobre
// 12,00 es justo el 70 % y no entra.
export const UMBRAL_ROAS_BAJO = "0.70";
// ROAS a esta altura del objetivo: el ACOS quedó holgado. La única
// sugerencia es ajustar el objetivo, nunca subir presupuesto ni bajarlo.
export const FACTOR_ROAS_HOLGADO = "1.3";
// Un anuncio en este ROAS o más, respecto del objetivo de su campaña,
// vende bien: se queda donde está. No se mueve a enfriamiento.
export const FACTOR_ROAS_VENDE_BIEN = "1.5";
export const PERIODO_POR_DEFECTO = "mes_en_curso" as const;

// Campaña a la que la pantalla sugiere pasar un anuncio que gasta y no
// vende. ANTÁRTIDA es el paso siguiente, con presupuesto mínimo y ACOS
// alto, solo si ya está en enfriamiento y sigue sin vender. Texto nada
// más: no hay botón ni llamada a Mercado Libre. El nombre se compara
// sin mayúsculas ni acentos.
export const CAMPANA_ENFRIAMIENTO = "ENFRIAMIENTO";
export const CAMPANA_ANTARTIDA = "ANTÁRTIDA";

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
