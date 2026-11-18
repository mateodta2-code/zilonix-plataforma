// Optimización, Fase 4 — comparación con los vendedores del mismo
// producto de catálogo. Pura: arma las filas y lo que te falta (en rojo).
// Un dato que Mercado Libre no entregó queda en null y no genera alerta:
// nunca se acusa de algo que no se pudo ver.

export const MAXIMO_COMPETIDORES = 10;

export type FilaComparacion = {
  itemId: string;
  propia: boolean;
  titulo: string | null;
  foto: string | null;
  precio: number | null;
  precioOriginal: number | null;
  tipoPublicacion: string | null;
  envioGratis: boolean | null;
  full: boolean | null;
  fotos: number | null;
  video: boolean | null;
  descripcion: boolean | null;
  reputacion: { nivel: string | null; lider: string | null } | null;
};

// Los más baratos primero; sin precio al final. Como máximo 10.
export function elegirCompetidores<T extends FilaComparacion>(otras: T[]): T[] {
  return [...otras]
    .sort((a, b) => (a.precio ?? Number.POSITIVE_INFINITY) - (b.precio ?? Number.POSITIVE_INFINITY))
    .slice(0, MAXIMO_COMPETIDORES);
}

function cuantos(otras: FilaComparacion[], condicion: (f: FilaComparacion) => boolean | null): number {
  return otras.filter((f) => condicion(f) === true).length;
}

export function alertasComparacion(propia: FilaComparacion, otras: FilaComparacion[]): string[] {
  const alertas: string[] = [];
  if (otras.length === 0) return alertas;
  const total = otras.length;

  const precios = otras.map((f) => f.precio).filter((p): p is number => p !== null && p > 0);
  if (propia.precio !== null && precios.length > 0) {
    const minimo = Math.min(...precios);
    if (propia.precio > minimo) {
      const pct = Math.round(((propia.precio - minimo) * 100) / minimo);
      alertas.push(`Tu precio está ${pct} % arriba del más barato.`);
    }
  }
  const conEnvio = cuantos(otras, (f) => f.envioGratis);
  if (propia.envioGratis === false && conEnvio > 0) alertas.push(`Te falta envío gratis (${conEnvio} de ${total} lo tienen).`);
  const conFull = cuantos(otras, (f) => f.full);
  if (propia.full === false && conFull > 0) alertas.push(`Te falta Full (${conFull} de ${total} lo tienen).`);
  const premium = cuantos(otras, (f) => (f.tipoPublicacion === null ? null : f.tipoPublicacion === "gold_pro"));
  if (propia.tipoPublicacion !== null && propia.tipoPublicacion !== "gold_pro" && premium > 0) {
    alertas.push(`Te faltan las cuotas de Premium (${premium} de ${total} son Premium).`);
  }
  const fotos = otras.map((f) => f.fotos).filter((n): n is number => n !== null);
  if (propia.fotos !== null && fotos.length > 0) {
    const maximo = Math.max(...fotos);
    if (propia.fotos < maximo) alertas.push(`Tienes ${propia.fotos} fotos; el que más tiene, ${maximo}.`);
  }
  const conVideo = cuantos(otras, (f) => f.video);
  if (propia.video === false && conVideo > 0) alertas.push(`Te falta video (${conVideo} de ${total} lo tienen).`);
  if (propia.descripcion === false) alertas.push("Tu publicación no tiene descripción.");
  return alertas;
}

const COLOR_NIVEL: Record<string, string> = {
  green: "verde",
  light_green: "verde claro",
  yellow: "amarillo",
  orange: "naranja",
  red: "rojo",
};
const LIDER: Record<string, string> = { platinum: "MercadoLíder Platinum", gold: "MercadoLíder Gold", silver: "MercadoLíder" };

// "5_green" + "gold" -> "Nivel 5 verde · MercadoLíder Gold". Un código
// desconocido se muestra tal cual.
export function rotuloReputacion(reputacion: { nivel: string | null; lider: string | null } | null): string {
  if (!reputacion) return "—";
  const partes: string[] = [];
  if (reputacion.nivel) {
    const m = /^(\d)_(.+)$/.exec(reputacion.nivel);
    partes.push(m ? `Nivel ${m[1]} ${COLOR_NIVEL[m[2]] ?? m[2]}` : reputacion.nivel);
  }
  if (reputacion.lider) partes.push(LIDER[reputacion.lider] ?? reputacion.lider);
  return partes.length > 0 ? partes.join(" · ") : "—";
}
