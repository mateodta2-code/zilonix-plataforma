import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, ordenesCompra, pagosTercerosVentas } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { requierePermiso } from "@/lib/permisos";
import { esUuid, validarPago } from "./gastos";
import { monedaDeEmpresa } from "./inventario-valorizado";
import { DIAS_POR_VENCER, type EstadoPorPagar, type FiltrosPorPagar, type OrigenPorPagar } from "./por-pagar";
import { leerClaveVentas } from "./por-pagar-ventas";

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

export class PartidaVentasNoPendienteError extends Error {
  constructor() {
    // Mismo mensaje si la clave no es válida, es de otra empresa o ya se pagó.
    super("Esa partida de ventas ya no tiene nada pendiente de pago.");
    this.name = "PartidaVentasNoPendienteError";
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

// Por pagar automático (28-nov): lo que las ventas despachadas le deben a
// cada tercero (empaque y envío congelados con su tercero), agrupado por
// el periodo de cobro del tercero, menos lo ya pagado
// (pagos_terceros_ventas). Solo ventas despachadas desde
// empresas.por_pagar_ventas_desde; una cancelada o devuelta después del
// despacho se paga igual (decisiones de Sharel, por-pagar-ventas.ts).
// Periodos: «inmediato» = el día; cuenta de cobro semanal = lunes a
// domingo; quincenal = 1-15 y 16-fin de mes; mensual = el mes. Vence el
// mismo día («inmediato») o el cierre + plazo del tercero (si no, el de
// la empresa). «Anticipado Full» no genera deuda.
function partidasVentas(empresaId: string): SQL {
  return sql`
    ventas_dia as (
      select x.tercero_id, (pf.fecha_despacho at time zone 'America/Bogota')::date as dia,
             cm.moneda, x.monto, pf.pedido_id
        from pedidos_finanzas pf
        join empresas e on e.id = pf.empresa_id
        join cuentas_ml cm on cm.id = pf.cuenta_ml_id and cm.empresa_id = ${empresaId}
        cross join lateral (values (pf.empaque_tercero_id, pf.empaque_congelado),
                                   (pf.envio_tercero_id, pf.envio_agencia_congelado)) as x(tercero_id, monto)
       where pf.empresa_id = ${empresaId}
         and pf.fecha_despacho is not null
         and pf.fecha_despacho >= e.por_pagar_ventas_desde
         and x.tercero_id is not null and x.monto > 0
    ),
    ventas_periodo as (
      select v.tercero_id, t.nombre, t.condicion_pago, t.plazo_dias, v.moneda, v.monto, v.pedido_id,
             case when t.condicion_pago = 'inmediato' then v.dia
                  when t.periodicidad = 'semanal' then date_trunc('week', v.dia::timestamp)::date
                  when t.periodicidad = 'quincenal' and extract(day from v.dia) > 15 then date_trunc('month', v.dia::timestamp)::date + 15
                  else date_trunc('month', v.dia::timestamp)::date end as desde,
             case when t.condicion_pago = 'inmediato' then v.dia
                  when t.periodicidad = 'semanal' then date_trunc('week', v.dia::timestamp)::date + 6
                  when t.periodicidad = 'quincenal' and extract(day from v.dia) <= 15 then date_trunc('month', v.dia::timestamp)::date + 14
                  else (date_trunc('month', v.dia::timestamp) + interval '1 month - 1 day')::date end as hasta
        from ventas_dia v
        join terceros t on t.id = v.tercero_id and t.empresa_id = ${empresaId}
       where t.condicion_pago <> 'anticipado_full_ml'
    ),
    ventas_agr as (
      select tercero_id, nombre, condicion_pago, plazo_dias, desde, hasta, moneda,
             sum(monto) as total, count(distinct pedido_id)::int as ventas
        from ventas_periodo
       group by tercero_id, nombre, condicion_pago, plazo_dias, desde, hasta, moneda
    ),
    pagado as (
      select tercero_id, periodo_desde, moneda, sum(monto) as pagado
        from pagos_terceros_ventas
       where empresa_id = ${empresaId}
       group by tercero_id, periodo_desde, moneda
    ),
    plazo_empresa as (
      select coalesce((select plazo_vencimiento_dias from configuracion_finanzas where empresa_id = ${empresaId}), 3) as dias
    ),
    ventas_pendientes as (
      select a.tercero_id, a.nombre, a.desde, a.hasta, a.moneda, a.ventas,
             a.total - coalesce(p.pagado, 0) as valor,
             case when a.condicion_pago = 'inmediato' then a.hasta
                  else a.hasta + coalesce(a.plazo_dias, (select dias from plazo_empresa)) end as vence
        from ventas_agr a
        left join pagado p on p.tercero_id = a.tercero_id and p.periodo_desde = a.desde and p.moneda = a.moneda
       where a.total - coalesce(p.pagado, 0) > 0
    )`;
}

// Todo lo pendiente de la empresa, ya clasificado por vencimiento.
function partidas(empresaId: string, monedaOrdenes: string, hoy: string): SQL {
  return sql`
    with ${partidasVentas(empresaId)},
    base as (
      select 'gasto'::text as origen, g.id::text as id, g.tercero_id, g.beneficiario,
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
      select 'orden'::text, o.id::text, o.tercero_id, null::text,
             t.nombre, null::text,
             'OC-' || o.numero, null::date, sum(i.cantidad_pedida * i.costo_unitario), ${monedaOrdenes}::text
        from ordenes_compra o
        join orden_compra_items i on i.orden_compra_id = o.id and i.empresa_id = ${empresaId}
        left join terceros t on t.id = o.tercero_id and t.empresa_id = ${empresaId}
       where o.empresa_id = ${empresaId} and o.estado <> 'anulada' and o.fecha_pago is null and i.costo_unitario is not null
       group by o.id, o.tercero_id, t.nombre, o.numero
      having sum(i.cantidad_pedida * i.costo_unitario) > 0
      union all
      -- Ventas: id = tercero|inicio del periodo|moneda (por-pagar-ventas.ts).
      select 'ventas'::text, v.tercero_id::text || '|' || v.desde::text || '|' || v.moneda, v.tercero_id, null::text,
             v.nombre, null::text,
             'Empaque y envío de ' || v.ventas || case when v.ventas = 1 then ' venta despachada ' else ' ventas despachadas ' end ||
               case when v.desde = v.hasta then 'el ' || v.desde::text else 'del ' || v.desde::text || ' al ' || v.hasta::text end,
             v.vence, v.valor, v.moneda
        from ventas_pendientes v
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

// Por pagar automático (28-nov) — «Marcar pagado» de una partida de
// ventas: registra un pago por lo pendiente de ESE tercero, periodo y
// moneda, recalculado acá (nunca el monto que mande el formulario). Si
// después llega una venta tarde a ese periodo, queda pendiente solo la
// diferencia.
export async function marcarVentasPagadas(entrada: {
  empresaId: string;
  usuarioId: string;
  clave: string;
  fechaPago: string;
  medioPago: string;
}): Promise<void> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  const clave = leerClaveVentas(entrada.clave);
  if (!clave) throw new PartidaVentasNoPendienteError();
  const pago = validarPago(entrada.fechaPago, entrada.medioPago);
  await dbComoEmpresa(entrada.empresaId, async (tx) => {
    // Bloquea al tercero hasta el fin de la transacción: dos «Marcar
    // pagado» seguidos de la misma partida no registran dos pagos (el
    // segundo ya ve el primero y no encuentra nada pendiente).
    const bloqueado = await tx.execute(sql`
      select id from terceros where id = ${clave.terceroId}::uuid and empresa_id = ${entrada.empresaId} for update`);
    if ([...bloqueado].length === 0) throw new PartidaVentasNoPendienteError();
    const [pendiente] = await tx.execute<{ hasta: string; valor: string; nombre: string }>(sql`
      with ${partidasVentas(entrada.empresaId)}
      select hasta::text as hasta, valor::numeric(14,2)::text as valor, nombre
        from ventas_pendientes
       where tercero_id = ${clave.terceroId}::uuid and desde = ${clave.desde}::date and moneda = ${clave.moneda}`);
    if (!pendiente) throw new PartidaVentasNoPendienteError();
    await tx.insert(pagosTercerosVentas).values({
      empresaId: entrada.empresaId,
      terceroId: clave.terceroId,
      periodoDesde: clave.desde,
      periodoHasta: pendiente.hasta,
      moneda: clave.moneda,
      monto: pendiente.valor,
      fechaPago: pago.fechaPago,
      medioPago: pago.medioPago,
      creadoPor: entrada.usuarioId,
    });
    await registrarAuditoria(tx, {
      empresaId: entrada.empresaId,
      usuarioId: entrada.usuarioId,
      actorTipo: "persona",
      accion: "pagar",
      entidad: "pago_tercero_ventas",
      entidadId: clave.terceroId,
      detalle: `Marcó como pagado a ${pendiente.nombre} el empaque y envío de las ventas del ${clave.desde} al ${pendiente.hasta}: ${pendiente.valor} ${clave.moneda}, el ${pago.fechaPago}.`,
    });
  });
}
