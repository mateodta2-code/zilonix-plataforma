// Optimización, Fase 1 — textos y cálculos puros de la lista. Sin
// base de datos ni Mercado Libre: lo usan la página y el cliente.

export const DIAS_METRICAS = 7;
export const TAMANO_PAGINA = 50;

export type FiltroEstado = "activas" | "pausadas" | "todas";

export function leerFiltroEstado(valor: unknown): FiltroEstado {
  return valor === "pausadas" || valor === "todas" ? valor : "activas";
}

export function leerPagina(valor: unknown): number {
  const n = typeof valor === "string" ? Number.parseInt(valor, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export function leerBusqueda(valor: unknown): string {
  return typeof valor === "string" ? valor.trim().slice(0, 100) : "";
}

// Rótulos de códigos de Mercado Libre que la pantalla conoce. Un código
// desconocido se muestra tal cual, nunca se inventa.
const TIPO_PUBLICACION: Record<string, string> = { gold_pro: "Premium", gold_special: "Clásica", free: "Gratuita" };
const COMPETENCIA: Record<string, { rotulo: string; tono: "exito" | "advertencia" | "neutro" }> = {
  winning: { rotulo: "Ganando", tono: "exito" },
  competing: { rotulo: "Compitiendo", tono: "advertencia" },
  sharing_first_place: { rotulo: "Compartiendo", tono: "advertencia" },
};
const ESTADO_PUBLICACION: Record<string, string> = { active: "Activa", paused: "Pausada", closed: "Finalizada", under_review: "En revisión" };

export function rotuloTipoPublicacion(tipo: string | null): string {
  if (!tipo) return "—";
  return TIPO_PUBLICACION[tipo] ?? tipo;
}

export function rotuloCompetencia(estado: string | null): { rotulo: string; tono: "exito" | "advertencia" | "neutro" } {
  if (!estado) return { rotulo: "—", tono: "neutro" };
  return COMPETENCIA[estado] ?? { rotulo: estado, tono: "neutro" };
}

export function rotuloEstadoPublicacion(estado: string | null): string {
  if (!estado) return "—";
  return ESTADO_PUBLICACION[estado] ?? estado;
}

// Conversión = ventas / visitas, en porcentaje con un decimal. null si no
// hay visitas o falta un dato (nunca un 0 % inventado).
export function conversion(ventas: number | null, visitas: number | null): string | null {
  if (ventas === null || visitas === null || visitas <= 0) return null;
  const porMil = Math.round((ventas * 1000) / visitas);
  const entero = Math.floor(porMil / 10);
  const decimal = porMil % 10;
  return `${entero},${decimal} %`;
}

export function tonoCalidad(puntaje: number | null): "exito" | "advertencia" | "peligro" | "neutro" {
  if (puntaje === null) return "neutro";
  if (puntaje >= 80) return "exito";
  if (puntaje >= 50) return "advertencia";
  return "peligro";
}
