// Optimización · Rendimiento — lógica pura (sin base ni Mercado Libre):
// Pareto de ingresos, % de tráfico de Ads, CTR, conversión y medianas por
// categoría. Todo porcentaje va en 0–100.
//
// Dos errores que tenía la herramienta que estudiamos (Seltrix, 25-nov):
// su % de Ads pasaba de 100 % y sus semáforos usaban umbrales fijos
// (0,4 % y 3 %) para todas las categorías. Acá el % Ads tiene tope y los
// semáforos se comparan con la mediana de la cuenta en la misma categoría.

export type GrupoPareto = "killer" | "potencial" | "cola" | "sin_ventas";
export type TonoSemaforo = "exito" | "advertencia" | "peligro" | "neutro";

export const GRUPOS_PARETO: readonly GrupoPareto[] = ["killer", "potencial", "cola", "sin_ventas"];
export const ROTULO_GRUPO: Record<GrupoPareto, string> = { killer: "Killer", potencial: "Potencial", cola: "Cola larga", sin_ventas: "Sin ventas" };

// Lista blanca para ?grupo= : cualquier otro valor no filtra.
export function leerGrupo(valor: unknown): GrupoPareto | null {
  return typeof valor === "string" && (GRUPOS_PARETO as readonly string[]).includes(valor) ? (valor as GrupoPareto) : null;
}

export const LIMITE_KILLER = 80;
export const LIMITE_POTENCIAL = 95;
export const MINIMO_IMPRESIONES_CTR = 1000;
export const MINIMO_VISITAS_CVR = 50;
export const MINIMO_PUBLICACIONES_MEDIANA = 3;
export const FACTOR_ADVERTENCIA = 0.6;

// ---------- Pareto ----------

export type FilaPareto<T> = T & { grupo: GrupoPareto; porcentaje: number; acumulado: number | null };
export type ResumenGrupo = { cantidad: number; ingresos: number; porcentaje: number };
export type ResultadoPareto<T> = { filas: FilaPareto<T>[]; total: number; grupos: Record<GrupoPareto, ResumenGrupo> };

const aCentavos = (n: number) => Math.round(n * 100);

// Ordena por ingresos (mayor primero). Killer mientras el acumulado (ya
// contando la publicación) sea ≤ 80 % — la primera siempre es Killer aunque
// sola pase el 80 %—, Potencial hasta ≤ 95 %, Cola larga el resto. Con 0
// ingresos (o negativos) queda «Sin ventas», fuera del Pareto.
// Se compara en centavos enteros para que 80 % exacto no falle por decimales.
export function clasificarPareto<T extends { ingresos: number }>(filas: T[]): ResultadoPareto<T> {
  const ordenadas = [...filas].sort((a, b) => b.ingresos - a.ingresos);
  const total = ordenadas.reduce((s, f) => s + (f.ingresos > 0 ? aCentavos(f.ingresos) : 0), 0);
  const grupos: Record<GrupoPareto, ResumenGrupo> = {
    killer: { cantidad: 0, ingresos: 0, porcentaje: 0 },
    potencial: { cantidad: 0, ingresos: 0, porcentaje: 0 },
    cola: { cantidad: 0, ingresos: 0, porcentaje: 0 },
    sin_ventas: { cantidad: 0, ingresos: 0, porcentaje: 0 },
  };
  let acumulado = 0;
  const resultado = ordenadas.map((f, i): FilaPareto<T> => {
    if (!(f.ingresos > 0) || total === 0) {
      grupos.sin_ventas.cantidad += 1;
      return { ...f, grupo: "sin_ventas", porcentaje: 0, acumulado: null };
    }
    const centavos = aCentavos(f.ingresos);
    acumulado += centavos;
    const grupo: GrupoPareto = i === 0 || acumulado * 100 <= total * LIMITE_KILLER ? "killer" : acumulado * 100 <= total * LIMITE_POTENCIAL ? "potencial" : "cola";
    grupos[grupo].cantidad += 1;
    grupos[grupo].ingresos += centavos / 100;
    return { ...f, grupo, porcentaje: (centavos / total) * 100, acumulado: (acumulado / total) * 100 };
  });
  for (const g of GRUPOS_PARETO) grupos[g].porcentaje = total > 0 ? (aCentavos(grupos[g].ingresos) / total) * 100 : 0;
  return { filas: resultado, total: total / 100, grupos };
}

// ---------- Tráfico de Ads, CTR, conversión ----------

export type TraficoAds = { porcentaje: number; concilia: boolean; tono: TonoSemaforo };

export const AVISO_NO_CONCILIA = "Ads reporta más clics que visitas: no concilia";

// clics ÷ visitas con tope de 100 %. Si los clics de Ads superan las visitas
// (ventanas distintas, clics repetidos…) devuelve 100 % y concilia=false.
// Sin visitas (null o 0) o sin clics conocidos, no se puede saber: null.
// < 40 % éxito, 40–70 % advertencia, > 70 % peligro (dependencia alta de Ads).
export function traficoAds(clics: number | null, visitas: number | null): TraficoAds | null {
  if (clics === null || visitas === null || !(visitas > 0) || clics < 0) return null;
  const concilia = clics <= visitas;
  const porcentaje = concilia ? (clics / visitas) * 100 : 100;
  const tono: TonoSemaforo = porcentaje < 40 ? "exito" : porcentaje <= 70 ? "advertencia" : "peligro";
  return { porcentaje, concilia, tono };
}

export function ctr(clics: number | null, impresiones: number | null): number | null {
  if (clics === null || impresiones === null || !(impresiones > 0)) return null;
  return (clics / impresiones) * 100;
}

// Incluye 0 ventas (0 %): una publicación con visitas y sin ventas es justo
// la que hay que mirar.
export function cvr(ventas: number | null, visitas: number | null): number | null {
  if (ventas === null || visitas === null || !(visitas > 0)) return null;
  return (ventas / visitas) * 100;
}

// ---------- Medianas por categoría ----------

export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const o = [...valores].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
}

export type EntradaMediana = {
  categoria: string | null;
  impresiones: number | null;
  clics: number | null;
  visitas: number | null;
  ventas: number | null;
};

type Muestra = { mediana: number | null; n: number };
export type Medianas = {
  porCategoria: Map<string, { ctr: Muestra; cvr: Muestra }>;
  cuenta: { ctr: Muestra; cvr: Muestra };
};
export type MedianaElegida = { valor: number | null; deCuenta: boolean };

function muestra(valores: number[]): Muestra {
  return { mediana: mediana(valores), n: valores.length };
}

function muestrasDe(filas: EntradaMediana[]) {
  const c: number[] = [];
  const v: number[] = [];
  for (const f of filas) {
    if ((f.impresiones ?? 0) >= MINIMO_IMPRESIONES_CTR) {
      const x = ctr(f.clics ?? 0, f.impresiones);
      if (x !== null) c.push(x);
    }
    if ((f.visitas ?? 0) >= MINIMO_VISITAS_CVR) {
      const x = cvr(f.ventas ?? 0, f.visitas);
      if (x !== null) v.push(x);
    }
  }
  return { ctr: muestra(c), cvr: muestra(v) };
}

// Mediana de CTR (publicaciones con ≥ 1000 impresiones) y de CVR (con ≥ 50
// visitas), por categoría de la cuenta y de toda la cuenta (respaldo).
export function medianasPorCategoria(filas: EntradaMediana[]): Medianas {
  const grupos = new Map<string, EntradaMediana[]>();
  for (const f of filas) {
    if (!f.categoria) continue;
    const g = grupos.get(f.categoria);
    if (g) g.push(f);
    else grupos.set(f.categoria, [f]);
  }
  const porCategoria = new Map<string, { ctr: Muestra; cvr: Muestra }>();
  for (const [cat, fs] of grupos) porCategoria.set(cat, muestrasDe(fs));
  return { porCategoria, cuenta: muestrasDe(filas) };
}

// La de la categoría si tiene ≥ 3 publicaciones con muestra; si no, la de la
// cuenta (deCuenta=true, para el aviso «mediana de la cuenta»). La de la
// cuenta también pide ≥ 3: con una sola publicación sería ella misma.
export function medianaDe(m: Medianas, categoria: string | null, metrica: "ctr" | "cvr"): MedianaElegida {
  const propia = categoria ? m.porCategoria.get(categoria)?.[metrica] : undefined;
  if (propia && propia.n >= MINIMO_PUBLICACIONES_MEDIANA && propia.mediana !== null) return { valor: propia.mediana, deCuenta: false };
  const cuenta = m.cuenta[metrica];
  if (cuenta.n >= MINIMO_PUBLICACIONES_MEDIANA && cuenta.mediana !== null) return { valor: cuenta.mediana, deCuenta: true };
  return { valor: null, deCuenta: false };
}

// ≥ mediana → éxito; ≥ mediana × 0,6 → advertencia; menos → peligro. Sin
// valor o sin mediana → neutro («poca muestra»). Nunca umbrales fijos.
export function semaforo(valor: number | null, medianaRef: number | null): TonoSemaforo {
  if (valor === null || medianaRef === null) return "neutro";
  if (valor >= medianaRef) return "exito";
  return valor >= medianaRef * FACTOR_ADVERTENCIA ? "advertencia" : "peligro";
}

// Semáforo de una publicación: además de la mediana, la publicación misma
// necesita muestra (≥ 1000 impresiones para CTR, ≥ 50 visitas para CVR).
export function semaforoPublicacion(
  e: EntradaMediana,
  m: Medianas,
  metrica: "ctr" | "cvr"
): { tono: TonoSemaforo; valor: number | null; mediana: number | null; deCuenta: boolean } {
  const valor = metrica === "ctr" ? ctr(e.clics ?? 0, e.impresiones) : cvr(e.ventas ?? 0, e.visitas);
  const conMuestra = metrica === "ctr" ? (e.impresiones ?? 0) >= MINIMO_IMPRESIONES_CTR : (e.visitas ?? 0) >= MINIMO_VISITAS_CVR;
  const ref = medianaDe(m, e.categoria, metrica);
  return { tono: conMuestra ? semaforo(valor, ref.valor) : "neutro", valor, mediana: ref.valor, deCuenta: ref.deCuenta };
}
