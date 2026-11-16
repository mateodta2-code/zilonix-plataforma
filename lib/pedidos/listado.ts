import { and, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasFalabella, cuentasMl, despachosMl, pedidoItems, pedidos, pedidosFalabella } from "@/db/schema";
import { patronBusquedaLike } from "@/lib/filtros-listado";
import {
  crudosDe,
  ESTADOS_ENVIO_ML,
  ESTADOS_FALABELLA,
  ESTADOS_ORDEN_ML,
  estadoPedidoFalabella,
  estadoPedidoMl,
  type EstadoMostrado,
  type EstadoUnificado,
} from "./estados";
import { fuentesDeFiltros, TAMANO_PAGINA_PEDIDOS, type FiltrosPedidos } from "./filtros";
import { productosDeItemsFalabella } from "./marketplace";

// Issue #422 — lista unificada de /panel/pedidos (Mercado Libre +
// Falabella), solo informativa. REGLA de esta pantalla: ninguna consulta
// de acá selecciona costo, comisión, flete, empaque ni nada de
// pedidos_finanzas — esos datos son de Finanzas y Pedidos lo ve todo el
// equipo. Hay una prueba que lee este archivo y falla si aparecen.
//
// Paginación de una unión de dos tablas sin UNION en SQL: cada fuente
// trae, ya filtrada y ordenada, como máximo (página × 50) + 1 filas; se
// mezclan por fecha y se corta la página. Las 50 filas de la página N de
// la unión siempre están dentro de las primeras N × 50 de cada fuente,
// así que no se repite ni se salta ningún pedido; la fila extra dice si
// hay página siguiente.

export type ProductoListado = { nombre: string; sku: string | null; cantidad: number; imagenUrl: string | null };

export type PedidoListado = {
  clave: string;
  id: string;
  marketplace: "ml" | "falabella";
  pedidoIdExterno: string;
  fecha: Date;
  total: string;
  moneda: string;
  cuenta: string;
  estado: EstadoMostrado;
  productos: ProductoListado[];
};

export type ResultadoListado = { pedidos: PedidoListado[]; hayMas: boolean };

type Ordenable = { id: string; marketplace: "ml" | "falabella"; fecha: Date };

// Mismo orden que el ORDER BY de cada consulta (fecha desc, id desc),
// con el marketplace como desempate entre fuentes. Puro: se prueba solo.
export function compararPedidos(a: Ordenable, b: Ordenable): number {
  const porFecha = b.fecha.getTime() - a.fecha.getTime();
  if (porFecha !== 0) return porFecha;
  if (a.marketplace !== b.marketplace) return a.marketplace < b.marketplace ? -1 : 1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function mezclarYCortar<T extends Ordenable>(ml: T[], falabella: T[], pagina: number): { filas: T[]; hayMas: boolean } {
  const todas = [...ml, ...falabella].sort(compararPedidos);
  const inicio = (pagina - 1) * TAMANO_PAGINA_PEDIDOS;
  return { filas: todas.slice(inicio, inicio + TAMANO_PAGINA_PEDIDOS), hayMas: todas.length > pagina * TAMANO_PAGINA_PEDIDOS };
}

// GetOrderItems guarda una línea por OrderItemId y el tipo de
// lib/falabella/pedidos.ts no trae campo de cantidad: la cantidad es
// cuántas líneas comparten nombre y SKU. Falabella no guarda foto.
export function productosFalabellaAgrupados(items: unknown): ProductoListado[] {
  const grupos = new Map<string, ProductoListado>();
  for (const p of productosDeItemsFalabella(items)) {
    const clave = `${p.nombre}\u0000${p.sku ?? ""}`;
    const actual = grupos.get(clave);
    if (actual) actual.cantidad += 1;
    else grupos.set(clave, { nombre: p.nombre, sku: p.sku, cantidad: 1, imagenUrl: null });
  }
  return [...grupos.values()];
}

// IN con valores de NUESTRAS tablas de estados (nunca de la URL), siempre
// como parámetros. Lista vacía → false.
function enLista(expr: SQL, valores: string[]): SQL {
  if (valores.length === 0) return sql`false`;
  return sql`${expr} in (${sql.join(
    valores.map((v) => sql`${v}`),
    sql`, `
  )})`;
}

const envioMl = sql<string | null>`(select ${despachosMl.status} from ${despachosMl} where ${despachosMl.pedidoId} = ${pedidos.id} order by ${despachosMl.actualizadoTs} desc limit 1)`;
const envioMlNormalizado = sql`lower(trim(${envioMl}))`;
const ordenMlNormalizada = sql`lower(trim(${pedidos.estado}))`;

// Traducción a SQL de estadoPedidoMl (lib/pedidos/estados.ts).
function condicionEstadoMl(estado: EstadoUnificado): SQL {
  const ordenCancelada = enLista(ordenMlNormalizada, crudosDe(ESTADOS_ORDEN_ML, "cancelado"));
  const porEnvio = enLista(envioMlNormalizado, crudosDe(ESTADOS_ENVIO_ML, estado));
  if (estado === "cancelado") return sql`(${ordenCancelada} or ${porEnvio})`;
  const sinEnvio = sql`nullif(trim(${envioMl}), '') is null`;
  const porOrden = enLista(ordenMlNormalizada, crudosDe(ESTADOS_ORDEN_ML, estado));
  return sql`(not ${ordenCancelada} and (${porEnvio} or (${sinEnvio} and ${porOrden})))`;
}

function condicionEstadoFalabella(estado: EstadoUnificado): SQL {
  return enLista(sql`lower(trim(${pedidosFalabella.estado}))`, crudosDe(ESTADOS_FALABELLA, estado));
}

export async function listarPedidosUnificados(empresaId: string, filtros: FiltrosPedidos): Promise<ResultadoListado> {
  if (!filtros.rango) return { pedidos: [], hayMas: false };
  const { inicio, finExclusivo } = filtros.rango;
  const fuentes = fuentesDeFiltros(filtros);
  const tope = filtros.pagina * TAMANO_PAGINA_PEDIDOS + 1;
  const patron = patronBusquedaLike(filtros.q);

  return dbComoEmpresa(empresaId, async (tx) => {
    const filasMl = fuentes.ml
      ? await tx
          .select({
            id: pedidos.id,
            pedidoIdExterno: pedidos.pedidoIdExterno,
            fecha: pedidos.fecha,
            total: pedidos.total,
            moneda: pedidos.moneda,
            estado: pedidos.estado,
            estadoEnvio: envioMl,
            cuenta: cuentasMl.nickname,
          })
          .from(pedidos)
          .innerJoin(cuentasMl, eq(cuentasMl.id, pedidos.cuentaMlId))
          .where(
            and(
              gte(pedidos.fecha, inicio),
              lt(pedidos.fecha, finExclusivo),
              filtros.tienda?.marketplace === "ml" ? eq(pedidos.cuentaMlId, filtros.tienda.id) : undefined,
              filtros.estado ? condicionEstadoMl(filtros.estado) : undefined,
              patron
                ? or(
                    ilike(pedidos.pedidoIdExterno, patron),
                    sql`exists (select 1 from ${pedidoItems} where ${pedidoItems.pedidoId} = ${pedidos.id} and (${pedidoItems.titulo} ilike ${patron} or ${pedidoItems.skuCodigo} ilike ${patron}))`
                  )
                : undefined
            )
          )
          .orderBy(desc(pedidos.fecha), desc(pedidos.id))
          .limit(tope)
      : [];

    const filasFalabella = fuentes.falabella
      ? await tx
          .select({
            id: pedidosFalabella.id,
            pedidoIdExterno: pedidosFalabella.pedidoIdExterno,
            fecha: pedidosFalabella.fecha,
            total: pedidosFalabella.total,
            moneda: pedidosFalabella.moneda,
            estado: pedidosFalabella.estado,
            items: pedidosFalabella.items,
            cuenta: cuentasFalabella.nickname,
          })
          .from(pedidosFalabella)
          .innerJoin(cuentasFalabella, eq(cuentasFalabella.id, pedidosFalabella.cuentaFalabellaId))
          .where(
            and(
              gte(pedidosFalabella.fecha, inicio),
              lt(pedidosFalabella.fecha, finExclusivo),
              filtros.tienda?.marketplace === "falabella" ? eq(pedidosFalabella.cuentaFalabellaId, filtros.tienda.id) : undefined,
              filtros.estado ? condicionEstadoFalabella(filtros.estado) : undefined,
              patron
                ? or(
                    ilike(pedidosFalabella.pedidoIdExterno, patron),
                    // CASE y no AND: jsonb_array_elements falla si items no es arreglo.
                    sql`case when jsonb_typeof(${pedidosFalabella.items}) = 'array' then exists (select 1 from jsonb_array_elements(${pedidosFalabella.items}) e where e->>'Name' ilike ${patron} or e->>'Sku' ilike ${patron}) else false end`
                  )
                : undefined
            )
          )
          .orderBy(desc(pedidosFalabella.fecha), desc(pedidosFalabella.id))
          .limit(tope)
      : [];

    type Fila =
      | ((typeof filasMl)[number] & { marketplace: "ml" })
      | ((typeof filasFalabella)[number] & { marketplace: "falabella" });
    const { filas, hayMas } = mezclarYCortar<Fila>(
      filasMl.map((f) => ({ ...f, marketplace: "ml" as const })),
      filasFalabella.map((f) => ({ ...f, marketplace: "falabella" as const })),
      filtros.pagina
    );

    // Productos de ML solo de los pedidos de esta página (sin costos).
    const idsMl = filas.filter((f) => f.marketplace === "ml").map((f) => f.id);
    const lineasMl =
      idsMl.length > 0
        ? await tx
            .select({
              pedidoId: pedidoItems.pedidoId,
              titulo: pedidoItems.titulo,
              skuCodigo: pedidoItems.skuCodigo,
              cantidad: pedidoItems.cantidad,
              imagenUrl: pedidoItems.imagenUrl,
            })
            .from(pedidoItems)
            .where(inArray(pedidoItems.pedidoId, idsMl))
            .orderBy(pedidoItems.pedidoId, pedidoItems.linea)
        : [];
    const productosPorPedido = new Map<string, ProductoListado[]>();
    for (const l of lineasMl) {
      const lista = productosPorPedido.get(l.pedidoId) ?? [];
      lista.push({ nombre: l.titulo, sku: l.skuCodigo, cantidad: l.cantidad, imagenUrl: l.imagenUrl });
      productosPorPedido.set(l.pedidoId, lista);
    }

    return {
      hayMas,
      pedidos: filas.map((f): PedidoListado => {
        const base = {
          clave: `${f.marketplace}:${f.id}`,
          id: f.id,
          marketplace: f.marketplace,
          pedidoIdExterno: f.pedidoIdExterno,
          fecha: f.fecha,
          total: f.total,
          moneda: f.moneda,
          cuenta: f.cuenta,
        };
        if (f.marketplace === "ml") {
          return { ...base, estado: estadoPedidoMl(f.estado, f.estadoEnvio), productos: productosPorPedido.get(f.id) ?? [] };
        }
        return { ...base, estado: estadoPedidoFalabella(f.estado), productos: productosFalabellaAgrupados(f.items) };
      }),
    };
  });
}
