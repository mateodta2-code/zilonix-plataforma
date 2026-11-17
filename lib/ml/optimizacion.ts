// Módulo Optimización — cálculos PUROS (sin base, sin red, sin país
// fijo) que comparten el listado de hoy y la página de detalle de la
// Parte 2: conversión, objetivos de calidad, estado de competencia y
// ventas por ítem en un rango de fechas cualquiera (no fijo en 7 días).
// Los números se formatean afuera con formatearMoneda / formatearNumero
// de lib/ml/sitios.ts usando el sitio de la cuenta.

// ---------- rangos de fechas ----------

export function rangoUltimosDias(dias: number, ahora: Date = new Date()): { desde: Date; hasta: Date } {
  const MS_DIA = 24 * 60 * 60 * 1000;
  return { desde: new Date(ahora.getTime() - Math.max(1, dias) * MS_DIA), hasta: ahora };
}

// ---------- ventas por ítem ----------

export type LineaVenta = { itemId: string; cantidad: number; fecha: Date; cancelada: boolean };

// Suma unidades por item_id dentro de [desde, hasta], sin contar las
// canceladas. Sirve igual para 7 días que para cualquier otro rango.
export function ventasPorItemEnRango(lineas: readonly LineaVenta[], desde: Date, hasta: Date): Record<string, number> {
  const resultado: Record<string, number> = {};
  for (const linea of lineas) {
    if (linea.cancelada) continue;
    const t = linea.fecha.getTime();
    if (t < desde.getTime() || t > hasta.getTime()) continue;
    if (!Number.isFinite(linea.cantidad) || linea.cantidad <= 0) continue;
    resultado[linea.itemId] = (resultado[linea.itemId] ?? 0) + linea.cantidad;
  }
  return resultado;
}

// Lee las órdenes crudas de GET /orders/search (respaldo cuando la
// cuenta no tiene ventas sincronizadas) y las lleva a líneas por ítem.
// Lectura defensiva: lo que no tenga la forma esperada se omite.
export function lineasDeOrdenesMl(ordenes: readonly unknown[]): LineaVenta[] {
  const lineas: LineaVenta[] = [];
  for (const orden of ordenes) {
    if (!orden || typeof orden !== "object") continue;
    const { status, date_created: fechaTexto, order_items: items } = orden as { status?: unknown; date_created?: unknown; order_items?: unknown };
    const fecha = typeof fechaTexto === "string" ? new Date(fechaTexto) : null;
    if (!fecha || Number.isNaN(fecha.getTime()) || !Array.isArray(items)) continue;
    for (const linea of items) {
      if (!linea || typeof linea !== "object") continue;
      const { item, quantity } = linea as { item?: { id?: unknown }; quantity?: unknown };
      const itemId = item && typeof item.id === "string" ? item.id : null;
      if (!itemId || typeof quantity !== "number") continue;
      lineas.push({ itemId, cantidad: quantity, fecha, cancelada: status === "cancelled" });
    }
  }
  return lineas;
}

// ---------- conversión ----------

// ventas ÷ visitas, como fracción (0.05 = 5 %). null si no hay visitas
// (nunca se estima ni se divide por cero) o si falta alguno de los dos.
export function calcularConversion(ventas: number | null, visitas: number | null): number | null {
  if (ventas == null || visitas == null || visitas <= 0) return null;
  return ventas / visitas;
}

export function formatearConversion(conversion: number | null, formatearNumero: (valor: number) => string): string {
  if (conversion == null) return "—";
  return `${formatearNumero(Math.round(conversion * 1000) / 10)} %`;
}

// ---------- calidad (GET /item/{id}/performance) ----------

export type CalidadItem = { score: number | null; nivel: string | null; objetivosPendientes: string[] };

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

// Recorre buckets → variables → rules y junta el título de cada regla
// con status PENDING. El título sale de wordings.title (o title); si no
// hay, de la clave de la regla.
export function contarObjetivosPendientes(performance: unknown): string[] {
  if (!performance || typeof performance !== "object") return [];
  const buckets = (performance as { buckets?: unknown }).buckets;
  if (!Array.isArray(buckets)) return [];
  const titulos: string[] = [];
  for (const bucket of buckets) {
    const variables = bucket && typeof bucket === "object" ? (bucket as { variables?: unknown }).variables : null;
    if (!Array.isArray(variables)) continue;
    for (const variable of variables) {
      const reglas = variable && typeof variable === "object" ? (variable as { rules?: unknown }).rules : null;
      if (!Array.isArray(reglas)) continue;
      for (const regla of reglas) {
        if (!regla || typeof regla !== "object") continue;
        const r = regla as { status?: unknown; key?: unknown; title?: unknown; wordings?: { title?: unknown } | null };
        if (r.status !== "PENDING") continue;
        titulos.push(texto(r.wordings?.title) ?? texto(r.title) ?? texto(r.key) ?? "Objetivo pendiente");
      }
    }
  }
  return titulos;
}

export function resumirCalidad(performance: unknown): CalidadItem | null {
  if (!performance || typeof performance !== "object") return null;
  const p = performance as { score?: unknown; level_wording?: unknown };
  const score = typeof p.score === "number" && Number.isFinite(p.score) ? p.score : null;
  const nivel = texto(p.level_wording);
  if (score == null && nivel == null) return null;
  return { score, nivel, objetivosPendientes: contarObjetivosPendientes(performance) };
}

// ---------- competencia (GET /items/{id}/price_to_win) ----------

export type CompetenciaItem = { texto: string; detalle: string | null };

const TEXTO_COMPETENCIA: Readonly<Record<string, string>> = {
  winning: "Ganando",
  competing: "Compitiendo",
  sharing_first_place: "Compartiendo primer lugar",
  listed: "Listada (no compite)",
};

// Solo una publicación de catálogo compite. Para las demás no se llamó a
// la API y el texto es fijo. Un estado que no está en la lista no se
// traduce a la fuerza: devuelve null (la celda dice "No disponible").
export function interpretarCompetencia(esCatalogo: boolean, priceToWin: unknown): CompetenciaItem | null {
  if (!esCatalogo) return { texto: "No compite en catálogo", detalle: null };
  if (!priceToWin || typeof priceToWin !== "object") return null;
  const { status, reason } = priceToWin as { status?: unknown; reason?: unknown };
  const traducido = typeof status === "string" ? TEXTO_COMPETENCIA[status] : undefined;
  if (!traducido) return null;
  const motivos = Array.isArray(reason) ? reason.filter((r): r is string => typeof r === "string") : typeof reason === "string" ? [reason] : [];
  return { texto: traducido, detalle: status === "listed" && motivos.length > 0 ? motivos.join(", ") : null };
}

// ---------- precio y tipo de publicación ----------

// Hay promoción solo si el precio regular es MAYOR al vigente.
export function precioConPromocion(precio: { monto: number | null; regular: number | null } | null): { vigente: number; regular: number } | null {
  if (!precio || precio.monto == null || precio.regular == null) return null;
  return precio.regular > precio.monto ? { vigente: precio.monto, regular: precio.regular } : null;
}

const TIPO_PUBLICACION: Readonly<Record<string, string>> = {
  gold_special: "Clásica",
  gold_pro: "Premium",
  gold_premium: "Oro Premium",
  gold: "Oro",
  silver: "Plata",
  bronze: "Bronce",
  free: "Gratuita",
};

// Un tipo que no está en la lista se muestra tal cual (nunca se inventa
// una traducción).
export function etiquetaTipoPublicacion(listingTypeId: string | null | undefined): string | null {
  if (!listingTypeId) return null;
  return TIPO_PUBLICACION[listingTypeId] ?? listingTypeId;
}

// ---------- filtros de la URL (?estado=&q=&pagina=&cuenta=) ----------

export const TAMANO_PAGINA_OPTIMIZACION = 50;
export const ESTADOS_FILTRO_OPTIMIZACION = ["todas", "active", "paused"] as const;
export type EstadoFiltroOptimizacion = (typeof ESTADOS_FILTRO_OPTIMIZACION)[number];
export type FiltroOptimizacion = { estado: EstadoFiltroOptimizacion; q: string; pagina: number };

function primero(valor: string | string[] | undefined): string {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor) && typeof valor[0] === "string") return valor[0];
  return "";
}

// Nunca confía en la URL: un estado desconocido cae a "todas", la
// búsqueda se recorta a 80 caracteres y la página es un entero ≥ 1.
export function leerFiltroOptimizacion(params: { estado?: string | string[]; q?: string | string[]; pagina?: string | string[] }): FiltroOptimizacion {
  const estado = primero(params.estado);
  const pagina = Number.parseInt(primero(params.pagina), 10);
  return {
    estado: (ESTADOS_FILTRO_OPTIMIZACION as readonly string[]).includes(estado) ? (estado as EstadoFiltroOptimizacion) : "todas",
    q: primero(params.q).trim().slice(0, 80),
    pagina: Number.isFinite(pagina) && pagina >= 1 ? Math.min(pagina, 10_000) : 1,
  };
}

export function hrefOptimizacion(base: { cuenta: string | null; filtro: FiltroOptimizacion }, cambios: Partial<FiltroOptimizacion> = {}): string {
  const filtro = { ...base.filtro, ...cambios };
  const params = new URLSearchParams();
  if (base.cuenta) params.set("cuenta", base.cuenta);
  if (filtro.estado !== "todas") params.set("estado", filtro.estado);
  if (filtro.q) params.set("q", filtro.q);
  if (filtro.pagina > 1) params.set("pagina", String(filtro.pagina));
  const texto = params.toString();
  return texto ? `/panel/optimizacion?${texto}` : "/panel/optimizacion";
}
