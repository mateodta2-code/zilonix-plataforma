// Issue #280 — empuja a Mercado Libre el disponible de Seller (la
// fuente de verdad del stock) para cada publicación enlazada a un SKU.
// Cantidad = max(0, disponible de las bodegas que suman al publicado −
// buffer_ml); un kit publica cuántos se pueden armar.
//
// Espera (debounce): aplicarMovimientos marca el SKU pendiente y este
// trabajo solo toma los que llevan al menos ESPERA_MS marcados, así una
// recepción de 20 líneas o varios pedidos seguidos son un solo PUT por
// publicación. La marca se borra ANTES de enviar: si entra otro
// movimiento mientras tanto, vuelve a quedar pendiente y sale en la
// próxima corrida (nunca se pierde un cambio).
//
// Lo que Fase 1 NO envía (queda escrito en sync_stock_ml.ultimo_resultado):
// - Publicaciones Full (shipping.logistic_type = fulfillment): ML maneja
//   ese stock; mezclar Full + bodega va por /user-products/{id}/stock,
//   sin confirmar en Colombia (diagnóstico en zilonix-os,
//   app/api/ml/diagnostico-user-product).
// - Publicaciones con variaciones: el cuerpo es variations[].available_quantity
//   (confirmado en zilonix-os, lib/inventario-recompras.js) y pide mapear
//   cada variación a su SKU, que hoy no existe en `publicaciones`.
// Disponible 0 se manda como available_quantity 0 (no se pausa a mano):
// supuesto de la pregunta abierta 3, sin confirmar con un caso real.
//
// Hoy corre por empresa, desde el botón "Sincronizar ahora" de
// /panel/inventario/configuracion. El cron para todas las empresas
// necesita su propio usuario de base (como publicidad_trabajador_user)
// y queda para la 1.1. Toda llamada a ML pasa por lib/ml/cliente.ts.

import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, publicaciones, syncStockMl } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { cantidadAPublicar, motivoDeItem, type ItemMlStock, type ResultadoPublicacion } from "@/lib/inventario/calculos";
import { leerConfiguracionInventario } from "@/lib/inventario/configuracion";
import { disponiblePublicado } from "@/lib/inventario/stock";
import { actualizarItemMl, LimiteMercadoLibreError, PATRON_ID_PRODUCTO_O_ITEM, pedirLecturaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";

export const ESPERA_MS = 60_000;
const LOTE_SKUS = 50;

export type ResultadoSyncStock = {
  estado: "apagado" | "ok" | "cortado_por_limite";
  skus: number;
  enviadas: number;
  omitidas: number;
  fallidas: number;
};

async function enviarPublicacion(itemId: string, token: string, cantidad: number): Promise<ResultadoPublicacion> {
  const lectura = await pedirLecturaMl<ItemMlStock>(`/items/${encodeURIComponent(itemId)}`, token, {
    query: "?attributes=id,variations,shipping",
  });
  if (!lectura.ok) return "no_encontrada";
  const motivo = motivoDeItem(lectura.data);
  if (motivo) return motivo;
  const resp = await actualizarItemMl(itemId, token, { available_quantity: cantidad });
  return resp.ok ? "enviada" : "rechazada";
}

export async function sincronizarStockMlEmpresa(
  empresaId: string,
  opciones: { ahora?: Date; ignorarEspera?: boolean; usuarioId?: string | null } = {}
): Promise<ResultadoSyncStock> {
  const resultado: ResultadoSyncStock = { estado: "ok", skus: 0, enviadas: 0, omitidas: 0, fallidas: 0 };
  const config = await leerConfiguracionInventario(empresaId);
  if (!config.syncMlActivo) return { ...resultado, estado: "apagado" };

  const ahora = opciones.ahora ?? new Date();
  const limite = opciones.ignorarEspera ? ahora : new Date(ahora.getTime() - ESPERA_MS);
  const pendientes = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ skuId: syncStockMl.skuId, marca: syncStockMl.pendienteDesdeTs })
      .from(syncStockMl)
      .where(and(eq(syncStockMl.empresaId, empresaId), isNotNull(syncStockMl.pendienteDesdeTs), lte(syncStockMl.pendienteDesdeTs, limite)))
      .orderBy(syncStockMl.pendienteDesdeTs)
      .limit(LOTE_SKUS)
  );

  const tokens = new Map<string, string | null>();
  async function tokenDe(cuentaMlId: string): Promise<string | null> {
    if (!tokens.has(cuentaMlId)) {
      tokens.set(cuentaMlId, await obtenerAccessTokenVigente(empresaId, cuentaMlId).catch(() => null));
    }
    return tokens.get(cuentaMlId) ?? null;
  }

  for (const { skuId } of pendientes) {
    resultado.skus += 1;
    await dbComoEmpresa(empresaId, (tx) =>
      tx.update(syncStockMl).set({ pendienteDesdeTs: null }).where(and(eq(syncStockMl.empresaId, empresaId), eq(syncStockMl.skuId, skuId)))
    );
    const cantidad = cantidadAPublicar((await disponiblePublicado(empresaId, [skuId])).get(skuId) ?? 0, config.bufferMl);
    const pubs = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({ itemId: publicaciones.publicacionIdExterno, cuentaMlId: publicaciones.cuentaMlId })
        .from(publicaciones)
        .innerJoin(cuentasMl, eq(cuentasMl.id, publicaciones.cuentaMlId))
        .where(and(eq(publicaciones.empresaId, empresaId), eq(publicaciones.skuId, skuId), isNull(cuentasMl.desconectadaTs)))
    );

    const conteo = new Map<ResultadoPublicacion, number>();
    try {
      for (const pub of pubs) {
        if (!PATRON_ID_PRODUCTO_O_ITEM.test(pub.itemId)) continue;
        const token = await tokenDe(pub.cuentaMlId);
        const r: ResultadoPublicacion = token ? await enviarPublicacion(pub.itemId, token, cantidad) : "rechazada";
        conteo.set(r, (conteo.get(r) ?? 0) + 1);
        if (r === "enviada") resultado.enviadas += 1;
        else if (r === "rechazada" || r === "no_encontrada") resultado.fallidas += 1;
        else resultado.omitidas += 1;
      }
    } catch (error) {
      // Se vuelve a marcar pendiente para no perder el cambio.
      await dbComoEmpresa(empresaId, (tx) =>
        tx
          .update(syncStockMl)
          .set({ pendienteDesdeTs: sql`coalesce(${syncStockMl.pendienteDesdeTs}, now())` })
          .where(and(eq(syncStockMl.empresaId, empresaId), eq(syncStockMl.skuId, skuId)))
      );
      if (error instanceof LimiteMercadoLibreError) {
        resultado.estado = "cortado_por_limite";
        break;
      }
      throw error;
    }

    const fallo = (conteo.get("rechazada") ?? 0) + (conteo.get("no_encontrada") ?? 0);
    const texto =
      pubs.length === 0
        ? "Sin publicaciones enlazadas."
        : [...conteo].map(([r, n]) => `${n} ${r.replace("_", " ")}`).join(", ") || "Sin publicaciones válidas.";
    await dbComoEmpresa(empresaId, async (tx) => {
      await tx
        .update(syncStockMl)
        .set({
          ultimoEnvioTs: ahora,
          ultimaCantidadEnviada: cantidad,
          ultimoResultado: texto.slice(0, 200),
          // Un rechazo de ML (ej. not_modifiable mientras revisa la
          // publicación) se reintenta en la próxima corrida.
          ...(fallo > 0 ? { pendienteDesdeTs: sql`coalesce(${syncStockMl.pendienteDesdeTs}, now())` } : {}),
        })
        .where(and(eq(syncStockMl.empresaId, empresaId), eq(syncStockMl.skuId, skuId)));
    });
  }

  await dbComoEmpresa(empresaId, (tx) =>
    registrarAuditoria(tx, {
      empresaId,
      usuarioId: opciones.usuarioId ?? null,
      actorTipo: opciones.usuarioId ? "persona" : "sistema",
      accion: "inventario.sync_stock_ml",
      entidad: "sync_stock_ml",
      detalle: `${resultado.skus} SKU: ${resultado.enviadas} enviada(s), ${resultado.omitidas} omitida(s), ${resultado.fallidas} con error.${resultado.estado === "cortado_por_limite" ? " Cortado por límite de ML." : ""}`,
    })
  );
  return resultado;
}
