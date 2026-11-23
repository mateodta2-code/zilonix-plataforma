import { desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { importacionesMl, pedidos, publicaciones } from "@/db/schema";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { registrarEventoPedido } from "@/lib/ml/pedidos";
import { sincronizarDespacho } from "@/lib/ml/despachos";
import { guardarOrdenMl } from "@/lib/ml/ventas-finanzas";
import type { OrdenMl } from "@/lib/finanzas/venta-ml";

// Historial que se importa al conectar una cuenta (decisión de Mateo,
// issue #567: 1 año). Una sola fuente: la pantalla /panel/conectar-ml
// arma sus textos desde esta constante.
export const DIAS_HACIA_ATRAS = 365;
// Ventanas de fechas para /orders/search: ML limita el offset de una
// búsqueda, así que en vez de un offset enorme se pagina por ventanas
// cortas y dentro de cada una por offset.
export const DIAS_POR_VENTANA = 30;
const MS_DIA = 24 * 60 * 60 * 1000;
const TAMAÑO_PAGINA = 50;
const REINTENTOS_429 = 4;
const ESPERA_MAX_429_MS = 30_000;

// Tarea 2.5 — formato de petición confirmado contra el código real ya
// en producción del Zilonix OS actual (zilonix-os-web/lib/
// mercadolibre-despachos.js, lib/fullylemon.js) — no inventado.

type PedidoMl = {
  id: number | string;
  date_created: string;
  status: string;
  total_amount: number;
  currency_id: string;
  payments?: { status: string; date_approved: string | null }[];
  shipping?: { id: number | string | null };
};

// Tarea 2.7 — campo usado SOLO acá abajo (status_history.date_shipped/
// date_delivered). A diferencia del resto de los campos de este
// archivo (todos confirmados grep-eando el código real que ya corre
// en producción del Zilonix OS actual), este NO quedó confirmado así
// — el sistema actual nunca necesitó leer el historial de fechas de
// un envío, solo su estado actual. Viene de la documentación pública
// de la API de Mercado Libre. Pendiente real: verificar con Mateo
// contra un pedido real despachado en staging apenas haya uno.
type EnvioMl = { status: string; status_history?: { date_shipped?: string | null; date_delivered?: string | null } };

async function traerEnvioReal(accessToken: string, shipmentId: number | string): Promise<EnvioMl | null> {
  const res = await fetch(`https://api.mercadolibre.com/shipments/${shipmentId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null; // un envío que no se puede leer no debe tumbar el resto de la importación
  return res.json();
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 429 de ML: se espera (Retry-After si viene, si no backoff 1s, 2s, 4s…)
// y se reintenta; agotados los reintentos devuelve el último 429.
async function fetchConReintento429(url: string, accessToken: string): Promise<Response> {
  for (let intento = 0; ; intento++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status !== 429 || intento >= REINTENTOS_429) return res;
    const retryAfter = Number(res.headers?.get?.("retry-after"));
    const espera = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 1000 * 2 ** intento;
    await esperar(Math.min(espera, ESPERA_MAX_429_MS));
  }
}

// Ventanas [desde, hasta] de la más reciente a la más vieja.
export function ventanasDeFechas(ahora: number, dias = DIAS_HACIA_ATRAS, diasPorVentana = DIAS_POR_VENTANA): { desde: string; hasta: string }[] {
  const ventanas: { desde: string; hasta: string }[] = [];
  const limite = ahora - dias * MS_DIA;
  for (let hasta = ahora; hasta > limite; hasta -= diasPorVentana * MS_DIA) {
    ventanas.push({ desde: new Date(Math.max(limite, hasta - diasPorVentana * MS_DIA)).toISOString(), hasta: new Date(hasta).toISOString() });
  }
  return ventanas;
}

export async function traerPedidosReales(accessToken: string, cuentaIdExterna: string, ahora = Date.now()): Promise<PedidoMl[]> {
  const porId = new Map<string, PedidoMl>();
  const ventanas = ventanasDeFechas(ahora);
  for (const [i, ventana] of ventanas.entries()) {
    let offset = 0;
    while (true) {
      const url =
        `https://api.mercadolibre.com/orders/search?seller=${cuentaIdExterna}` +
        `&order.date_created.from=${encodeURIComponent(ventana.desde)}&order.date_created.to=${encodeURIComponent(ventana.hasta)}` +
        `&sort=date_desc&limit=${TAMAÑO_PAGINA}&offset=${offset}`;
      const res = await fetchConReintento429(url, accessToken);
      if (!res.ok) {
        // Una ventana vieja que ML rechaza por rango (400/404/422) se
        // omite y se sigue; la más reciente, 401/403/429/5xx sí cortan.
        if (i > 0 && [400, 404, 422].includes(res.status)) break;
        throw await errorDeRespuesta(res, "al traer pedidos");
      }
      const data = await res.json();
      const pagina: PedidoMl[] = data.results ?? [];
      for (const p of pagina) porId.set(String(p.id), p);
      if (pagina.length < TAMAÑO_PAGINA) break;
      offset += TAMAÑO_PAGINA;
    }
  }
  return [...porId.values()];
}


// Issue #561 — antes solo se guardaba el número de estado y no se sabía
// la causa de un 403. Se resume el cuerpo JSON de ML (status, code/error,
// message, cause), recortado y sin credenciales: nunca se incluyen
// cabeceras ni URLs, y se enmascara cualquier cosa con forma de token.
export const PREFIJO_AVISO_IMPORTACION = "AVISO: ";
const LARGO_MAX_CAMPO = 160;

function limpiarTexto(valor: unknown): string {
  const texto = typeof valor === "string" ? valor : valor == null ? "" : JSON.stringify(valor);
  return texto
    .replace(/Bearer\s+\S+/gi, "[oculto]")
    .replace(/(APP_USR|TG)-[\w-]+/g, "[oculto]")
    .replace(/(access_token|refresh_token|client_secret)=?[^\s&,;]*/gi, "[oculto]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LARGO_MAX_CAMPO);
}

export function resumirCuerpoErrorMl(status: number, cuerpo: unknown): string {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const partes = [`status=${status}`];
  const codigo = limpiarTexto(c.code ?? c.error);
  if (codigo) partes.push(`code=${codigo}`);
  const mensaje = limpiarTexto(c.message);
  if (mensaje) partes.push(`message=${mensaje}`);
  const causa = limpiarTexto(c.cause);
  if (causa) partes.push(`cause=${causa}`);
  return partes.join(" ");
}

async function errorDeRespuesta(res: Response, accion: string): Promise<Error> {
  let cuerpo: unknown = {};
  try {
    cuerpo = await res.json();
  } catch {
    // cuerpo vacío o no JSON: queda solo el status
  }
  return new Error(`Mercado Libre respondió ${res.status} ${accion}. [${resumirCuerpoErrorMl(res.status, cuerpo)}]`);
}

// Para /panel/conectar-ml: texto legible en español + pista de qué revisar.
export function describirErrorImportacion(texto: string): { esAviso: boolean; mensaje: string; pista: string | null } {
  const esAviso = texto.startsWith(PREFIJO_AVISO_IMPORTACION);
  const limpio = esAviso ? texto.slice(PREFIJO_AVISO_IMPORTACION.length) : texto;
  const negado = /respondió 40[13]\b|status=40[13]\b/.test(limpio);
  const mensaje = negado ? limpio.replace(/Mercado Libre respondió (40[13])/, "Mercado Libre negó el acceso ($1)") : limpio;
  const pista = negado
    ? "Revisa los permisos de la app en el DevCenter de Mercado Libre, que la conexión sea con el usuario principal de la cuenta y que la cuenta no tenga restricciones."
    : null;
  return { esAviso, mensaje, pista };
}

type PublicacionMl = { id: string; title: string; price: number; available_quantity: number };

type ResultadoPublicaciones = { publicaciones: PublicacionMl[]; omitidas: number; motivos: string[] };

const ATRIBUTOS_ITEM = "id,title,price,available_quantity";

export async function traerPublicacionesReales(accessToken: string, cuentaIdExterna: string): Promise<ResultadoPublicaciones> {
  const ids: string[] = [];
  let offset = 0;
  while (true) {
    const url = `https://api.mercadolibre.com/users/${cuentaIdExterna}/items/search?status=active&limit=${TAMAÑO_PAGINA}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw await errorDeRespuesta(res, "al listar publicaciones");
    const data = await res.json();
    const pagina: string[] = data.results ?? [];
    ids.push(...pagina);
    if (pagina.length < TAMAÑO_PAGINA) break;
    offset += TAMAÑO_PAGINA;
  }

  const publicacionesReales: PublicacionMl[] = [];
  let omitidas = 0;
  const motivos = new Map<string, number>();
  const omitir = (motivo: string) => {
    omitidas += 1;
    motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
  };

  // Un lote que falla no tumba la importación: se reintenta ítem por ítem.
  const leerPorItem = async (lote: string[]) => {
    for (const id of lote) {
      try {
        const res = await fetch(`https://api.mercadolibre.com/items/${id}?attributes=${ATRIBUTOS_ITEM}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          let cuerpo: unknown = {};
          try {
            cuerpo = await res.json();
          } catch {}
          omitir(resumirCuerpoErrorMl(res.status, cuerpo));
          continue;
        }
        const body = (await res.json()) as PublicacionMl;
        if (body?.id) publicacionesReales.push(body);
        else omitir("status=200 sin datos");
      } catch {
        omitir("error de red");
      }
    }
  };

  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const url = `https://api.mercadolibre.com/items?ids=${lote.join(",")}&attributes=${ATRIBUTOS_ITEM}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      await leerPorItem(lote);
      continue;
    }
    const data = await res.json();
    for (const fila of data as Array<{ code: number; body: (PublicacionMl & { message?: unknown; error?: unknown; cause?: unknown }) | null }>) {
      if (fila.code === 200 && fila.body) publicacionesReales.push(fila.body);
      else omitir(resumirCuerpoErrorMl(fila.code, fila.body));
    }
  }
  return { publicaciones: publicacionesReales, omitidas, motivos: [...motivos].map(([m, n]) => `${m} (x${n})`) };
}

// Tarea 2.5 — corre en segundo plano justo después de conectar (ver
// app/api/ml/callback/route.ts, que la llama sin esperarla). Guarda
// progreso en importaciones_ml a medida que avanza, para que
// /panel/conectar-ml pueda mostrar una barra de progreso real.
export async function ejecutarImportacionInicial(empresaId: string, cuentaId: string, cuentaIdExterna: string): Promise<void> {
  const [importacion] = await dbComoEmpresa(empresaId, (tx) =>
    tx.insert(importacionesMl).values({ empresaId, cuentaMlId: cuentaId }).returning({ id: importacionesMl.id })
  );

  try {
    const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);

    const pedidosReales = await traerPedidosReales(accessToken, cuentaIdExterna);
    await dbComoEmpresa(empresaId, (tx) =>
      tx.update(importacionesMl).set({ pedidosEncontrados: pedidosReales.length }).where(eq(importacionesMl.id, importacion.id))
    );
    let pedidosImportados = 0;
    for (const pedido of pedidosReales) {
      const [filaPedido] = await dbComoEmpresa(empresaId, (tx) =>
        tx
          .insert(pedidos)
          .values({
            empresaId,
            cuentaMlId: cuentaId,
            pedidoIdExterno: String(pedido.id),
            fecha: new Date(pedido.date_created),
            total: String(pedido.total_amount),
            moneda: pedido.currency_id,
            estado: pedido.status,
          })
          .onConflictDoUpdate({ target: [pedidos.empresaId, pedidos.pedidoIdExterno], set: { estado: pedido.status } })
          .returning({ id: pedidos.id })
      );

      // Tarea 2.7 — venta y pago, confirmados contra el código real ya
      // en producción (campo payments[].date_approved).
      await registrarEventoPedido(empresaId, filaPedido.id, "venta", new Date(pedido.date_created));
      const pagoAprobado = (pedido.payments ?? []).find((p) => p.status === "approved" && p.date_approved);
      if (pagoAprobado?.date_approved) {
        await registrarEventoPedido(empresaId, filaPedido.id, "pago", new Date(pagoAprobado.date_approved));
      }

      // Despacho/entrega — ver nota sobre traerEnvioReal() más arriba:
      // campo sin confirmar contra este proyecto todavía.
      if (pedido.shipping?.id) {
        const envio = await traerEnvioReal(accessToken, pedido.shipping.id);
        if (envio?.status_history?.date_shipped) {
          await registrarEventoPedido(empresaId, filaPedido.id, "despacho", new Date(envio.status_history.date_shipped));
        }
        if (envio?.status_history?.date_delivered) {
          await registrarEventoPedido(empresaId, filaPedido.id, "entrega", new Date(envio.status_history.date_delivered));
        }
        // Tarea 2.10 — misma cuenta, misma empresa: también se
        // sincroniza la fila de despachos_ml (imprimible, logistic_type)
        // para que /panel/despachos la encuentre lista desde la
        // importación inicial, sin esperar un aviso aparte.
        await sincronizarDespacho(empresaId, cuentaId, filaPedido.id, String(pedido.shipping.id)).catch((error) => {
          console.error("No se pudo sincronizar el despacho durante la importación:", error instanceof Error ? error.message : error);
        });
      }

      // Issue #130 — la foto financiera de la venta (cabecera, líneas y,
      // si ya hay costo en la maestra, el congelado). Un fallo acá no
      // corta la importación: la sincronización de ventas la retoma.
      await guardarOrdenMl(empresaId, cuentaId, accessToken, pedido as OrdenMl).catch((error) => {
        console.error("No se pudo guardar la venta en finanzas durante la importación:", error instanceof Error ? error.message : error);
      });

      pedidosImportados += 1;
      await dbComoEmpresa(empresaId, (tx) =>
        tx.update(importacionesMl).set({ pedidosImportados }).where(eq(importacionesMl.id, importacion.id))
      );
    }

    const { publicaciones: publicacionesReales, omitidas, motivos } = await traerPublicacionesReales(accessToken, cuentaIdExterna);
    await dbComoEmpresa(empresaId, (tx) =>
      tx.update(importacionesMl).set({ publicacionesEncontradas: publicacionesReales.length }).where(eq(importacionesMl.id, importacion.id))
    );
    let publicacionesImportadas = 0;
    for (const publicacion of publicacionesReales) {
      await dbComoEmpresa(empresaId, (tx) =>
        tx
          .insert(publicaciones)
          .values({
            empresaId,
            cuentaMlId: cuentaId,
            publicacionIdExterno: publicacion.id,
            titulo: publicacion.title,
            precio: String(publicacion.price),
            stock: publicacion.available_quantity,
          })
          .onConflictDoNothing({ target: [publicaciones.empresaId, publicaciones.publicacionIdExterno] })
      );
      publicacionesImportadas += 1;
      await dbComoEmpresa(empresaId, (tx) =>
        tx.update(importacionesMl).set({ publicacionesImportadas }).where(eq(importacionesMl.id, importacion.id))
      );
    }

    await dbComoEmpresa(empresaId, (tx) =>
      tx.update(importacionesMl).set({
        completadoTs: new Date(),
        // Aviso (no error rojo): la importación terminó pero hubo publicaciones ilegibles.
        error: omitidas > 0 ? `${PREFIJO_AVISO_IMPORTACION}${omitidas} publicaciones no se pudieron leer. Motivo: ${motivos.join("; ")}`.slice(0, 1000) : null,
      }).where(eq(importacionesMl.id, importacion.id))
    );
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido.";
    await dbComoEmpresa(empresaId, (tx) =>
      tx.update(importacionesMl).set({ error: mensaje, completadoTs: new Date() }).where(eq(importacionesMl.id, importacion.id))
    );
  }
}

// Tarea 2.5 — lee el progreso para la barra de /panel/conectar-ml.
export async function obtenerUltimaImportacion(empresaId: string, cuentaId: string) {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx
      .select()
      .from(importacionesMl)
      .where(eq(importacionesMl.cuentaMlId, cuentaId))
      .orderBy(desc(importacionesMl.iniciadoTs))
      .limit(1);
    return fila ?? null;
  });
}
