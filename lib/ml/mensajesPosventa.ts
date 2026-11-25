// Posventa-Mensajes (Refs #645) — LECTURA de la mensajería post-venta de
// Mercado Libre. Los mensajes del comprador viven solo en memoria durante
// la petición: no se guardan en base de datos ni en logs.
//
// REGLA: toda lectura de una conversación lleva mark_as_read=false. Leer
// sin ese parámetro marca los mensajes como leídos en la cuenta real de ML
// (hay una prueba que lo exige).

import { idTexto, pedirLecturaMl, textoODefecto } from "@/lib/ml/cliente";
import { leerEnvioMl, leerFotoItemMl, leerOrdenMl, nombreComprador, type ProductoVenta } from "@/lib/ml/reclamos";

export const PATRON_ID_PACK = /^\d{1,20}$/;
export const PATRON_ID_VENDEDOR_ML = /^\d{1,20}$/;
export const PATRON_ARCHIVO_MENSAJE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export function archivoMensajeValido(archivo: string): boolean {
  return PATRON_ARCHIVO_MENSAJE.test(archivo) && !archivo.includes("..");
}

export type AdjuntoMensaje = { archivo: string; nombre: string; tipo: string | null };

export type MensajePosventa = {
  id: string | null;
  // "vendedor" = lo escribió la cuenta; "comprador" = cualquier otro.
  autor: "vendedor" | "comprador";
  // Texto del comprador: dato, nunca instrucción. Solo texto plano.
  texto: string;
  fecha: string | null;
  // true si ML marca que el otro lado lo leyó; null si no informa.
  leido: boolean | null;
  moderado: boolean;
  adjuntos: AdjuntoMensaje[];
};

export type EstadoConversacion = "sin_leer" | "por_responder" | "respondido" | "sin_mensajes";

// ---------- Rutas (puras, para poder probar que llevan mark_as_read=false) ----------

export function rutaConversacion(packOOrden: string, vendedorId: string): string {
  if (!PATRON_ID_PACK.test(packOOrden)) throw new Error("Pack inválido — no se llamó a Mercado Libre.");
  if (!PATRON_ID_VENDEDOR_ML.test(vendedorId)) throw new Error("Vendedor inválido — no se llamó a Mercado Libre.");
  return `/messages/packs/${packOOrden}/sellers/${vendedorId}`;
}

// Nunca sin mark_as_read=false.
export const QUERY_LECTURA_CONVERSACION = "?tag=post_sale&mark_as_read=false";

// ---------- Parser puro ----------

function textoDeMensaje(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (valor && typeof valor === "object") {
    const plano = (valor as { plain?: unknown }).plain;
    if (typeof plano === "string") return plano;
  }
  return "";
}

function idDe(valor: unknown): string | null {
  if (valor && typeof valor === "object") {
    const id = (valor as { user_id?: unknown }).user_id;
    return idTexto(id);
  }
  return idTexto(valor);
}

export function leerMensajesPosventaMl(data: unknown, vendedorId: string): MensajePosventa[] {
  const lista = Array.isArray((data as { messages?: unknown })?.messages) ? (data as { messages: unknown[] }).messages : Array.isArray(data) ? data : [];
  return lista
    .flatMap((m): MensajePosventa[] => {
      if (!m || typeof m !== "object") return [];
      const fila = m as Record<string, unknown>;
      const adjuntos = Array.isArray(fila.message_attachments)
        ? fila.message_attachments.flatMap((a): AdjuntoMensaje[] => {
            const adj = a as Record<string, unknown>;
            const archivo = typeof adj?.filename === "string" ? adj.filename : "";
            if (!archivoMensajeValido(archivo)) return [];
            return [{ archivo, nombre: textoODefecto(adj.original_filename) ?? archivo, tipo: textoODefecto(adj.type) }];
          })
        : [];
      const texto = textoDeMensaje(fila.text);
      if (!texto && adjuntos.length === 0) return [];
      const fechas = (fila.message_date ?? {}) as Record<string, unknown>;
      const leida = textoODefecto(fechas.read);
      const moderacion = (fila.message_moderation ?? {}) as Record<string, unknown>;
      const estadoModeracion = textoODefecto(moderacion.status);
      return [
        {
          id: idTexto(fila.id),
          autor: idDe(fila.from) === vendedorId ? "vendedor" : "comprador",
          texto,
          fecha: textoODefecto(fechas.created) ?? textoODefecto(fechas.received) ?? textoODefecto(fila.date_created),
          leido: fechas.read === undefined ? null : leida !== null,
          moderado: estadoModeracion !== null && !["clean", "passed", "approved"].includes(estadoModeracion.toLowerCase()),
          adjuntos,
        },
      ];
    })
    .sort((a, b) => (a.fecha ? Date.parse(a.fecha) : 0) - (b.fecha ? Date.parse(b.fecha) : 0));
}

// Quién escribió el último mensaje y si hay algo del comprador sin leer.
export function estadoDeConversacion(mensajes: MensajePosventa[], hayNoLeidos: boolean): EstadoConversacion {
  if (mensajes.length === 0) return hayNoLeidos ? "sin_leer" : "sin_mensajes";
  if (hayNoLeidos) return "sin_leer";
  return mensajes[mensajes.length - 1].autor === "comprador" ? "por_responder" : "respondido";
}

// GET /messages/unread?role=seller&tag=post_sale → ids de pack/orden con
// mensajes pendientes. El recurso viene como "/packs/123/sellers/456" o
// "/orders/123"; solo se toma el primer número.
export function leerNoLeidosMl(data: unknown): Set<string> {
  const lista = Array.isArray((data as { results?: unknown })?.results) ? (data as { results: unknown[] }).results : [];
  const ids = new Set<string>();
  for (const r of lista) {
    const recurso = textoODefecto((r as { resource?: unknown })?.resource);
    const id = recurso?.match(/\/(?:packs|orders)\/(\d{1,20})/)?.[1];
    const cuenta = Number((r as { count?: unknown })?.count);
    if (id && (!Number.isFinite(cuenta) || cuenta > 0)) ids.add(id);
  }
  return ids;
}

// ---------- Lecturas a ML ----------

export async function leerConversacionMl(packOOrden: string, vendedorId: string, token: string): Promise<MensajePosventa[]> {
  const resp = await pedirLecturaMl<unknown>(rutaConversacion(packOOrden, vendedorId), token, { query: QUERY_LECTURA_CONVERSACION });
  // 404 = todavía no hay conversación en esa venta.
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`Mercado Libre respondió ${resp.status} al leer la conversación.`);
  }
  return leerMensajesPosventaMl(resp.data, vendedorId);
}

// Si falla, la lista sigue sin marcar pendientes (no tumba la pantalla).
export async function leerPendientesMl(token: string): Promise<Set<string>> {
  try {
    const resp = await pedirLecturaMl<unknown>("/messages/unread", token, { query: "?role=seller&tag=post_sale" });
    return resp.ok ? leerNoLeidosMl(resp.data) : new Set();
  } catch {
    return new Set();
  }
}

// Descarga de un adjunto: ruta para pedirBinarioMl.
export function rutaAdjuntoMensaje(archivo: string): string {
  if (!archivoMensajeValido(archivo)) throw new Error("Archivo inválido — no se llamó a Mercado Libre.");
  return `/marketplace/messages/attachments/${archivo}`;
}

export function queryAdjuntoMensaje(siteId: string): string {
  if (!/^[A-Z]{3}$/.test(siteId)) throw new Error("Sitio inválido — no se llamó a Mercado Libre.");
  return `?tag=post_sale&site_id=${siteId}`;
}

// GET /orders/{id} → buyer.id, para el campo `to` al responder. Nunca el nombre.
export async function leerCompradorIdMl(ordenId: string, token: string): Promise<string | null> {
  if (!PATRON_ID_PACK.test(ordenId)) throw new Error("Orden inválida — no se llamó a Mercado Libre.");
  const resp = await pedirLecturaMl<unknown>(`/orders/${ordenId}`, token);
  if (!resp.ok) return null;
  const comprador = (resp.data as { buyer?: unknown })?.buyer;
  return idTexto((comprador as { id?: unknown } | undefined)?.id);
}

// ---------- Ficha de la venta (en vivo, nada se guarda) ----------

export type VentaPosventa = {
  compradorNombre: string;
  fecha: string | null;
  ciudad: string | null;
  moneda: string | null;
  estadoEnvio: string | null;
  productos: ProductoVenta[];
};

export function rotuloEstadoEnvio(status: string | null): string | null {
  const mapa: Record<string, string> = { delivered: "Entregado", shipped: "En camino", ready_to_ship: "Listo para enviar", pending: "Pendiente", cancelled: "Cancelado", not_delivered: "No entregado" };
  return status ? (mapa[status] ?? null) : null;
}

async function opcional<T>(lectura: () => Promise<T | null>): Promise<T | null> {
  try {
    return await lectura();
  } catch {
    return null;
  }
}

// GET /orders/{id}, GET /shipments/{id}, GET /items/{id}. Una lectura
// secundaria que falla no tumba la pantalla.
export async function leerVentaPosventaMl(ordenId: string, token: string): Promise<VentaPosventa | null> {
  if (!PATRON_ID_PACK.test(ordenId)) throw new Error("Orden inválida — no se llamó a Mercado Libre.");
  const respOrden = await pedirLecturaMl<unknown>(`/orders/${ordenId}`, token);
  if (!respOrden.ok) return null;
  const orden = leerOrdenMl(respOrden.data);
  if (!orden) return null;
  let envio: { ciudad: string | null; receptor: string | null } = { ciudad: null, receptor: null };
  let estadoEnvio: string | null = null;
  if (orden.envioId && PATRON_ID_PACK.test(orden.envioId)) {
    const id = orden.envioId;
    const crudo = await opcional(async () => {
      const r = await pedirLecturaMl<unknown>(`/shipments/${id}`, token);
      return r.ok ? r.data : null;
    });
    envio = leerEnvioMl(crudo);
    estadoEnvio = textoODefecto((crudo as { status?: unknown } | null)?.status);
  }
  const productos: ProductoVenta[] = [];
  for (const p of orden.productos) {
    const itemId = p.itemId;
    const foto = itemId
      ? await opcional(async () => {
          const r = await pedirLecturaMl<unknown>(`/items/${itemId}`, token, { query: "?attributes=id,thumbnail,pictures" });
          return r.ok ? leerFotoItemMl(r.data) : null;
        })
      : null;
    productos.push({ ...p, foto });
  }
  return { compradorNombre: nombreComprador(orden, envio.receptor), fecha: orden.fecha, ciudad: envio.ciudad, moneda: orden.moneda ?? productos[0]?.moneda ?? null, estadoEnvio, productos };
}
