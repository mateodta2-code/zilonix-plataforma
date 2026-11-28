// Posventa-Devoluciones (Refs #648) — devoluciones de los reclamos, SOLO
// LECTURA, en vivo desde Mercado Libre. Nada del comprador se guarda en
// la base de datos ni en logs. Todas las llamadas son GET, pasan por
// lib/ml/cliente.ts y son APIs documentadas de post-purchase
// (claims/search, v2 claims/{id}/returns, returns/{id}/reviews,
// claims/{id}/charges/return-cost, reasons/{id}).

import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import { idTexto, pedirLecturaMl, textoODefecto } from "@/lib/ml/cliente";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { leerFotoItemMl, leerOrdenMl, leerReclamoMl, obtenerMotivoReclamoMl, type ProductoVenta, type ReclamoBaseMl } from "@/lib/ml/reclamos";

// Topes por carga: con muchas cuentas y usuarios, nunca una lectura sin límite.
export const TOPE_LECTURAS_DEVOLUCION = 60;
export const CONCURRENCIA_LECTURAS = 4;

// ---------- Tipos propios ----------

export type EnvioDevolucion = {
  envioId: string | null;
  estado: string | null;
  tipo: string | null;
  seguimiento: string | null;
  destino: string | null;
};

export type DevolucionMl = {
  id: string | null;
  estado: string | null;
  subtipo: string | null;
  estadoDinero: string | null;
  creada: string | null;
  actualizada: string | null;
  cerrada: string | null;
  envios: EnvioDevolucion[];
};

export type RevisionDevolucion = { fecha: string | null; estado: string | null; metodo: string | null };
export type CostoEnvioDevolucion = { monto: number; moneda: string | null };

export type ReclamoConDevolucion = ReclamoBaseMl & { relacionadas: string[] };

// ---------- Funciones puras: respuesta de ML → tipos propios ----------

export function tieneDevolucion(relacionadas: string[]): boolean {
  return relacionadas.includes("return");
}

// Una página de claims/search → reclamos CANDIDATOS a tener devolución.
// La búsqueda de ML NO trae `related_entities` (solo GET claims/{id}), así
// que si el campo no viene NO se descarta: la devolución real se confirma
// después con v2 claims/{id}/returns. Regla: se descarta solo si el campo
// SÍ viene como lista (aunque vacía), no incluye "return" y el tipo no es
// "returns". No se descarta por otros tipos: una mediación puede tener
// devolución y no se adivina.
export function esCandidatoDevolucion(base: ReclamoBaseMl, crudo: unknown): boolean {
  if (base.tipo === "returns") return true;
  if (!Array.isArray(crudo)) return true;
  return tieneDevolucion(crudo.filter((r): r is string => typeof r === "string"));
}

export function leerReclamosConDevolucionMl(data: unknown): { total: number; leidos: number; reclamos: ReclamoConDevolucion[] } {
  const cuerpo = (data && typeof data === "object" ? data : {}) as { data?: unknown; paging?: { total?: unknown } };
  const lista = Array.isArray(cuerpo.data) ? cuerpo.data : [];
  const reclamos = lista.flatMap((c): ReclamoConDevolucion[] => {
    const base = leerReclamoMl(c);
    if (!base) return [];
    const crudo = (c as Record<string, unknown>).related_entities;
    if (!esCandidatoDevolucion(base, crudo)) return [];
    const relacionadas = Array.isArray(crudo) ? crudo.filter((r): r is string => typeof r === "string") : [];
    return [{ ...base, relacionadas }];
  });
  const total = typeof cuerpo.paging?.total === "number" ? cuerpo.paging.total : lista.length;
  return { total, leidos: lista.length, reclamos };
}

function leerEnvioDevolucionMl(valor: unknown): EnvioDevolucion | null {
  if (!valor || typeof valor !== "object") return null;
  const fila = valor as Record<string, unknown>;
  const destinoCrudo = fila.destination;
  const destino =
    typeof destinoCrudo === "string"
      ? textoODefecto(destinoCrudo)
      : destinoCrudo && typeof destinoCrudo === "object"
        ? textoODefecto((destinoCrudo as Record<string, unknown>).name)
        : null;
  return {
    envioId: idTexto(fila.shipment_id) ?? idTexto(fila.id),
    estado: textoODefecto(fila.status),
    tipo: textoODefecto(fila.type) ?? textoODefecto(fila.shipment_type),
    seguimiento: textoODefecto(fila.tracking_number),
    destino,
  };
}

// GET /post-purchase/v2/claims/{id}/returns — acepta el objeto o una lista.
export function leerDevolucionMl(data: unknown): DevolucionMl | null {
  const crudo = Array.isArray(data) ? data[0] : (data as { results?: unknown[] } | null)?.results?.[0] ?? data;
  if (!crudo || typeof crudo !== "object") return null;
  const fila = crudo as Record<string, unknown>;
  const lista = Array.isArray(fila.shipments) ? fila.shipments : fila.shipping ? [fila.shipping] : [];
  const envios = lista.flatMap((e) => {
    const envio = leerEnvioDevolucionMl(e);
    return envio ? [envio] : [];
  });
  const id = idTexto(fila.id) ?? idTexto(fila.return_id);
  const estado = textoODefecto(fila.status);
  if (!id && !estado && envios.length === 0) return null;
  return {
    id,
    estado,
    subtipo: textoODefecto(fila.subtype),
    estadoDinero: textoODefecto(fila.status_money),
    creada: textoODefecto(fila.date_created),
    actualizada: textoODefecto(fila.last_updated),
    cerrada: textoODefecto(fila.date_closed),
    envios,
  };
}

// GET /post-purchase/v1/returns/{id}/reviews
export function leerRevisionesMl(data: unknown): RevisionDevolucion[] {
  const lista = Array.isArray(data) ? data : Array.isArray((data as { reviews?: unknown })?.reviews) ? (data as { reviews: unknown[] }).reviews : [];
  return lista.flatMap((r): RevisionDevolucion[] => {
    if (!r || typeof r !== "object") return [];
    const fila = r as Record<string, unknown>;
    const interno = Array.isArray(fila.resource_reviews) ? (fila.resource_reviews[0] as Record<string, unknown> | undefined) : undefined;
    return [{ fecha: textoODefecto(fila.date_created), estado: textoODefecto(fila.status) ?? textoODefecto(interno?.status), metodo: textoODefecto(fila.method) }];
  });
}

// GET /post-purchase/v1/claims/{id}/charges/return-cost
export function leerCostoEnvioMl(data: unknown): CostoEnvioDevolucion | null {
  if (!data || typeof data !== "object") return null;
  const fila = data as Record<string, unknown>;
  const monto = typeof fila.amount === "number" ? fila.amount : Number(fila.amount);
  if (fila.amount === null || fila.amount === undefined || !Number.isFinite(monto)) return null;
  return { monto, moneda: textoODefecto(fila.currency_id) };
}

// Palabras simples para la persona; un código desconocido no se inventa.
export type EstadoSimpleDevolucion = "en_camino" | "llego" | "revisada" | "cerrada" | "en_proceso";

export const ROTULOS_ESTADO_DEVOLUCION: Record<EstadoSimpleDevolucion, string> = {
  en_camino: "En camino a tu depósito",
  llego: "Llegó, revísala",
  revisada: "Revisada",
  cerrada: "Cerrada",
  en_proceso: "En proceso",
};

const ENVIO_EN_CAMINO = new Set(["pending", "ready_to_ship", "shipped", "handling", "to_be_agreed"]);

export function estadoSimpleDevolucion(dev: DevolucionMl | null, revisiones: RevisionDevolucion[] | null): EstadoSimpleDevolucion {
  if (!dev) return "en_proceso";
  if (dev.estado === "closed" || dev.estado === "expired" || dev.cerrada) return "cerrada";
  if (revisiones && revisiones.length > 0) return "revisada";
  const estados = dev.envios.map((e) => e.estado);
  if (estados.includes("delivered")) return "llego";
  if (estados.some((e) => e && ENVIO_EN_CAMINO.has(e))) return "en_camino";
  return "en_proceso";
}

const ROTULOS_ENVIO: Record<string, string> = {
  pending: "Pendiente",
  handling: "En preparación",
  ready_to_ship: "Listo para enviar",
  shipped: "En camino",
  delivered: "Entregado",
  not_delivered: "No entregado",
  cancelled: "Cancelado",
};

export function rotuloEnvioDevolucion(estado: string | null): string {
  return estado ? (ROTULOS_ENVIO[estado] ?? estado) : "Sin estado";
}

const ROTULOS_SUBTIPO: Record<string, string> = { claim: "Por reclamo", dispute: "Por mediación", automatic: "Automática" };

export function rotuloSubtipoDevolucion(subtipo: string | null): string | null {
  if (!subtipo) return null;
  return ROTULOS_SUBTIPO[subtipo] ?? subtipo;
}

// ---------- Lecturas a ML ----------

async function opcional<T>(lectura: () => Promise<T | null>): Promise<T | null> {
  try {
    return await lectura();
  } catch {
    return null;
  }
}

async function leerJson(ruta: string, token: string, query?: string): Promise<unknown | null> {
  const resp = await pedirLecturaMl<unknown>(ruta, token, query ? { query } : undefined);
  return resp.ok ? resp.data : null;
}

function exigirNumerico(valor: string): string {
  if (!/^\d{1,20}$/.test(valor)) throw new Error("Id inválido — no se llamó a Mercado Libre.");
  return valor;
}

export async function obtenerDevolucionMl(reclamoId: string, token: string): Promise<DevolucionMl | null> {
  exigirNumerico(reclamoId);
  return opcional(async () => leerDevolucionMl(await leerJson(`/post-purchase/v2/claims/${reclamoId}/returns`, token)));
}

export async function obtenerRevisionesMl(devolucionId: string, token: string): Promise<RevisionDevolucion[] | null> {
  exigirNumerico(devolucionId);
  return opcional(async () => leerRevisionesMl(await leerJson(`/post-purchase/v1/returns/${devolucionId}/reviews`, token)));
}

export async function obtenerCostoEnvioDevolucionMl(reclamoId: string, token: string): Promise<CostoEnvioDevolucion | null> {
  exigirNumerico(reclamoId);
  return opcional(async () => leerCostoEnvioMl(await leerJson(`/post-purchase/v1/claims/${reclamoId}/charges/return-cost`, token)));
}

// Búsqueda de reclamos (28-nov). La v1 con «players.role / players.user_id /
// range / sort» respondía 400 en las tres cuentas de sharel (log de
// staging, PR #764), y lib/ml/cliente.ts ya tenía confirmado que
// /marketplace/v2/claims/search responde 400 «sin filtro, o con players».
// Se usa la ÚNICA forma confirmada en producción (la de Reclamos y
// mediaciones, buscarReclamosAbiertosMl): status=opened y limit ≤ 30, del
// vendedor del token. Consecuencia: solo entran reclamos abiertos (una
// devolución en camino tiene su reclamo abierto); las ya cerradas dejan de
// listarse hasta confirmar otro filtro con una cuenta real. El corte por
// fecha se hace después, en cargarDevolucionesEmpresa.
export const RUTA_BUSQUEDA_RECLAMOS = "/marketplace/v2/claims/search";
export const TAMANO_BUSQUEDA_V2 = 30;

export function armarQueryBusquedaReclamos(): string {
  return `?status=opened&limit=${TAMANO_BUSQUEDA_V2}`;
}

// Reclamos abiertos del vendedor del token, candidatos a tener devolución
// (se confirma aparte con v2 claims/{id}/returns). Una sola llamada:
// `truncado` = ML tiene más de los que se leyeron. Si falla, lanza: la
// cuenta queda «sin revisar». sellerId solo se valida (el token ya dice
// de quién son los reclamos).
export async function buscarReclamosConDevolucionMl(token: string, sellerId: string): Promise<{ reclamos: ReclamoConDevolucion[]; truncado: boolean }> {
  exigirNumerico(sellerId);
  const resp = await pedirLecturaMl<unknown>(RUTA_BUSQUEDA_RECLAMOS, token, { query: armarQueryBusquedaReclamos() });
  if (!resp.ok) throw new Error(`Mercado Libre respondió ${resp.status} al listar los reclamos.`);
  const lectura = leerReclamosConDevolucionMl(resp.data);
  return { reclamos: lectura.reclamos, truncado: lectura.total > lectura.leidos };
}

// ---------- Orquestación por empresa (lista y métricas) ----------

export type FilaDevolucion = {
  cuentaMlId: string;
  nickname: string;
  siteId: string | null;
  reclamo: ReclamoConDevolucion;
  devolucion: DevolucionMl | null;
  revisiones: RevisionDevolucion[] | null;
  estado: EstadoSimpleDevolucion;
};

export type CargaDevoluciones = {
  filas: FilaDevolucion[];
  // Reclamos candidatos del periodo que no se alcanzaron a leer (pueden o no tener devolución).
  sinLeerDetalle: number;
  truncado: boolean;
  cuentasSinRevisar: { nickname: string; motivo: string }[];
};

function fechaMs(iso: string | null): number {
  return iso ? Date.parse(iso) || 0 : 0;
}

// Lee las cuentas de la empresa (RLS), una a la vez, y completa la
// devolución de los `TOPE_LECTURAS_DEVOLUCION` reclamos más recientes con
// concurrencia acotada. `cuentaId` ya debe ser de la empresa (viene de
// leerCuentaMlDeQuery); aquí además se filtra contra listarCuentasConectadas.
export async function cargarDevolucionesEmpresa(empresaId: string, opciones: { cuentaId: string | null; desdeMs: number | null }): Promise<CargaDevoluciones> {
  const cuentas = (await listarCuentasConectadas(empresaId)).filter((c) => !c.desconectadaTs && (!opciones.cuentaId || c.id === opciones.cuentaId));
  const cuentasSinRevisar: CargaDevoluciones["cuentasSinRevisar"] = [];
  let truncado = false;
  const candidatos: { cuenta: (typeof cuentas)[number]; token: string; reclamo: ReclamoConDevolucion }[] = [];

  for (const cuenta of cuentas) {
    try {
      const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
      const busqueda = await buscarReclamosConDevolucionMl(token, cuenta.cuentaIdExterna);
      truncado = truncado || busqueda.truncado;
      for (const reclamo of busqueda.reclamos) {
        if (opciones.desdeMs !== null && fechaMs(reclamo.fecha) < opciones.desdeMs) continue;
        candidatos.push({ cuenta, token, reclamo });
      }
    } catch (error) {
      // Nunca el token ni el cuerpo de ML. Los errores propios de este
      // archivo («Mercado Libre respondió 400 al listar los reclamos.»,
      // «Id inválido…») solo traen el código: se loguean para saber por
      // qué falla una cuenta (28-nov: las tres de sharel fallaban sin pista).
      const detalle = error instanceof Error && error.name === "Error" && /^(Mercado Libre respondió \d{3}|Id inválido)/.test(error.message) ? ` — ${error.message}` : "";
      console.warn(`[lib/ml/devoluciones] cuenta ${cuenta.id}: ${error instanceof Error ? error.name : "error"}${detalle}`);
      cuentasSinRevisar.push({ nickname: cuenta.nickname, motivo: motivoCuentaSinRevisar(error) });
    }
  }

  candidatos.sort((a, b) => fechaMs(b.reclamo.fecha) - fechaMs(a.reclamo.fecha));
  const aLeer = candidatos.slice(0, TOPE_LECTURAS_DEVOLUCION);
  const todas = await conConcurrenciaLimitada(aLeer, CONCURRENCIA_LECTURAS, async ({ cuenta, token, reclamo }): Promise<FilaDevolucion> => {
    const devolucion = await obtenerDevolucionMl(reclamo.id, token);
    const cerrada = devolucion?.estado === "closed" || devolucion?.estado === "expired" || Boolean(devolucion?.cerrada);
    const llego = devolucion?.envios.some((e) => e.estado === "delivered") ?? false;
    // Las revisiones solo importan si la devolución llegó y sigue abierta.
    const revisiones = devolucion?.id && llego && !cerrada ? await obtenerRevisionesMl(devolucion.id, token) : null;
    return {
      cuentaMlId: cuenta.id,
      nickname: cuenta.nickname,
      siteId: cuenta.siteId,
      reclamo,
      devolucion,
      revisiones,
      estado: estadoSimpleDevolucion(devolucion, revisiones),
    };
  });

  // Solo quedan los que de verdad tienen devolución (v2 returns no es 404).
  const conDevolucion = todas.filter((f) => f.devolucion !== null);
  return { filas: conDevolucion, sinLeerDetalle: candidatos.length - aLeer.length, truncado: truncado || candidatos.length > aLeer.length, cuentasSinRevisar };
}

// Producto principal de la venta de un reclamo (solo order): título,
// precio, unidades y foto. Nunca lanza.
export async function leerProductoVentaMl(reclamo: ReclamoBaseMl, token: string): Promise<(ProductoVenta & { moneda: string | null }) | null> {
  if (reclamo.recurso !== "order" || !reclamo.recursoId || !/^\d{1,20}$/.test(reclamo.recursoId)) return null;
  const recursoId = reclamo.recursoId;
  const orden = await opcional(async () => leerOrdenMl(await leerJson(`/orders/${recursoId}`, token)));
  const producto = orden?.productos[0];
  if (!orden || !producto) return null;
  const itemId = producto.itemId;
  const foto = itemId ? await opcional(async () => leerFotoItemMl(await leerJson(`/items/${itemId}`, token, "?attributes=id,thumbnail,pictures"))) : null;
  return { ...producto, moneda: producto.moneda ?? orden.moneda, foto };
}

export async function motivoLegibleMl(motivoId: string | null, token: string): Promise<string | null> {
  if (!motivoId) return null;
  const m = await obtenerMotivoReclamoMl(motivoId, token);
  return m?.detalle ?? m?.nombre ?? null;
}

// ---------- Datos extra para las métricas ----------

export type FilaMetrica = {
  cuentaMlId: string;
  nickname: string;
  siteId: string | null;
  fecha: string | null;
  motivoId: string | null;
  motivoTexto: string | null;
  costo: CostoEnvioDevolucion | null;
  itemId: string | null;
  productoTitulo: string | null;
};

// Costo del envío de vuelta, producto y motivo legible de cada fila. Una
// cuenta a la vez (un token), lecturas con concurrencia acotada. Si una
// lectura falla, esa fila queda sin ese dato — nunca se cae todo.
export async function enriquecerParaMetricas(empresaId: string, filas: FilaDevolucion[]): Promise<FilaMetrica[]> {
  const resultado: FilaMetrica[] = [];
  const porCuenta = new Map<string, FilaDevolucion[]>();
  for (const f of filas) porCuenta.set(f.cuentaMlId, [...(porCuenta.get(f.cuentaMlId) ?? []), f]);

  for (const [cuentaMlId, deCuenta] of porCuenta) {
    let token: string | null = null;
    try {
      token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
    } catch {
      token = null;
    }
    const motivos = new Map<string, string | null>();
    if (token) {
      const t = token;
      const ids = [...new Set(deCuenta.flatMap((f) => (f.reclamo.motivoId ? [f.reclamo.motivoId] : [])))];
      await conConcurrenciaLimitada(ids, CONCURRENCIA_LECTURAS, async (id) => {
        motivos.set(id, await motivoLegibleMl(id, t));
      });
    }
    const leidas = await conConcurrenciaLimitada(deCuenta, CONCURRENCIA_LECTURAS, async (f): Promise<FilaMetrica> => {
      const costo = token ? await obtenerCostoEnvioDevolucionMl(f.reclamo.id, token) : null;
      const producto = token ? await leerProductoVentaMl(f.reclamo, token) : null;
      return {
        cuentaMlId: f.cuentaMlId,
        nickname: f.nickname,
        siteId: f.siteId,
        fecha: f.reclamo.fecha,
        motivoId: f.reclamo.motivoId,
        motivoTexto: f.reclamo.motivoId ? (motivos.get(f.reclamo.motivoId) ?? null) : null,
        costo,
        itemId: producto?.itemId ?? null,
        productoTitulo: producto?.titulo ?? null,
      };
    });
    resultado.push(...leidas);
  }
  return resultado;
}

// ---------- Producto de las filas visibles de la lista ----------

export type ProductoVentaFila = ProductoVenta;

// Solo para las filas de la página (no las 60): orden + foto por fila,
// un token por cuenta, concurrencia acotada. Nunca lanza.
export async function leerProductosDeFilas(empresaId: string, filas: FilaDevolucion[]): Promise<Record<string, ProductoVentaFila | null>> {
  const tokens = new Map<string, string | null>();
  for (const cuentaId of new Set(filas.map((f) => f.cuentaMlId))) {
    tokens.set(cuentaId, await obtenerAccessTokenVigente(empresaId, cuentaId).catch(() => null));
  }
  const salida: Record<string, ProductoVentaFila | null> = {};
  await conConcurrenciaLimitada(filas, CONCURRENCIA_LECTURAS, async (f) => {
    const token = tokens.get(f.cuentaMlId);
    salida[`${f.cuentaMlId}-${f.reclamo.id}`] = token ? await leerProductoVentaMl(f.reclamo, token) : null;
  });
  return salida;
}
