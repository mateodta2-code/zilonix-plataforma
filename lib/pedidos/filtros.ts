import { normalizarParametro, normalizarTextoBusqueda, parsearPagina, rangoDiaBogota } from "@/lib/filtros-listado";
import { resolverRangoVentas } from "@/lib/finanzas/ventas-pantalla";
import { parsearMarketplace, type Marketplace } from "./marketplace";
import { parsearEstadoUnificado, type EstadoUnificado } from "./estados";

// Issue #422 — filtros de /panel/pedidos, todos desde la URL y todos por
// lista blanca: lo que no se reconoce se ignora (vuelve al valor por
// defecto), nunca llega a la consulta. Sin base ni React: se prueba solo.

export const TAMANO_PAGINA_PEDIDOS = 50;
// Cada página lee (página × 50) + 1 filas de cada marketplace (ver
// lib/pedidos/listado.ts); el tope evita que ?pagina=9999 lea medio
// millón de filas. Más allá de esto se acortan las fechas.
export const PAGINA_MAXIMA_PEDIDOS = 200;

export const PERIODOS = [
  { valor: "hoy", etiqueta: "Hoy" },
  { valor: "ayer", etiqueta: "Ayer" },
  { valor: "semana", etiqueta: "Esta semana" },
  { valor: "mes", etiqueta: "Este mes" },
  { valor: "personalizado", etiqueta: "Personalizado" },
] as const;
export type Periodo = (typeof PERIODOS)[number]["valor"];

export type CuentaFiltro = { id: string; nickname: string };
export type CuentasEmpresa = { ml: CuentaFiltro[]; falabella: CuentaFiltro[] };
export type Tienda = { marketplace: "ml" | "falabella"; id: string };

export type FiltrosPedidos = {
  periodo: Periodo;
  desde?: string;
  hasta?: string;
  rango: { inicio: Date; finExclusivo: Date } | null;
  error?: string;
  marketplace: Marketplace;
  tienda: Tienda | null;
  estado: EstadoUnificado | null;
  q: string | null;
  pagina: number;
};

type Params = Record<string, string | string[] | undefined>;

const DIA_MS = 24 * 60 * 60 * 1000;

function parsearPeriodo(valor: string | undefined, hayFechas: boolean): Periodo {
  if (PERIODOS.some((p) => p.valor === valor)) return valor as Periodo;
  // Un enlace viejo con ?desde=&hasta= (el detalle anterior) sigue
  // funcionando como rango personalizado.
  return hayFechas ? "personalizado" : "mes";
}

// "Esta semana" empieza el lunes (calendario de Bogotá) e incluye hoy.
function rangoSemanaBogota(ahora: Date): { inicio: Date; finExclusivo: Date } {
  const hoy = rangoDiaBogota(ahora);
  const diaSemana = new Date(ahora.getTime() - 5 * 60 * 60 * 1000).getUTCDay();
  const diasDesdeLunes = (diaSemana + 6) % 7;
  return { inicio: new Date(hoy.inicio.getTime() - diasDesdeLunes * DIA_MS), finExclusivo: hoy.finExclusivo };
}

// La tienda llega como "ml:<id>" o "falabella:<id>" y solo se acepta si
// ese id es una cuenta de ESTA empresa (la lista viene de la base, por
// RLS). Si choca con el marketplace elegido, se descarta.
function parsearTienda(valor: string | undefined, cuentas: CuentasEmpresa, marketplace: Marketplace): Tienda | null {
  if (!valor) return null;
  const [mk, id] = valor.split(":");
  if (mk !== "ml" && mk !== "falabella") return null;
  if (!cuentas[mk].some((c) => c.id === id)) return null;
  if (marketplace !== "todos" && marketplace !== mk) return null;
  return { marketplace: mk, id };
}

export function parsearFiltrosPedidos(params: Params, cuentas: CuentasEmpresa, ahora: Date): FiltrosPedidos {
  const desde = normalizarParametro(params.desde);
  const hasta = normalizarParametro(params.hasta);
  const periodo = parsearPeriodo(normalizarParametro(params.periodo), Boolean(desde || hasta));
  const marketplace = parsearMarketplace(params.marketplace);

  let rango: FiltrosPedidos["rango"] = null;
  let error: string | undefined;
  if (periodo === "hoy") rango = rangoDiaBogota(ahora);
  else if (periodo === "ayer") rango = rangoDiaBogota(new Date(ahora.getTime() - DIA_MS));
  else if (periodo === "semana") rango = rangoSemanaBogota(ahora);
  else {
    // "mes" y "personalizado" usan el mismo resolver que Finanzas
    // (valida AAAA-MM-DD reales y el tope de días).
    const r = periodo === "mes" ? resolverRangoVentas(undefined, undefined, ahora) : resolverRangoVentas(desde, hasta, ahora);
    if (r.rango) rango = { inicio: r.rango.inicio, finExclusivo: r.rango.finExclusivo };
    else error = r.error;
  }

  return {
    periodo,
    desde: periodo === "personalizado" ? desde : undefined,
    hasta: periodo === "personalizado" ? hasta : undefined,
    rango,
    error,
    marketplace,
    tienda: parsearTienda(normalizarParametro(params.tienda), cuentas, marketplace),
    estado: parsearEstadoUnificado(normalizarParametro(params.estado)),
    q: normalizarTextoBusqueda(normalizarParametro(params.q)),
    pagina: Math.min(parsearPagina(normalizarParametro(params.pagina)), PAGINA_MAXIMA_PEDIDOS),
  };
}

// Qué marketplaces se consultan, según marketplace y tienda.
export function fuentesDeFiltros(f: Pick<FiltrosPedidos, "marketplace" | "tienda">): { ml: boolean; falabella: boolean } {
  return {
    ml: f.marketplace !== "falabella" && (!f.tienda || f.tienda.marketplace === "ml"),
    falabella: f.marketplace !== "ml" && (!f.tienda || f.tienda.marketplace === "falabella"),
  };
}

// Href que conserva los filtros válidos (nunca el texto crudo de la URL).
export function hrefPedidos(f: FiltrosPedidos, pagina: number): string {
  const params = new URLSearchParams();
  if (f.periodo !== "mes") params.set("periodo", f.periodo);
  if (f.desde) params.set("desde", f.desde);
  if (f.hasta) params.set("hasta", f.hasta);
  if (f.marketplace !== "todos") params.set("marketplace", f.marketplace);
  if (f.tienda) params.set("tienda", `${f.tienda.marketplace}:${f.tienda.id}`);
  if (f.estado) params.set("estado", f.estado);
  if (f.q) params.set("q", f.q);
  if (pagina > 1) params.set("pagina", String(pagina));
  const query = params.toString();
  return query ? `/panel/pedidos?${query}` : "/panel/pedidos";
}
