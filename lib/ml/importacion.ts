import { desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { importacionesMl, pedidos, publicaciones } from "@/db/schema";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { registrarEventoPedido } from "@/lib/ml/pedidos";
import { sincronizarDespacho } from "@/lib/ml/despachos";

const DIAS_HACIA_ATRAS = 60;
const TAMAÑO_PAGINA = 50;

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

async function traerPedidosReales(accessToken: string, cuentaIdExterna: string, desdeIso: string): Promise<PedidoMl[]> {
  const resultado: PedidoMl[] = [];
  let offset = 0;
  while (true) {
    const url = `https://api.mercadolibre.com/orders/search?seller=${cuentaIdExterna}&order.date_created.from=${encodeURIComponent(desdeIso)}&sort=date_desc&limit=${TAMAÑO_PAGINA}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al traer pedidos.`);
    const data = await res.json();
    const pagina: PedidoMl[] = data.results ?? [];
    resultado.push(...pagina);
    if (pagina.length < TAMAÑO_PAGINA) break;
    offset += TAMAÑO_PAGINA;
  }
  return resultado;
}

type PublicacionMl = { id: string; title: string; price: number; available_quantity: number };

async function traerPublicacionesReales(accessToken: string, cuentaIdExterna: string): Promise<PublicacionMl[]> {
  const ids: string[] = [];
  let offset = 0;
  while (true) {
    const url = `https://api.mercadolibre.com/users/${cuentaIdExterna}/items/search?status=active&limit=${TAMAÑO_PAGINA}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al listar publicaciones.`);
    const data = await res.json();
    const pagina: string[] = data.results ?? [];
    ids.push(...pagina);
    if (pagina.length < TAMAÑO_PAGINA) break;
    offset += TAMAÑO_PAGINA;
  }

  const publicacionesReales: PublicacionMl[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const url = `https://api.mercadolibre.com/items?ids=${lote.join(",")}&attributes=id,title,price,available_quantity`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al traer el detalle de publicaciones.`);
    const data = await res.json();
    for (const fila of data as Array<{ code: number; body: PublicacionMl }>) {
      if (fila.code === 200 && fila.body) publicacionesReales.push(fila.body);
    }
  }
  return publicacionesReales;
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
    const desdeIso = new Date(Date.now() - DIAS_HACIA_ATRAS * 24 * 60 * 60 * 1000).toISOString();

    const pedidosReales = await traerPedidosReales(accessToken, cuentaIdExterna, desdeIso);
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

      pedidosImportados += 1;
      await dbComoEmpresa(empresaId, (tx) =>
        tx.update(importacionesMl).set({ pedidosImportados }).where(eq(importacionesMl.id, importacion.id))
      );
    }

    const publicacionesReales = await traerPublicacionesReales(accessToken, cuentaIdExterna);
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
      tx.update(importacionesMl).set({ completadoTs: new Date() }).where(eq(importacionesMl.id, importacion.id))
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
