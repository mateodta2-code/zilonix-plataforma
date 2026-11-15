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
  // Origen que la tarjeta de ML ya muestra; null = no se pudo saber (se pinta "—").
  origen: "Internacional" | "Local" | null;
  esFull: boolean;
  vendedor: string | null;
  tiendaOficial: boolean;
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
        origen: p.internacional === true ? "Internacional" : p.internacional === false ? "Local" : null,
        esFull: p.esFull === true,
        vendedor: p.vendedor,
        tiendaOficial: p.tiendaOficial === true,
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

// ---------------------------------------------------------------------
// Análisis del nicho: puntaje, concentración y precio recomendado.
// Todo se calcula sobre las filas del país dominante (nunca se mezclan
// monedas) y devuelve null cuando no hay datos suficientes, nunca un
// número inventado.
// ---------------------------------------------------------------------

export const MIN_FILAS_ANALISIS = 5;
export const UMBRAL_CONCENTRACION = 60; // % de ventas/mes de los 3 primeros

function delPais(filas: FilaNicho[]): { siteId: string; filas: FilaNicho[] } {
  const { siteId } = totalesNicho(filas);
  return { siteId, filas: filas.filter((f) => f.siteId === siteId) };
}

// Precio "medio" de referencia por país, en SU moneda, solo para saber si
// el precio promedio del nicho es bajo o alto para ese mercado. Son
// valores de calibración aproximados (no un dato de Mercado Libre):
// ajustarlos aquí si el puntaje sale sesgado en algún país.
const PRECIO_REFERENCIA: Readonly<Record<string, number>> = { MCO: 80_000, MLM: 400, MLB: 100, MLA: 20_000, MLC: 20_000 };

export type PuntajeNicho = { valor: number; frase: string; demanda: number; competencia: number; precio: number };

const acotar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Puntaje del nicho de 1 a 10 (entero). Suma de tres partes:
 *  - Demanda (0 a 4): 4 × log10(1 + ventas/mes totales) / 4. Con 100 ventas/mes
 *    da 2; con 1.000, 3; con 10.000 o más, 4 (tope).
 *  - Competencia (0 a 4): 4 × (1 − intensidad). intensidad = 0,6 × (log10 de
 *    vendedores distintos / log10 150) + 0,4 × (proporción de publicaciones
 *    Full o de tienda oficial). Sin dato de vendedor se usa la cantidad de
 *    publicaciones. Más vendedores y más Full/oficiales = más competido.
 *  - Precio (0 a 2): 1 + 0,5 × log2(precio promedio / precio de referencia
 *    del país), acotado a 0–2. Un ticket más alto deja más margen.
 * Resultado = redondeo de la suma, acotado a 1–10. Con menos de
 * MIN_FILAS_ANALISIS publicaciones con ventas/mes estimadas devuelve null.
 */
export function puntajeNicho(filas: FilaNicho[]): PuntajeNicho | null {
  const { siteId, filas: f } = delPais(filas);
  const conVentas = f.filter((x) => x.ventasMes != null);
  if (conVentas.length < MIN_FILAS_ANALISIS) return null;

  const ventas = conVentas.reduce((a, x) => a + (x.ventasMes as number), 0);
  const demanda = 4 * acotar(Math.log10(1 + ventas) / 4, 0, 1);

  const vendedores = new Set(f.map((x) => x.vendedor).filter((v): v is string => Boolean(v))).size;
  const nVendedores = vendedores > 0 ? vendedores : f.length;
  const pesoFuertes = f.filter((x) => x.esFull || x.tiendaOficial).length / f.length;
  const intensidad = 0.6 * acotar(Math.log10(Math.max(1, nVendedores)) / Math.log10(150), 0, 1) + 0.4 * pesoFuertes;
  const competencia = 4 * (1 - intensidad);

  const promedio = f.reduce((a, x) => a + x.precio, 0) / f.length;
  const ref = PRECIO_REFERENCIA[siteId] ?? PRECIO_REFERENCIA[SITE_ID_DEFECTO];
  const precio = acotar(1 + 0.5 * Math.log2(Math.max(promedio, 1e-9) / ref), 0, 2);

  const valor = acotar(Math.round(demanda + competencia + precio), 1, 10);
  const frase = valor >= 7 ? "Buena oportunidad" : valor >= 5 ? "Oportunidad moderada" : valor >= 3 ? "Competido" : "Difícil";
  return { valor, frase, demanda, competencia, precio };
}

export const EXPLICACION_PUNTAJE =
  "Suma demanda (ventas/mes totales), competencia (vendedores y peso de Full y tiendas oficiales) y precio promedio. Es una guía basada en estimados.";

export type Concentracion = { porcentaje: number; concentrado: boolean };

// % de las ventas/mes que se llevan las 3 publicaciones con más ventas/mes.
export function concentracionTop3(filas: FilaNicho[]): Concentracion | null {
  const v = delPais(filas)
    .filas.map((x) => x.ventasMes)
    .filter((n): n is number => n != null && n > 0)
    .sort((a, b) => b - a);
  if (v.length < 4) return null; // con 3 o menos, el 100 % no dice nada
  const total = v.reduce((a, b) => a + b, 0);
  const porcentaje = Math.round((v.slice(0, 3).reduce((a, b) => a + b, 0) / total) * 100);
  return { porcentaje, concentrado: porcentaje > UMBRAL_CONCENTRACION };
}

export const TRAMOS_PRECIO = 6;

// Rango de precio con más ventas/mes. Se dividen los precios en
// TRAMOS_PRECIO tramos de igual ancho entre el mínimo y el máximo (sin el
// 5 % más barato y el 5 % más caro, para que un precio extremo no estire
// los tramos) y gana el tramo con mayor suma de ventas/mes. El rango
// mostrado va del precio más bajo al más alto de las publicaciones de ese tramo.
export function precioRecomendado(filas: FilaNicho[]): { desde: number; hasta: number; siteId: string } | null {
  const { siteId, filas: f } = delPais(filas);
  const datos = f.filter((x) => x.ventasMes != null && x.ventasMes > 0);
  if (datos.length < MIN_FILAS_ANALISIS) return null;
  const precios = datos.map((x) => x.precio).sort((a, b) => a - b);
  const corte = Math.floor(precios.length * 0.05);
  const min = precios[corte];
  const max = precios[precios.length - 1 - corte];
  const ancho = (max - min) / TRAMOS_PRECIO;
  const tramoDe = (p: number) => (ancho <= 0 ? 0 : acotar(Math.floor((p - min) / ancho), 0, TRAMOS_PRECIO - 1));
  const acum = new Map<number, { ventas: number; min: number; max: number }>();
  for (const x of datos) {
    if (x.precio < min || x.precio > max) continue;
    const t = tramoDe(x.precio);
    const a = acum.get(t) ?? { ventas: 0, min: Infinity, max: -Infinity };
    a.ventas += x.ventasMes as number;
    a.min = Math.min(a.min, x.precio);
    a.max = Math.max(a.max, x.precio);
    acum.set(t, a);
  }
  const mejor = [...acum.values()].sort((a, b) => b.ventas - a.ventas)[0];
  return mejor ? { desde: mejor.min, hasta: mejor.max, siteId } : null;
}
