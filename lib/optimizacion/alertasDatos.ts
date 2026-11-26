// Optimización — lectura en vivo de las tarjetas de alerta (solo GET a
// Mercado Libre, nada se guarda en la base). Cada alerta es independiente:
// si una falla, su cantidad queda en null y las demás siguen.
//
// Topes (cada llamada cuenta contra el límite de Mercado Libre):
//  - precio alto: 1 lista + máx. 50 detalles de referencia;
//  - competencia: máx. 100 activas (2 páginas) y máx. 50 de catálogo;
//  - siempre de a 3 en paralelo (EN_PARALELO) y las alertas una tras otra.

import {
  calidadItemMl,
  competenciaItemMl,
  contarItemsVendedorPorEstadoMl,
  itemsConReferenciaPrecioMl,
  leerItemsOptimizacionMl,
  listarItemsVendedorMl,
  referenciaPrecioItemMl,
  type ReferenciaPrecioItemMl,
} from "@/lib/ml/cliente";
import { armarAlertas, esPrecioAlto, pierdeCompetencia, type AlertaPublicaciones, type ClaveAlerta } from "./alertas";

export const MAXIMO_REFERENCIAS = 50;
export const MAXIMO_ACTIVAS = 100;
export const MAXIMO_CATALOGO = 50;
export const MAXIMO_CALIDAD = 50;
export const EN_PARALELO = 3;
const POR_PAGINA = 50;

type Revisadas = { hechas: number; total: number };
export type ResultadoAlerta<T = unknown> = { cantidad: number | null; revisadas?: Revisadas; ids: string[] } & T;

async function enLotes<T, R>(lista: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = [];
  for (let i = 0; i < lista.length; i += EN_PARALELO) {
    salida.push(...(await Promise.all(lista.slice(i, i + EN_PARALELO).map(fn))));
  }
  return salida;
}

// under_review + pending (dos conteos que se suman). Si falta uno, no se
// inventa: la cantidad queda en null.
export async function alertaModeradas(vendedorId: string, token: string): Promise<ResultadoAlerta> {
  const [enRevision, pendientes] = [
    await contarItemsVendedorPorEstadoMl(vendedorId, token, "under_review"),
    await contarItemsVendedorPorEstadoMl(vendedorId, token, "pending"),
  ];
  return { cantidad: enRevision === null || pendientes === null ? null : enRevision + pendientes, ids: [] };
}

export async function alertaPrecioAlto(vendedorId: string, token: string): Promise<ResultadoAlerta<{ referencias: Record<string, ReferenciaPrecioItemMl> }>> {
  const lista = await itemsConReferenciaPrecioMl(vendedorId, token);
  if (!lista) return { cantidad: null, ids: [], referencias: {} };
  const revisar = lista.ids.slice(0, MAXIMO_REFERENCIAS);
  const detalles = await enLotes(revisar, (id) => referenciaPrecioItemMl(id, token));
  // Una publicación de la lista sin detalle en ninguna (todas null) es
  // falla de Mercado Libre, no «0 con precio alto».
  if (revisar.length > 0 && detalles.every((d) => d === null)) return { cantidad: null, ids: [], referencias: {} };
  const ids: string[] = [];
  const referencias: Record<string, ReferenciaPrecioItemMl> = {};
  detalles.forEach((d, i) => {
    if (d && esPrecioAlto(d.estado)) {
      ids.push(revisar[i]);
      referencias[revisar[i]] = d;
    }
  });
  return { cantidad: ids.length, revisadas: { hechas: revisar.length, total: Math.max(lista.total, revisar.length) }, ids: ids.slice(0, POR_PAGINA), referencias };
}

// Pausadas por falta de unidades (status=paused + sub_status=out_of_stock).
// Una sola llamada: el total sale de paging.total.
export async function alertaSinStock(vendedorId: string, token: string): Promise<ResultadoAlerta> {
  try {
    const r = await listarItemsVendedorMl(vendedorId, token, { estado: "paused", subEstado: "out_of_stock", offset: 0, limite: POR_PAGINA });
    return { cantidad: r.total, ids: r.ids };
  } catch {
    return { cantidad: null, ids: [] };
  }
}

// Activas con algún objetivo de calidad sin completar (/item/{id}/performance).
// Tope: las primeras MAXIMO_CALIDAD activas, de a 3 en paralelo.
export async function alertaCalidad(vendedorId: string, token: string): Promise<ResultadoAlerta<{ pendientes: Record<string, string[]> }>> {
  const primera = await listarItemsVendedorMl(vendedorId, token, { estado: "active", offset: 0, limite: POR_PAGINA });
  const revisar = primera.ids.slice(0, MAXIMO_CALIDAD);
  const calidades = await enLotes(revisar, (id) => calidadItemMl(id, token).catch(() => null));
  if (revisar.length > 0 && calidades.every((c) => c === null)) return { cantidad: null, ids: [], pendientes: {} };
  const ids: string[] = [];
  const pendientes: Record<string, string[]> = {};
  calidades.forEach((c, i) => {
    if (c && c.pendientes.length > 0) {
      ids.push(revisar[i]);
      pendientes[revisar[i]] = c.pendientes;
    }
  });
  return { cantidad: ids.length, revisadas: { hechas: revisar.length, total: Math.max(primera.total, revisar.length) }, ids, pendientes };
}

export async function alertaCompetencia(vendedorId: string, siteId: string, token: string): Promise<ResultadoAlerta<{ estados: Record<string, string> }>> {
  const primera = await listarItemsVendedorMl(vendedorId, token, { estado: "active", offset: 0, limite: POR_PAGINA });
  let idsActivas = primera.ids;
  if (primera.total > POR_PAGINA && MAXIMO_ACTIVAS > POR_PAGINA) {
    const segunda = await listarItemsVendedorMl(vendedorId, token, { estado: "active", offset: POR_PAGINA, limite: MAXIMO_ACTIVAS - POR_PAGINA });
    idsActivas = [...idsActivas, ...segunda.ids];
  }
  idsActivas = idsActivas.slice(0, MAXIMO_ACTIVAS);
  const deCatalogo = (await leerItemsOptimizacionMl(idsActivas, token)).filter((i) => i.catalogo);
  const catalogo = deCatalogo.slice(0, MAXIMO_CATALOGO);
  const resultados = await enLotes(catalogo, (i) => competenciaItemMl(i.id, token, siteId).catch(() => null));
  const total = Math.max(primera.total, idsActivas.length);
  if (catalogo.length > 0 && resultados.every((r) => r === null)) return { cantidad: null, ids: [], estados: {} };
  const ids: string[] = [];
  const estados: Record<string, string> = {};
  resultados.forEach((r, i) => {
    if (r && pierdeCompetencia(r.estado)) {
      ids.push(catalogo[i].id);
      estados[catalogo[i].id] = r.estado as string;
    }
  });
  return { cantidad: ids.length, revisadas: { hechas: idsActivas.length - (deCatalogo.length - catalogo.length), total }, ids: ids.slice(0, POR_PAGINA), estados };
}

export type DatosAlertas = { alertas: AlertaPublicaciones[]; ids: Record<ClaveAlerta, string[]> };

async function tolerante<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.warn(`[lib/optimizacion/alertasDatos] ${error instanceof Error ? error.name : "error"}`);
    return null;
  }
}

export async function leerAlertasPublicaciones(cuenta: { cuentaIdExterna: string; siteId: string }, token: string): Promise<DatosAlertas> {
  const sinStock = await tolerante(() => alertaSinStock(cuenta.cuentaIdExterna, token));
  const calidad = await tolerante(() => alertaCalidad(cuenta.cuentaIdExterna, token));
  const moderadas = await tolerante(() => alertaModeradas(cuenta.cuentaIdExterna, token));
  const precio = await tolerante(() => alertaPrecioAlto(cuenta.cuentaIdExterna, token));
  const competencia = await tolerante(() => alertaCompetencia(cuenta.cuentaIdExterna, cuenta.siteId, token));
  const aEntrada = (r: ResultadoAlerta | null) => ({ cantidad: r?.cantidad ?? null, revisadas: r?.revisadas });
  return {
    alertas: armarAlertas({ sin_stock: aEntrada(sinStock), calidad: aEntrada(calidad), moderadas: aEntrada(moderadas), competencia: aEntrada(competencia), precio_alto: aEntrada(precio) }),
    ids: { sin_stock: sinStock?.ids ?? [], calidad: calidad?.ids ?? [], moderadas: moderadas?.ids ?? [], competencia: competencia?.ids ?? [], precio_alto: precio?.ids ?? [] },
  };
}
