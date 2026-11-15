// Tabla consolidada de "Análisis del nicho" (pestaña Demanda). Puro,
// sin React ni fetch: arma las filas a partir de los bloques ya
// escaneados, usando SOLO la lógica de estimación que ya existe
// (estimarAproximadosListado + antiguedadDias). Nunca inventa un dato:
// sin vendidos o sin antigüedad la celda queda en null ("—" en pantalla).
import { antiguedadDias, type PuntoCalibracionId } from "@/lib/seguimiento/aproximados";
import { estimarAproximadosListado, type Bloque, type ProductoListado } from "@/lib/ml/listadoCliente";
import { datosSitioMl, esSiteIdValido, SITE_ID_DEFECTO } from "@/lib/ml/sitios";

export type FilaNicho = {
  clave: string;
  orden: number; // posición de primera aparición (para la columna "#")
  termino: string;
  titulo: string;
  link: string | null;
  foto: string | null;
  precio: number;
  siteId: string;
  origen: "Full" | null;
  vendidos: number | null;
  antiguedadDias: number | null;
  ventasMes: number | null;
  factMes: number | null;
  itemId: string | null;
  faltaVendidos: boolean;
};

export type ColumnaNicho = "orden" | "foto" | "titulo" | "precio" | "origen" | "antiguedad" | "ventasMes" | "factMes";
export type DireccionOrden = "asc" | "desc";

export type TotalesNicho = { siteId: string; vendidos: number | null; ventasMes: number | null; factMes: number | null; hayOtrosPaises: boolean };

export const COLUMNA_ORDEN_DEFECTO: ColumnaNicho = "factMes";

// Prefijo de país del id real de ML (MCO123…, MLM123…). Sin prefijo
// válido cae al default, igual que datosSitioMl.
export function siteIdDeItemId(itemId: string | null): string | null {
  if (!itemId) return null;
  const m = /^([A-Z]{3})\d/.exec(itemId);
  return m && esSiteIdValido(m[1]) ? m[1] : null;
}

// "4 m", "2.3 a" — días → unidad corta, con el separador decimal del idioma.
export function formatearAntiguedad(dias: number | null, idioma: unknown = datosSitioMl(SITE_ID_DEFECTO).idioma): string {
  if (dias == null || !Number.isFinite(dias) || dias < 0) return "—";
  if (dias < 30) return `${Math.max(1, Math.round(dias))} d`;
  const fmt = (n: number) => new Intl.NumberFormat(typeof idioma === "string" ? idioma : undefined, { maximumFractionDigits: 1 }).format(n);
  if (dias < 365) return `${fmt(Math.round(dias / 30.4375))} m`;
  return `${fmt(Math.round((dias / 365.25) * 10) / 10)} a`;
}

function claveFila(p: ProductoListado): string {
  return p.itemId ?? (p.productId ? `p:${p.productId}` : (p.link ?? `${p.plataforma}|${p.titulo}`));
}

function puntaje(f: FilaNicho): number {
  return [f.vendidos, f.antiguedadDias, f.ventasMes, f.factMes].filter((v) => v != null).length;
}

export function terminosDeBloques(bloques: Bloque[]): string[] {
  return [...new Set(bloques.filter((b) => b.plataforma.startsWith("Mercado Libre")).map((b) => b.termino))];
}

// Una fila por publicación; dedupe por itemId (o id de catálogo/link
// si no hay itemId). Con duplicados gana la fila con más datos.
// `termino` null = todos los términos juntos.
export function construirFilasNicho(bloques: Bloque[], ahora: Date, termino: string | null = null, puntos?: PuntoCalibracionId[]): FilaNicho[] {
  const porClave = new Map<string, FilaNicho>();
  for (const bloque of bloques) {
    if (!bloque.plataforma.startsWith("Mercado Libre")) continue;
    if (termino != null && bloque.termino !== termino) continue;
    for (const p of bloque.productos) {
      const clave = claveFila(p);
      const est = estimarAproximadosListado(p, ahora, puntos);
      const idParaAntiguedad = p.itemId ?? p.productId;
      const dias =
        p.dateCreated != null || idParaAntiguedad != null
          ? antiguedadDias({ dateCreated: p.dateCreated ?? null, mlId: idParaAntiguedad, recursoMl: p.itemId != null ? "item" : p.productId != null ? "product" : null, ahora, puntos })
          : null;
      const fila: FilaNicho = {
        clave,
        orden: porClave.size,
        termino: bloque.termino,
        titulo: p.titulo,
        link: p.link,
        foto: p.foto,
        precio: p.precio,
        siteId: siteIdDeItemId(p.itemId) ?? siteIdDeItemId(p.productId) ?? SITE_ID_DEFECTO,
        origen: p.esFull === true ? "Full" : null,
        vendidos: p.senalVentas.tipo === "acumulado_sin_periodo" ? p.senalVentas.valor : null,
        antiguedadDias: dias,
        ventasMes: est.ventasMesEst,
        factMes: est.facturacionMesEst,
        itemId: p.itemId,
        faltaVendidos: p.senalVentas.tipo === "ausente" && p.itemId != null && p.link != null,
      };
      const previa = porClave.get(clave);
      if (!previa) porClave.set(clave, fila);
      else if (puntaje(fila) > puntaje(previa)) porClave.set(clave, { ...fila, orden: previa.orden });
    }
  }
  return [...porClave.values()];
}

function valorColumna(f: FilaNicho, c: ColumnaNicho): number | string | null {
  switch (c) {
    case "orden":
      return f.orden;
    case "foto":
      return f.foto ? 1 : 0;
    case "titulo":
      return f.titulo.toLowerCase();
    case "precio":
      return f.precio;
    case "origen":
      return f.origen;
    case "antiguedad":
      return f.antiguedadDias;
    case "ventasMes":
      return f.ventasMes;
    case "factMes":
      return f.factMes;
  }
}

// Sin dato siempre al final (sea asc o desc); empates por orden de aparición.
export function ordenarFilasNicho(filas: FilaNicho[], columna: ColumnaNicho = COLUMNA_ORDEN_DEFECTO, direccion: DireccionOrden = "desc"): FilaNicho[] {
  const signo = direccion === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    const va = valorColumna(a, columna);
    const vb = valorColumna(b, columna);
    if (va == null && vb == null) return a.orden - b.orden;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
    return cmp !== 0 ? cmp * signo : a.orden - b.orden;
  });
}

export function direccionInicial(columna: ColumnaNicho): DireccionOrden {
  return columna === "titulo" || columna === "origen" || columna === "orden" ? "asc" : "desc";
}

// Totales solo del país dominante (nunca se suman monedas distintas).
export function totalesNicho(filas: FilaNicho[]): TotalesNicho {
  const conteo = new Map<string, number>();
  for (const f of filas) conteo.set(f.siteId, (conteo.get(f.siteId) ?? 0) + 1);
  const siteId = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? SITE_ID_DEFECTO;
  const delSitio = filas.filter((f) => f.siteId === siteId);
  const suma = (pick: (f: FilaNicho) => number | null): number | null => {
    const v = delSitio.map(pick).filter((n): n is number => n != null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  return { siteId, vendidos: suma((f) => f.vendidos), ventasMes: suma((f) => f.ventasMes), factMes: suma((f) => f.factMes), hayOtrosPaises: conteo.size > 1 };
}
