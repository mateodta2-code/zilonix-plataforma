// Optimización — tarjetas de alerta como las de Mercado Libre (Central de
// vendedores → Publicaciones). Lógica pura: sin base ni Mercado Libre.
// Los textos son los de Mercado Libre. «Con oportunidad de automatización»
// y «Con cambio…» NO se inventan: faltan su dato y su texto completo.

export type ClaveAlerta = "sin_stock" | "calidad" | "moderadas" | "competencia" | "precio_alto";

export type AlertaPublicaciones = {
  clave: ClaveAlerta;
  titulo: string;
  texto: string;
  // null = «no se pudo leer»: se muestra «—», nunca un 0 inventado.
  cantidad: number | null;
  // Solo si se revisó una parte (topes de llamadas a Mercado Libre).
  revisadas?: { hechas: number; total: number };
};

export const CLAVES_ALERTA: readonly ClaveAlerta[] = ["sin_stock", "calidad", "moderadas", "competencia", "precio_alto"];

const TEXTOS: Record<ClaveAlerta, { titulo: string; texto: string }> = {
  sin_stock: { titulo: "Sin stock", texto: "Agrega unidades para poder vender." },
  calidad: { titulo: "Con objetivos de calidad por lograr", texto: "Revisa qué puedes hacer para tener publicaciones con más calidad." },
  moderadas: { titulo: "Inactivas por incumplir políticas", texto: "Conoce qué pasó para evitar nuevas infracciones." },
  competencia: { titulo: "Para ganar la competencia en Mercado Libre", texto: "Revisa qué debes hacer para ser el vendedor destacado." },
  precio_alto: { titulo: "Con precio alto", texto: "Ajusta las publicaciones donde tu precio es más caro que el de tu competencia." },
};

export function tituloAlerta(clave: ClaveAlerta): string {
  return TEXTOS[clave].titulo;
}

// Lista blanca del ?alerta= de la URL.
export function leerFiltroAlerta(valor: unknown): ClaveAlerta | null {
  return CLAVES_ALERTA.find((c) => c === valor) ?? null;
}

export function esPrecioAlto(estado: string | null | undefined): boolean {
  return estado === "with_benchmark_highest" || estado === "with_benchmark_high";
}

export function pierdeCompetencia(estado: string | null | undefined): boolean {
  return estado === "competing" || estado === "sharing_first_place" || estado === "listed";
}

type EntradaAlerta = { cantidad: number | null; revisadas?: { hechas: number; total: number } | null };

// Orden de Mercado Libre: sin stock, calidad, moderadas, competencia, precio alto. «revisadas»
// solo se agrega si se revisó menos de lo que había.
export function armarAlertas(entrada: Record<ClaveAlerta, EntradaAlerta>): AlertaPublicaciones[] {
  return CLAVES_ALERTA.map((clave) => {
    const { cantidad, revisadas } = entrada[clave];
    const alerta: AlertaPublicaciones = { clave, ...TEXTOS[clave], cantidad };
    if (revisadas && revisadas.hechas < revisadas.total) alerta.revisadas = revisadas;
    return alerta;
  });
}
