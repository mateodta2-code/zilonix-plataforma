import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidoItems, pedidos } from "@/db/schema";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { estadoDeConversacion, leerConversacionMl, leerPendientesMl } from "@/lib/ml/mensajesPosventa";
import { etiquetaEstadoPedido } from "@/lib/ml/pedidos";
import type { FilaVenta } from "./filtros";

// Posventa-Mensajes (Refs #645) — ventas de los últimos 30 días de las
// cuentas conectadas, con el estado de su conversación leído EN VIVO de ML
// (siempre con mark_as_read=false). Se revisan las más recientes (tope) y
// con pocas lecturas en paralelo para no pasar el límite de ML. El pack no
// se guarda en la base: se usa el id de la orden (ML lo acepta cuando
// pack_id es null).
export const DIAS_VENTANA = 30;
export const TOPE_VENTAS_REVISADAS = 50;
const PARALELO = 5;

type Cuenta = { id: string; cuentaIdExterna: string; nickname: string; siteId: string | null; desconectadaTs: Date | null };

async function enLotes<T, R>(lista: T[], tarea: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = [];
  for (let i = 0; i < lista.length; i += PARALELO) salida.push(...(await Promise.all(lista.slice(i, i + PARALELO).map(tarea))));
  return salida;
}

export async function cargarVentasConMensajes(empresaId: string, cuentas: Cuenta[]): Promise<{ filas: FilaVenta[]; cuentasConFalla: number }> {
  const activas = cuentas.filter((c) => !c.desconectadaTs);
  const desde = new Date(Date.now() - DIAS_VENTANA * 24 * 3600 * 1000);
  const filas: FilaVenta[] = [];
  let cuentasConFalla = cuentas.length - activas.length;

  for (const cuenta of activas) {
    try {
      const { ventas, items } = await dbComoEmpresa(empresaId, async (tx) => {
        const ventas = await tx
          .select({ id: pedidos.id, ordenId: pedidos.pedidoIdExterno, fecha: pedidos.fecha, moneda: pedidos.moneda, estado: pedidos.estado })
          .from(pedidos)
          .where(and(eq(pedidos.empresaId, empresaId), eq(pedidos.cuentaMlId, cuenta.id), gte(pedidos.fecha, desde)))
          .orderBy(desc(pedidos.fecha))
          .limit(TOPE_VENTAS_REVISADAS);
        const items = ventas.length
          ? await tx
              .select({ pedidoId: pedidoItems.pedidoId, titulo: pedidoItems.titulo, imagenUrl: pedidoItems.imagenUrl, cantidad: pedidoItems.cantidad, precio: pedidoItems.precioUnitario })
              .from(pedidoItems)
              .where(and(eq(pedidoItems.empresaId, empresaId), inArray(pedidoItems.pedidoId, ventas.map((v) => v.id))))
              .orderBy(asc(pedidoItems.linea))
          : [];
        return { ventas, items };
      });
      if (ventas.length === 0) continue;
      const primero = new Map<string, (typeof items)[number]>();
      for (const it of items) if (!primero.has(it.pedidoId)) primero.set(it.pedidoId, it);

      const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
      const pendientes = await leerPendientesMl(token);
      const estados = await enLotes(ventas, async (v) => {
        try {
          const mensajes = await leerConversacionMl(v.ordenId, cuenta.cuentaIdExterna, token);
          return estadoDeConversacion(mensajes, pendientes.has(v.ordenId));
        } catch {
          return pendientes.has(v.ordenId) ? ("sin_leer" as const) : ("sin_mensajes" as const);
        }
      });
      ventas.forEach((v, i) => {
        const it = primero.get(v.id);
        filas.push({
          cuentaId: cuenta.id,
          cuentaNick: cuenta.nickname,
          siteId: cuenta.siteId,
          ordenId: v.ordenId,
          fecha: v.fecha.toISOString(),
          titulo: it?.titulo ?? "Venta",
          foto: it?.imagenUrl ?? null,
          precio: it ? Number(it.precio) : null,
          cantidad: it?.cantidad ?? null,
          moneda: v.moneda,
          estadoVenta: etiquetaEstadoPedido(v.estado),
          estadoMensaje: estados[i],
        });
      });
    } catch (error) {
      cuentasConFalla++;
      console.warn(`[panel/posventa/mensajes] cuenta ${cuenta.id}: ${error instanceof Error ? error.name : "error"}`);
    }
  }
  filas.sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
  return { filas, cuentasConFalla };
}
