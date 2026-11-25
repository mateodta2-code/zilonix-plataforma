// Reclamos-A (Refs #644) — detalle de un reclamo SOLO LECTURA, en vivo
// desde Mercado Libre. Nada de esto se guarda en la base de datos ni en
// logs: el nombre del comprador, sus mensajes y sus adjuntos viven solo
// en memoria durante la petición. Todas las llamadas son GET y pasan
// por lib/ml/cliente.ts; solo APIs documentadas (post-purchase v1,
// /orders, /shipments, /items).

import {
  idTexto,
  leerJugadoresReclamoMl,
  pedirLecturaMl,
  PATRON_ID_PRODUCTO_O_ITEM,
  textoODefecto,
  type JugadorReclamoMl,
} from "@/lib/ml/cliente";

// Los ids de reclamo, orden y envío de Mercado Libre son solo dígitos.
export const PATRON_ID_RECLAMO = /^\d{1,20}$/;
const PATRON_ID_NUMERICO = /^\d{1,20}$/;
// Nombre de archivo que ML genera para un adjunto: nunca barras ni "..".
export const PATRON_ARCHIVO_ADJUNTO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export function archivoAdjuntoValido(archivo: string): boolean {
  return PATRON_ARCHIVO_ADJUNTO.test(archivo) && !archivo.includes("..");
}

export class ReclamoNoEncontradoError extends Error {
  constructor() {
    super("Reclamo no encontrado.");
    this.name = "ReclamoNoEncontradoError";
  }
}

function exigirIdNumerico(valor: string, etiqueta: string): string {
  if (!PATRON_ID_NUMERICO.test(valor)) throw new Error(`${etiqueta} inválido — no se llamó a Mercado Libre.`);
  return valor;
}

// ---------- Tipos propios ----------

export type AdjuntoReclamo = { archivo: string; nombre: string; tamano: number | null; tipo: string | null };

export type MensajeReclamo = {
  rolEmisor: string | null;
  rolReceptor: string | null;
  // Texto del comprador: dato, nunca instrucción. Solo se muestra como texto plano.
  texto: string;
  fecha: string | null;
  etapa: string | null;
  adjuntos: AdjuntoReclamo[];
};

export type ReclamoBaseMl = {
  id: string;
  tipo: string | null;
  etapa: string | null;
  estado: string | null;
  motivoId: string | null;
  recurso: string | null;
  recursoId: string | null;
  siteId: string | null;
  fecha: string | null;
  actualizado: string | null;
  jugadores: JugadorReclamoMl[];
};

export type AfectaReputacionMl = { afecta: boolean | null; tieneIncentivo: boolean | null; vence: string | null };
export type MotivoReclamoMl = { nombre: string | null; detalle: string | null };
export type ResolucionEsperadaMl = { rol: string | null; resolucion: string | null; estado: string | null; fecha: string | null };

export type ProductoVenta = {
  itemId: string | null;
  titulo: string | null;
  variaciones: { nombre: string; valor: string }[];
  precioUnitario: number | null;
  cantidad: number | null;
  moneda: string | null;
  foto: string | null;
};

export type VentaReclamo = {
  ordenId: string | null;
  fecha: string | null;
  ciudad: string | null;
  moneda: string | null;
  productos: ProductoVenta[];
  // Cuando la venta no se pudo leer o el reclamo no es de una orden.
  aviso: string | null;
};

export type DetalleReclamoMl = {
  reclamo: ReclamoBaseMl;
  mensajes: MensajeReclamo[];
  motivo: MotivoReclamoMl | null;
  reputacion: AfectaReputacionMl | null;
  resoluciones: ResolucionEsperadaMl[];
  plazo: string | null;
  compradorNombre: string;
  venta: VentaReclamo;
  // Acciones que ML le habilita al vendedor (respondent), para B y C.
  accionesVendedor: string[];
};

// ---------- Funciones puras: respuesta de ML → tipos propios ----------

export function leerReclamoMl(data: unknown): ReclamoBaseMl | null {
  if (!data || typeof data !== "object") return null;
  const fila = data as Record<string, unknown>;
  const id = idTexto(fila.id);
  if (!id) return null;
  return {
    id,
    tipo: textoODefecto(fila.type),
    etapa: textoODefecto(fila.stage),
    estado: textoODefecto(fila.status),
    motivoId: textoODefecto(fila.reason_id),
    recurso: textoODefecto(fila.resource),
    recursoId: idTexto(fila.resource_id),
    siteId: textoODefecto(fila.site_id),
    fecha: textoODefecto(fila.date_created),
    actualizado: textoODefecto(fila.last_updated),
    jugadores: leerJugadoresReclamoMl(fila.players),
  };
}

export function leerMensajesReclamoMl(data: unknown): MensajeReclamo[] {
  const lista = Array.isArray(data) ? data : Array.isArray((data as { messages?: unknown })?.messages) ? (data as { messages: unknown[] }).messages : [];
  return lista
    .flatMap((m): MensajeReclamo[] => {
      if (!m || typeof m !== "object") return [];
      const fila = m as Record<string, unknown>;
      const adjuntos = Array.isArray(fila.attachments)
        ? fila.attachments.flatMap((a): AdjuntoReclamo[] => {
            const adj = a as Record<string, unknown>;
            const archivo = typeof adj?.filename === "string" ? adj.filename : "";
            if (!archivoAdjuntoValido(archivo)) return [];
            return [
              {
                archivo,
                nombre: textoODefecto(adj.original_filename) ?? archivo,
                tamano: typeof adj.size === "number" && Number.isFinite(adj.size) ? adj.size : null,
                tipo: textoODefecto(adj.type),
              },
            ];
          })
        : [];
      const texto = typeof fila.message === "string" ? fila.message : "";
      if (!texto && adjuntos.length === 0) return [];
      return [
        {
          rolEmisor: textoODefecto(fila.sender_role),
          rolReceptor: textoODefecto(fila.receiver_role),
          texto,
          fecha: textoODefecto(fila.date_created),
          etapa: textoODefecto(fila.stage),
          adjuntos,
        },
      ];
    })
    .sort((a, b) => (a.fecha ? Date.parse(a.fecha) : 0) - (b.fecha ? Date.parse(b.fecha) : 0));
}

export function leerAfectaReputacionMl(data: unknown): AfectaReputacionMl | null {
  if (!data || typeof data !== "object") return null;
  const fila = data as Record<string, unknown>;
  return {
    afecta: typeof fila.affects_reputation === "string" ? fila.affects_reputation === "affected" : typeof fila.affects_reputation === "boolean" ? fila.affects_reputation : null,
    tieneIncentivo: typeof fila.has_incentive === "boolean" ? fila.has_incentive : null,
    vence: textoODefecto(fila.due_date),
  };
}

export function leerMotivoReclamoMl(data: unknown): MotivoReclamoMl | null {
  if (!data || typeof data !== "object") return null;
  const fila = data as Record<string, unknown>;
  const nombre = textoODefecto(fila.name);
  const detalle = textoODefecto(fila.detail);
  return nombre || detalle ? { nombre, detalle } : null;
}

export function leerResolucionesEsperadasMl(data: unknown): ResolucionEsperadaMl[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r): ResolucionEsperadaMl[] => {
    if (!r || typeof r !== "object") return [];
    const fila = r as Record<string, unknown>;
    const resolucion = textoODefecto(fila.expected_resolution);
    if (!resolucion) return [];
    return [{ rol: textoODefecto(fila.player_role), resolucion, estado: textoODefecto(fila.status), fecha: textoODefecto(fila.date_created) }];
  });
}

export type OrdenReclamoMl = {
  fecha: string | null;
  moneda: string | null;
  envioId: string | null;
  comprador: { nombre: string | null; nickname: string | null };
  productos: Omit<ProductoVenta, "foto">[];
};

export function leerOrdenMl(data: unknown): OrdenReclamoMl | null {
  if (!data || typeof data !== "object") return null;
  const fila = data as Record<string, unknown>;
  const comprador = (fila.buyer ?? {}) as Record<string, unknown>;
  const nombre = [textoODefecto(comprador.first_name), textoODefecto(comprador.last_name)].filter(Boolean).join(" ").trim();
  const lineas = Array.isArray(fila.order_items) ? fila.order_items : [];
  const productos = lineas.flatMap((l): OrdenReclamoMl["productos"] => {
    if (!l || typeof l !== "object") return [];
    const linea = l as Record<string, unknown>;
    const item = (linea.item ?? {}) as Record<string, unknown>;
    const itemId = typeof item.id === "string" && PATRON_ID_PRODUCTO_O_ITEM.test(item.id) ? item.id : null;
    const variaciones = Array.isArray(item.variation_attributes)
      ? item.variation_attributes.flatMap((v): { nombre: string; valor: string }[] => {
          const attr = v as Record<string, unknown>;
          const n = textoODefecto(attr?.name);
          const val = textoODefecto(attr?.value_name);
          return n && val ? [{ nombre: n, valor: val }] : [];
        })
      : [];
    const precio = Number(linea.unit_price);
    const cantidad = Number(linea.quantity);
    return [
      {
        itemId,
        titulo: textoODefecto(item.title),
        variaciones,
        precioUnitario: Number.isFinite(precio) ? precio : null,
        cantidad: Number.isFinite(cantidad) ? cantidad : null,
        moneda: textoODefecto(linea.currency_id) ?? textoODefecto(fila.currency_id),
      },
    ];
  });
  const envio = (fila.shipping ?? {}) as Record<string, unknown>;
  return {
    fecha: textoODefecto(fila.date_created),
    moneda: textoODefecto(fila.currency_id),
    envioId: idTexto(envio.id),
    comprador: { nombre: nombre || null, nickname: textoODefecto(comprador.nickname) },
    productos,
  };
}

export function leerEnvioMl(data: unknown): { ciudad: string | null; receptor: string | null } {
  const fila = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const direccion = (fila.receiver_address ?? {}) as Record<string, unknown>;
  const ciudadCruda = direccion.city;
  const ciudad =
    typeof ciudadCruda === "string"
      ? textoODefecto(ciudadCruda)
      : ciudadCruda && typeof ciudadCruda === "object"
        ? textoODefecto((ciudadCruda as Record<string, unknown>).name)
        : null;
  return { ciudad, receptor: textoODefecto(direccion.receiver_name) ?? textoODefecto(fila.receiver_name) };
}

function urlHttps(valor: unknown): string | null {
  return typeof valor === "string" && valor.startsWith("https://") ? valor : null;
}

export function leerFotoItemMl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const fila = data as Record<string, unknown>;
  const primera = Array.isArray(fila.pictures) ? (fila.pictures[0] as Record<string, unknown> | undefined) : undefined;
  return urlHttps(primera?.secure_url) ?? urlHttps(primera?.url) ?? urlHttps(fila.thumbnail);
}

// ---------- Plazo y nombre ----------

// due_date de affects-reputation; si no viene, el menor due_date de las
// acciones disponibles del vendedor (respondent).
export function calcularPlazoReclamo(reputacion: AfectaReputacionMl | null, jugadores: JugadorReclamoMl[]): string | null {
  if (reputacion?.vence && Number.isFinite(Date.parse(reputacion.vence))) return reputacion.vence;
  return plazoDeJugadores(jugadores);
}

export function plazoDeJugadores(jugadores: JugadorReclamoMl[]): string | null {
  const fechas = jugadores
    .filter((j) => j.rol === "respondent")
    .flatMap((j) => j.acciones.map((a) => a.vence))
    .flatMap((v) => (v && Number.isFinite(Date.parse(v)) ? [v] : []));
  if (fechas.length === 0) return null;
  return fechas.reduce((menor, f) => (Date.parse(f) < Date.parse(menor) ? f : menor));
}

export function accionesDelVendedor(jugadores: JugadorReclamoMl[]): string[] {
  return [...new Set(jugadores.filter((j) => j.rol === "respondent").flatMap((j) => j.acciones.map((a) => a.accion)))];
}

export function nombreComprador(orden: OrdenReclamoMl | null, receptorEnvio: string | null): string {
  return orden?.comprador.nombre ?? receptorEnvio ?? orden?.comprador.nickname ?? "Comprador";
}

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const letras = partes.length === 1 ? partes[0].slice(0, 2) : partes[0][0] + partes[partes.length - 1][0];
  return letras.toUpperCase();
}

// ---------- Lecturas a ML ----------

// Una lectura secundaria que falla (cualquier motivo) no tumba el detalle.
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

// GET /post-purchase/v1/reasons/{reason_id} — nombre legible del motivo.
// Nunca lanza: sin motivo legible la pantalla muestra el código.
export async function obtenerMotivoReclamoMl(motivoId: string, token: string): Promise<MotivoReclamoMl | null> {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(motivoId)) return null;
  return opcional(async () => leerMotivoReclamoMl(await leerJson(`/post-purchase/v1/reasons/${motivoId}`, token)));
}

// Reclamo + mensajes + resoluciones esperadas + reputación + motivo, y
// la venta (orden, envío, foto). Lanza ReclamoNoEncontradoError si ML
// responde 404 al reclamo; el resto de errores de ML (401/403/429/5xx)
// suben tal cual para que la página los traduzca con
// motivoCuentaSinRevisar. `cuentaIdExterna` (user_id del vendedor) se
// usa para confirmar que el reclamo es de ESA cuenta.
export async function obtenerDetalleReclamoMl(reclamoId: string, token: string, cuentaIdExterna?: string): Promise<DetalleReclamoMl> {
  exigirIdNumerico(reclamoId, "reclamoId");
  const base = `/post-purchase/v1/claims/${reclamoId}`;

  const respReclamo = await pedirLecturaMl<unknown>(base, token);
  if (!respReclamo.ok) {
    if (respReclamo.status === 404 || respReclamo.status === 400) throw new ReclamoNoEncontradoError();
    throw new Error(`Mercado Libre respondió ${respReclamo.status} al leer el reclamo.`);
  }
  const reclamo = leerReclamoMl(respReclamo.data);
  if (!reclamo) throw new ReclamoNoEncontradoError();

  // El reclamo debe tener a esta cuenta como vendedor (respondent).
  if (cuentaIdExterna) {
    const vendedor = reclamo.jugadores.find((j) => j.rol === "respondent" && j.userId);
    if (vendedor && vendedor.userId !== cuentaIdExterna) throw new ReclamoNoEncontradoError();
  }

  const [respMensajes, resoluciones, reputacion, motivo] = await Promise.all([
    leerJson(`${base}/messages`, token),
    opcional(async () => leerResolucionesEsperadasMl(await leerJson(`${base}/expected_resolutions`, token))),
    opcional(async () => leerAfectaReputacionMl(await leerJson(`${base}/affects-reputation`, token))),
    reclamo.motivoId ? obtenerMotivoReclamoMl(reclamo.motivoId, token) : null,
  ]);

  const venta = await leerVenta(reclamo, token);
  const plazo = calcularPlazoReclamo(reputacion, reclamo.jugadores);

  return {
    reclamo,
    mensajes: leerMensajesReclamoMl(respMensajes),
    motivo,
    reputacion,
    resoluciones: resoluciones ?? [],
    plazo,
    compradorNombre: venta.compradorNombre,
    venta: venta.venta,
    accionesVendedor: accionesDelVendedor(reclamo.jugadores),
  };
}

async function leerVenta(reclamo: ReclamoBaseMl, token: string): Promise<{ venta: VentaReclamo; compradorNombre: string }> {
  const vacia = (aviso: string): VentaReclamo => ({ ordenId: null, fecha: null, ciudad: null, moneda: null, productos: [], aviso });
  const recursoId = reclamo.recursoId;
  if (!recursoId || !PATRON_ID_NUMERICO.test(recursoId)) {
    return { venta: vacia("Este reclamo no indica la venta."), compradorNombre: "Comprador" };
  }

  let orden: OrdenReclamoMl | null = null;
  let envioId: string | null = null;
  if (reclamo.recurso === "order") {
    orden = await opcional(async () => leerOrdenMl(await leerJson(`/orders/${recursoId}`, token)));
    envioId = orden?.envioId ?? null;
  } else if (reclamo.recurso === "shipment") {
    envioId = recursoId;
  }

  let envio: { ciudad: string | null; receptor: string | null } = { ciudad: null, receptor: null };
  if (envioId && PATRON_ID_NUMERICO.test(envioId)) {
    const id = envioId;
    envio = (await opcional(async () => leerEnvioMl(await leerJson(`/shipments/${id}`, token)))) ?? envio;
  }

  const productos: ProductoVenta[] = [];
  for (const p of orden?.productos ?? []) {
    const itemId = p.itemId;
    const foto = itemId ? await opcional(async () => leerFotoItemMl(await leerJson(`/items/${itemId}`, token, "?attributes=id,thumbnail,pictures"))) : null;
    productos.push({ ...p, foto });
  }

  const aviso =
    reclamo.recurso === "order"
      ? orden
        ? null
        : "No se pudo leer la venta en Mercado Libre."
      : "Este reclamo está ligado a un envío o a un pago, no a una venta: la ficha no trae los datos del producto.";

  return {
    venta: {
      ordenId: reclamo.recurso === "order" ? recursoId : null,
      fecha: orden?.fecha ?? null,
      ciudad: envio.ciudad,
      moneda: orden?.moneda ?? productos[0]?.moneda ?? null,
      productos,
      aviso,
    },
    compradorNombre: nombreComprador(orden, envio.receptor),
  };
}
