import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, ordenesCompra } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { requierePermiso } from "@/lib/permisos";
import { esUuid, validarPago } from "./gastos";
import { monedaDeEmpresa } from "./inventario-valorizado";
import { DIAS_POR_VENCER, type EstadoPorPagar, type FiltrosPorPagar, type OrigenPorPagar } from "./por-pagar";

// Issue #422 (fase 5 de Finanzas) — cuentas por pagar contra Postgres.
// Siempre dbComoEmpresa (RLS) y, además, empresa_id explícito en cada
// tabla y cada join. Las tarjetas salen de agregados en SQL (SUM …
// FILTER), nunca de sumar filas en memoria; la tabla sí trae filas, con
// tope. Los filtros viajan como parámetros: ningún dato del usuario
// llega a sql.raw ni a un identificador.

export class OrdenCompraNoEncontradaError extends Error {
  constructor() {
    // Mismo mensaje si no existe, es de otra empresa, está anulada o ya se pagó.
    super("Esa orden de compra no está pendiente de pago en esta empresa.");
    this.name = "OrdenCompraNoEncontradaError";
  }
}

export type FilaPorPagar = {
  origen: OrigenPorPagar;
  id: string;
  terceroId: string | null;
  beneficiario: string | null;
  proveedor: string | null;
  categoria: string | null;
  concepto: string;
  vence: string | null;
  valor: string;
  moneda: string;
  estado: EstadoPorPagar;
};

export type TotalesPorPagar = { moneda: string; total: string; vencido: string; porVencer: string; despues: string; partidas: number };

export type ProveedorOpcion = { clave: string; nombre: string };

const TOPE_FILAS = 1000;

// Todo lo pendiente de la empresa, ya clasificado por vencimiento.
function partidas(empresaId: string, monedaOrdenes: string, hoy: string): SQL {
  return sql`
    with base as (
      select 'gasto'::text as origen, g.id, g.tercero_id, g.beneficiario,
             coalesce(t.nombre, g.beneficiario) as proveedor, c.nombre as categoria,
             g.descripcion as concepto, g.fecha_vencimiento as vence, g.monto as valor, g.moneda
        from gastos g
        join categorias_gasto c on c.id = g.categoria_id and c.empresa_id = ${empresaId}
        left join terceros t on t.id = g.tercero_id and t.empresa_id = ${empresaId}
       where g.empresa_id = ${empresaId} and g.estado = 'pendiente'
      union all
      -- Lo que se debe de una orden = lo pedido × costo unitario. Las
      -- líneas sin costo no suman (no hay cómo saber cuánto se debe); una
      -- orden sin ningún costo no aparece.
      select 'orden'::text, o.id, o.tercero_id, null::text,
             t.nombre, null::text,
             'OC-' || o.numero, null::date, sum(i.cantidad_pedida * i.costo_unitario), ${monedaOrdenes}::text
        from ordenes_compra o
        join orden_compra_items i on i.orden_compra_id = o.id and i.empresa_id = ${empresaId}
        left join terceros t on t.id = o.tercero_id and t.empresa_id = ${empresaId}
       where o.empresa_id = ${empresaId} and o.estado <> 'anulada' and o.fecha_pago is null and i.costo_unitario is not null
       group by o.id, o.tercero_id, t.nombre, o.numero
      having sum(i.cantidad_pedida * i.costo_unitario) > 0
    )
    select *,
           case when vence is null then 'al_dia'
                when vence < ${hoy}::date then 'vencido'
                when vence <= ${hoy}::date + ${DIAS_POR_VENCER}::int then 'por_vencer'
                else 'al_dia' end as estado
      from base`;
}

function condiciones(f: FiltrosPorPagar): SQL {
  const partes: SQL[] = [sql`true`];
  if (f.origen) partes.push(sql`origen = ${f.origen}`);
  if (f.estado) partes.push(sql`estado = ${f.estado}`);
  if (f.proveedor?.tipo === "tercero") partes.push(sql`tercero_id = ${f.proveedor.id}::uuid`);
  if (f.proveedor?.tipo === "beneficiario") partes.push(sql`tercero_id is null and btrim(beneficiario) = ${f.proveedor.nombre}`);
  return sql.join(partes, sql` and `);
}

export async function leerPorPagar(
  empresaId: string,
  usuarioId: string,
  filtros: FiltrosPorPagar,
  hoy: string
): Promise<{ filas: FilaPorPagar[]; totales: TotalesPorPagar[]; proveedores: ProveedorOpcion[]; truncado: boolean }> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  return dbComoEmpresa(empresaId, async (tx) => {
    // Las órdenes de compra no guardan moneda: usan la de la empresa,
    // igual que los gastos sin tienda (lib/finanzas/gastos-db.ts).
    const cuentas = await tx.select({ moneda: cuentasMl.moneda }).from(cuentasMl).where(eq(cuentasMl.empresaId, empresaId));
    const pendientes = partidas(
      empresaId,
      monedaDeEmpresa(cuentas.map((c) => c.moneda)),
      hoy
    );
    const donde = condiciones(filtros);

    const totales = await tx.execute<{ moneda: string; total: string; vencido: string; por_vencer: string; despues: string; partidas: number }>(sql`
      select moneda,
             sum(valor)::numeric(14,2)::text as total,
             coalesce(sum(valor) filter (where estado = 'vencido'), 0)::numeric(14,2)::text as vencido,
             coalesce(sum(valor) filter (where estado = 'por_vencer'), 0)::numeric(14,2)::text as por_vencer,
             coalesce(sum(valor) filter (where estado = 'al_dia'), 0)::numeric(14,2)::text as despues,
             count(*)::int as partidas
        from (${pendientes}) p
       where ${donde}
       group by moneda
       order by moneda`);

    const filas = await tx.execute<{
      origen: OrigenPorPagar;
      id: string;
      tercero_id: string | null;
      beneficiario: string | null;
      proveedor: string | null;
      categoria: string | null;
      concepto: string;
      vence: string | null;
      valor: string;
      moneda: string;
      estado: EstadoPorPagar;
    }>(sql`
      select origen, id, tercero_id, beneficiario, proveedor, categoria, concepto,
             vence::text as vence, valor::numeric(14,2)::text as valor, moneda, estado
        from (${pendientes}) p
       where ${donde}
       order by vence asc nulls last, origen, concepto
       limit ${TOPE_FILAS + 1}`);

    // El selector muestra a todos a quienes se les debe algo, sin filtrar.
    const proveedores = await tx.execute<{ clave: string; nombre: string }>(sql`
      select distinct
             case when tercero_id is not null then 't:' || tercero_id::text else 'b:' || btrim(beneficiario) end as clave,
             coalesce(proveedor, 'Sin proveedor') as nombre
        from (${pendientes}) p
       where tercero_id is not null or char_length(btrim(coalesce(beneficiario, ''))) > 0
       order by nombre`);

    const lista = [...filas];
    return {
      filas: lista.slice(0, TOPE_FILAS).map((f) => ({
        origen: f.origen,
        id: f.id,
        terceroId: f.tercero_id,
        beneficiario: f.beneficiario,
        proveedor: f.proveedor,
        categoria: f.categoria,
        concepto: f.concepto,
        vence: f.vence,
        valor: f.valor,
        moneda: f.moneda,
        estado: f.estado,
      })),
      truncado: lista.length > TOPE_FILAS,
      totales: [...totales].map((t) => ({
        moneda: t.moneda,
        total: t.total,
        vencido: t.vencido,
        porVencer: t.por_vencer,
        despues: t.despues,
        partidas: t.partidas,
      })),
      proveedores: [...proveedores],
    };
  });
}

// Marca pagada una orden de compra en su propia tabla. El estado de
// recepción no se toca: pagar y recibir son cosas distintas.
export async function marcarOrdenCompraPagada(entrada: {
  empresaId: string;
  usuarioId: string;
  ordenId: string;
  fechaPago: string;
  medioPago: string;
}): Promise<void> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  if (!esUuid(entrada.ordenId)) throw new OrdenCompraNoEncontradaError();
  const pago = validarPago(entrada.fechaPago, entrada.medioPago);
  await dbComoEmpresa(entrada.empresaId, async (tx) => {
    const filas = await tx
      .update(ordenesCompra)
      .set({ fechaPago: pago.fechaPago, medioPago: pago.medioPago, actualizadoTs: new Date() })
      .where(
        and(
          eq(ordenesCompra.id, entrada.ordenId),
          eq(ordenesCompra.empresaId, entrada.empresaId),
          ne(ordenesCompra.estado, "anulada"),
          isNull(ordenesCompra.fechaPago)
        )
      )
      .returning({ numero: ordenesCompra.numero });
    if (filas.length === 0) throw new OrdenCompraNoEncontradaError();
    await registrarAuditoria(tx, {
      empresaId: entrada.empresaId,
      usuarioId: entrada.usuarioId,
      actorTipo: "persona",
      accion: "pagar",
      entidad: "orden_compra",
      entidadId: entrada.ordenId,
      detalle: `Marcó como pagada la orden de compra OC-${filas[0].numero} el ${pago.fechaPago}.`,
    });
  });
}
