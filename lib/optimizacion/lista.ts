// Optimización, Fase 1 — una página de la lista de publicaciones de una
// cuenta. Lo de cada publicación sale de Mercado Libre (items/search y
// /items?ids=); las ventas del período (hoy, 7, 14, 30, 90 días o un rango), de lo que Seller ya
// guarda. Visitas, calidad y competencia van aparte (una llamada por
// publicación): las pide la tabla después de mostrarse
// (app/panel/optimizacion/actions.ts).

import { and, eq, ilike, or } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { publicaciones } from "@/db/schema";
import { buscarItemsPorSkuMl, leerItemsOptimizacionMl, listarItemsVendedorMl, PATRON_ID_PRODUCTO_O_ITEM, type ItemOptimizacionMl, type ReferenciaPrecioItemMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { limitesDiaBogota } from "@/lib/filtros-listado";
import type { ClaveAlerta } from "@/lib/optimizacion/alertas";
import { alertaCompetencia, alertaPrecioAlto } from "@/lib/optimizacion/alertasDatos";
import type { PeriodoLista } from "@/lib/optimizacion/periodoLista";
import { TAMANO_PAGINA, type FiltroEstado } from "@/lib/optimizacion/textos";
import { ventasRecientesPorItem, type VentasItem } from "@/lib/optimizacion/ventas";

export type FilaOptimizacion = ItemOptimizacionMl & { ventas: VentasItem | null };

export type PaginaOptimizacion = {
  filas: FilaOptimizacion[];
  total: number;
  pagina: number;
  paginas: number;
  // La búsqueda por texto usa los títulos de las publicaciones ya
  // importadas en Seller.
  busquedaLocal: boolean;
  // Publicaciones de la página que Mercado Libre no devolvió en el
  // detalle (un lote que falló): se avisan, no se esconden en silencio.
  omitidas: number;
  // Solo con ?alerta=: lo que la alerta sabe de cada publicación.
  alerta?: { clave: ClaveAlerta; referencias?: Record<string, ReferenciaPrecioItemMl>; estados?: Record<string, string> };
};

export const MAXIMO_RESULTADOS_BUSQUEDA = 200;

const ESTADO_ML: Record<FiltroEstado, "active" | "paused" | null> = { activas: "active", pausadas: "paused", todas: null };

// Para ILIKE: el texto de la persona nunca trae comodines propios.
function escaparComodines(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function idsDeBusqueda(empresaId: string, cuentaMlId: string, vendedorId: string, token: string, texto: string): Promise<string[]> {
  const mayus = texto.toUpperCase();
  if (PATRON_ID_PRODUCTO_O_ITEM.test(mayus)) return [mayus];
  const locales = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ itemId: publicaciones.publicacionIdExterno })
      .from(publicaciones)
      .where(
        and(
          eq(publicaciones.empresaId, empresaId),
          eq(publicaciones.cuentaMlId, cuentaMlId),
          or(ilike(publicaciones.titulo, `%${escaparComodines(texto)}%`), ilike(publicaciones.publicacionIdExterno, `%${escaparComodines(texto)}%`))
        )
      )
      .limit(MAXIMO_RESULTADOS_BUSQUEDA)
  );
  // El SKU se busca en Mercado Libre (seller_sku), que es donde vive.
  const porSku = await buscarItemsPorSkuMl(vendedorId, texto, token).catch(() => [] as string[]);
  // Tope: cada 20 resultados es una llamada más a Mercado Libre.
  return [...new Set([...porSku, ...locales.map((f) => f.itemId)])].filter((id) => PATRON_ID_PRODUCTO_O_ITEM.test(id)).slice(0, MAXIMO_RESULTADOS_BUSQUEDA);
}

// «Inactivas por incumplir políticas»: under_review y luego pending, como
// una sola lista paginada (los ids salen de items/search, en vivo).
async function idsModeradas(vendedorId: string, token: string, pagina: number): Promise<{ ids: string[]; total: number }> {
  const offset = (pagina - 1) * TAMANO_PAGINA;
  const enRevision = await listarItemsVendedorMl(vendedorId, token, { estado: "under_review", offset, limite: TAMANO_PAGINA });
  const ids = [...enRevision.ids];
  let total = enRevision.total;
  const pendientesOffset = Math.max(offset - enRevision.total, 0);
  if (ids.length < TAMANO_PAGINA) {
    const pendientes = await listarItemsVendedorMl(vendedorId, token, { estado: "pending", offset: pendientesOffset, limite: TAMANO_PAGINA - ids.length });
    ids.push(...pendientes.ids);
    total += pendientes.total;
  } else {
    // Página llena de under_review: solo falta el total de pending.
    total += (await listarItemsVendedorMl(vendedorId, token, { estado: "pending", offset: 0, limite: 1 })).total;
  }
  return { ids, total };
}

export async function leerPaginaOptimizacion(
  empresaId: string,
  cuenta: { id: string; cuentaIdExterna: string; siteId: string },
  filtros: { estado: FiltroEstado; texto: string; pagina: number; periodo: PeriodoLista; alerta?: ClaveAlerta | null },
  ahora: Date
): Promise<PaginaOptimizacion> {
  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
  let items: ItemOptimizacionMl[];
  let total: number;
  let omitidas = 0;
  let extraAlerta: PaginaOptimizacion["alerta"];

  // Con ?alerta= se ignoran el estado y la búsqueda.
  if (filtros.alerta) {
    let ids: string[];
    if (filtros.alerta === "moderadas") {
      const p = await idsModeradas(cuenta.cuentaIdExterna, token, filtros.pagina);
      ids = p.ids;
      total = p.total;
      extraAlerta = { clave: "moderadas" };
    } else if (filtros.alerta === "precio_alto") {
      const r = await alertaPrecioAlto(cuenta.cuentaIdExterna, token);
      ids = r.ids;
      total = r.ids.length;
      extraAlerta = { clave: "precio_alto", referencias: r.referencias };
    } else {
      const r = await alertaCompetencia(cuenta.cuentaIdExterna, cuenta.siteId, token);
      ids = r.ids;
      total = r.ids.length;
      extraAlerta = { clave: "competencia", estados: r.estados };
    }
    const porId = new Map((await leerItemsOptimizacionMl(ids, token)).map((i) => [i.id, i]));
    items = ids.flatMap((id) => {
      const item = porId.get(id);
      return item ? [item] : [];
    });
    omitidas = ids.length - items.length;
  } else if (filtros.texto) {
    // Búsqueda: se traen todos los candidatos, se filtran por estado y
    // se pagina acá.
    const ids = await idsDeBusqueda(empresaId, cuenta.id, cuenta.cuentaIdExterna, token, filtros.texto);
    const todos = await leerItemsOptimizacionMl(ids, token);
    omitidas = ids.length - todos.length;
    const estado = ESTADO_ML[filtros.estado];
    const filtrados = estado ? todos.filter((i) => i.estado === estado) : todos;
    total = filtrados.length;
    items = filtrados.slice((filtros.pagina - 1) * TAMANO_PAGINA, filtros.pagina * TAMANO_PAGINA);
  } else {
    const pagina = await listarItemsVendedorMl(cuenta.cuentaIdExterna, token, {
      estado: ESTADO_ML[filtros.estado],
      offset: (filtros.pagina - 1) * TAMANO_PAGINA,
      limite: TAMANO_PAGINA,
    });
    total = pagina.total;
    const porId = new Map((await leerItemsOptimizacionMl(pagina.ids, token)).map((i) => [i.id, i]));
    // Mismo orden que items/search.
    items = pagina.ids.flatMap((id) => {
      const item = porId.get(id);
      return item ? [item] : [];
    });
    omitidas = pagina.ids.length - items.length;
  }

  // Días completos de Bogotá: desde el inicio del primero hasta el fin del último.
  const desde = limitesDiaBogota(filtros.periodo.desde)?.inicio ?? new Date(ahora.getTime() - filtros.periodo.dias * 86_400_000);
  const hasta = limitesDiaBogota(filtros.periodo.hasta)?.finExclusivo;
  const ventas = await ventasRecientesPorItem(
    empresaId,
    cuenta.id,
    items.map((i) => i.id),
    desde,
    hasta
  );
  return {
    filas: items.map((item) => ({ ...item, ventas: ventas.get(item.id) ?? { ventas: 0, unidades: 0 } })),
    total,
    pagina: filtros.pagina,
    paginas: Math.max(1, Math.ceil(total / TAMANO_PAGINA)),
    busquedaLocal: Boolean(filtros.texto),
    omitidas,
    ...(extraAlerta ? { alerta: extraAlerta } : {}),
  };
}
