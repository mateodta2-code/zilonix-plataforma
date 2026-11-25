// Posventa-Mensajes (Refs #645) — filtros de la lista, puros. Todo sale de
// la URL, así que se valida contra listas blancas.
import type { EstadoConversacion } from "@/lib/ml/mensajesPosventa";

export const TAMANO_PAGINA = 10;
export type EstadoFiltro = "sin_leer" | "por_responder" | "respondido";
export const ESTADOS_FILTRO: EstadoFiltro[] = ["sin_leer", "por_responder", "respondido"];

export type FilaVenta = {
  cuentaId: string;
  cuentaNick: string;
  siteId: string | null;
  ordenId: string;
  fecha: string;
  titulo: string;
  foto: string | null;
  precio: number | null;
  cantidad: number | null;
  moneda: string;
  estadoVenta: string;
  estadoMensaje: EstadoConversacion;
};

export type Filtros = { estado: EstadoFiltro | null; q: string; desde: string | null; pagina: number };

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function uno(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function leerFiltros(sp: Record<string, string | string[] | undefined>): Filtros {
  const estado = uno(sp.estado);
  const desde = uno(sp.desde);
  const pagina = Number.parseInt(uno(sp.pagina), 10);
  return {
    estado: (ESTADOS_FILTRO as string[]).includes(estado) ? (estado as EstadoFiltro) : null,
    q: uno(sp.q).trim().slice(0, 80),
    desde: PATRON_FECHA.test(desde) && Number.isFinite(Date.parse(desde)) ? desde : null,
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

// «Leídos / Respondidos» agrupa lo respondido y lo que no necesita respuesta.
export function contarEstados(filas: FilaVenta[]): Record<EstadoFiltro, number> {
  const c = { sin_leer: 0, por_responder: 0, respondido: 0 };
  for (const f of filas) {
    if (f.estadoMensaje === "sin_leer") c.sin_leer++;
    else if (f.estadoMensaje === "por_responder") c.por_responder++;
    else if (f.estadoMensaje === "respondido") c.respondido++;
  }
  return c;
}

export function filtrarFilas(filas: FilaVenta[], f: Filtros): FilaVenta[] {
  const q = f.q.toLowerCase();
  return filas.filter((x) => {
    if (f.estado && x.estadoMensaje !== f.estado) return false;
    if (q && !x.ordenId.includes(q) && !x.titulo.toLowerCase().includes(q)) return false;
    if (f.desde && Date.parse(x.fecha) < Date.parse(`${f.desde}T00:00:00-05:00`)) return false;
    return true;
  });
}

export function paginar<T>(filas: T[], pagina: number): { filas: T[]; pagina: number; paginas: number } {
  const paginas = Math.max(1, Math.ceil(filas.length / TAMANO_PAGINA));
  const actual = Math.min(pagina, paginas);
  return { filas: filas.slice((actual - 1) * TAMANO_PAGINA, actual * TAMANO_PAGINA), pagina: actual, paginas };
}
