// Optimización, Fase 1 — una página de la lista de publicaciones de una
// cuenta. Lo de cada publicación sale de Mercado Libre (items/search y
// /items?ids=); las ventas de los últimos 7 días, de lo que Seller ya
// guarda. Visitas, calidad y competencia van aparte (una llamada por
// publicación): las pide la tabla después de mostrarse
// (app/panel/optimizacion/actions.ts).

import { and, eq, ilike, or } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { publicaciones } from "@/db/schema";
import { buscarItemsPorSkuMl, leerItemsOptimizacionMl, listarItemsVendedorMl, PATRON_ID_PRODUCTO_O_ITEM, type ItemOptimizacionMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { DIAS_METRICAS, TAMANO_PAGINA, type FiltroEstado } from "@/lib/optimizacion/textos";
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

export async function leerPaginaOptimizacion(
  empresaId: string,
  cuenta: { id: string; cuentaIdExterna: string },
  filtros: { estado: FiltroEstado; texto: string; pagina: number },
  ahora: Date
): Promise<PaginaOptimizacion> {
  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
  let items: ItemOptimizacionMl[];
  let total: number;
  let omitidas = 0;

  if (filtros.texto) {
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

  const desde = new Date(ahora.getTime() - DIAS_METRICAS * 86_400_000);
  const ventas = await ventasRecientesPorItem(
    empresaId,
    cuenta.id,
    items.map((i) => i.id),
    desde
  );
  return {
    filas: items.map((item) => ({ ...item, ventas: ventas.get(item.id) ?? { ventas: 0, unidades: 0 } })),
    total,
    pagina: filtros.pagina,
    paginas: Math.max(1, Math.ceil(total / TAMANO_PAGINA)),
    busquedaLocal: Boolean(filtros.texto),
    omitidas,
  };
}
