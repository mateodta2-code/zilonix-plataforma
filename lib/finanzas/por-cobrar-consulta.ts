import { and, asc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasFalabella, cuentasMl, cuentasMp, movimientosMarketplace, pagosMpPorCobrar, pedidos, pedidosFinanzas } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { esUuid } from "@/lib/inventario/calculos";
import { obtenerSitioDeCuenta } from "@/lib/ml/cuentas";
import { ESTADO_LIBERADO } from "@/lib/ml/liberacion";
import {
  CandadoRenovacionMpError,
  CuentaMpDesconectadaError,
  CuentaMpNoEncontradaError,
  obtenerAccessTokenMpVigente,
  RenovacionTokenMpFallidaError,
} from "@/lib/mp/cuentas";
import { buscarPagosPendientesMp, ErrorPagosMp, type CodigoErrorPagosMp } from "@/lib/mp/pagos-por-cobrar";
import { requierePermiso } from "@/lib/permisos";
import { emparejarCuentasMp, ESTADOS_FALABELLA_POR_COBRAR, esEstadoFalabellaPorCobrar, extraerFechaProgramadaFalabella, type PartidaPorCobrar } from "./por-cobrar";

// Issue #422 (cuentas por cobrar) — lee lo que las plataformas le deben
// a la empresa de la sesión. Siempre dbComoEmpresa (RLS): nunca se ve una
// partida de otra empresa. requierePermiso también acá, para quien llame
// sin pasar por app/.
//
// Mercado Libre: ventas no canceladas con la plata sin liberar
// (estado_liberacion distinto de «released»). Revisión del PR #486: una
// fecha ya pasada NO se esconde (la pantalla la marca «vencida») y una
// pendiente sin neto tampoco (monto null, se muestra «sin neto»).
//
// Además de RLS, cada consulta filtra empresa_id explícito (también en los
// joins): si un día la política se afloja por error, esto no mezcla
// empresas igual.
//
// Falabella: líneas en Abierto / Procesando cierre / Pago programado /
// Programado para AAAA-MM-DD (esa fecha es la fecha esperada),
// sumadas por corte (cuenta + Nº de estado de cuenta + moneda).
//
// Mercado Pago: si la cuenta ML tiene una cuenta MP con el mismo user_id
// ya sincronizada («Actualizar desde Mercado Pago»), sus partidas salen de
// pagos_mp_por_cobrar (fuente «mp») y no de pedidos_finanzas: nunca las
// dos a la vez.

export async function leerPartidasPorCobrar(empresaId: string, usuarioId: string): Promise<PartidaPorCobrar[]> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");

  const { ml, falabella, cuentasMpLeidas, pagosMp, cuentasMlTodas } = await dbComoEmpresa(empresaId, async (tx) => {
    const pf = pedidosFinanzas;
    const ml = await tx
      .select({
        cuentaId: cuentasMl.id,
        cuenta: cuentasMl.nickname,
        referencia: pedidos.pedidoIdExterno,
        estado: pf.estadoLiberacion,
        fechaEsperada: sql<string | null>`(${pf.fechaLiberacion} at time zone 'America/Bogota')::date::text`,
        monto: sql<string | null>`${pf.montoPorLiberar}::text`,
      })
      .from(pf)
      .innerJoin(pedidos, and(eq(pedidos.id, pf.pedidoId), eq(pedidos.empresaId, empresaId)))
      .innerJoin(cuentasMl, and(eq(cuentasMl.id, pf.cuentaMlId), eq(cuentasMl.empresaId, empresaId)))
      .where(
        and(
          eq(pf.empresaId, empresaId),
          eq(pf.cancelada, false),
          isNotNull(pf.estadoLiberacion),
          ne(pf.estadoLiberacion, ESTADO_LIBERADO),
          // Una venta ya liberada del todo queda en 0.00: no es deuda.
          sql`${pf.montoPorLiberar} is distinct from 0`
        )
      );

    const m = movimientosMarketplace;
    const falabella = await tx
      .select({
        cuentaId: cuentasFalabella.id,
        cuenta: cuentasFalabella.nickname,
        estadoCuenta: m.estadoCuenta,
        moneda: m.moneda,
        estados: sql<string[]>`array_agg(distinct ${m.estadoPago})`,
        monto: sql<string>`sum(${m.monto})::text`,
      })
      .from(m)
      .innerJoin(cuentasFalabella, and(eq(cuentasFalabella.id, m.cuentaFalabellaId), eq(cuentasFalabella.empresaId, empresaId)))
      .where(and(eq(m.empresaId, empresaId), eq(m.marketplace, "falabella"), or(inArray(m.estadoPago, [...ESTADOS_FALABELLA_POR_COBRAR]), ilike(m.estadoPago, "Programado para %"))))
      .groupBy(cuentasFalabella.id, cuentasFalabella.nickname, m.estadoCuenta, m.moneda)
      .having(sql`sum(${m.monto}) <> 0`);

    // Mercado Pago: cuentas activas ya sincronizadas y su última foto.
    const cuentasMpLeidas = await tx
      .select({ id: cuentasMp.id, cuentaIdExterna: cuentasMp.cuentaIdExterna, nickname: cuentasMp.nickname })
      .from(cuentasMp)
      .where(and(eq(cuentasMp.empresaId, empresaId), isNull(cuentasMp.desconectadaTs), isNotNull(cuentasMp.porCobrarSincronizadoTs)));

    const pm = pagosMpPorCobrar;
    const pagosMp = await tx
      .select({
        cuentaMpId: pm.cuentaMpId,
        pagoIdExterno: pm.pagoIdExterno,
        ordenIdExterno: pm.ordenIdExterno,
        estado: pm.estado,
        tipo: pm.tipo,
        moneda: pm.moneda,
        fechaEsperada: sql<string | null>`(${pm.fechaLiberacion} at time zone 'America/Bogota')::date::text`,
        monto: sql<string | null>`${pm.montoNeto}::text`,
      })
      .from(pm)
      .innerJoin(
        cuentasMp,
        and(eq(cuentasMp.id, pm.cuentaMpId), eq(cuentasMp.empresaId, empresaId), isNull(cuentasMp.desconectadaTs), isNotNull(cuentasMp.porCobrarSincronizadoTs))
      )
      .where(eq(pm.empresaId, empresaId));

    // Para emparejar cuenta ML ↔ cuenta MP por user_id (cuenta_id_externa).
    const cuentasMlTodas = await tx
      .select({ id: cuentasMl.id, cuentaIdExterna: cuentasMl.cuentaIdExterna, nickname: cuentasMl.nickname })
      .from(cuentasMl)
      .where(eq(cuentasMl.empresaId, empresaId));

    return { ml, falabella, cuentasMpLeidas, pagosMp, cuentasMlTodas };
  });

  // Sin doble conteo (ver emparejarCuentasMp).
  const { reemplazadas, destinoMp } = emparejarCuentasMp(cuentasMlTodas, cuentasMpLeidas);

  // La moneda de ML es la del sitio de cada cuenta, nunca una fija.
  const mlEstimado = ml.filter((v) => !reemplazadas.has(v.cuentaId));
  const monedas = new Map<string, string>();
  for (const id of new Set(mlEstimado.map((v) => v.cuentaId))) {
    monedas.set(id, (await obtenerSitioDeCuenta(empresaId, id)).moneda);
  }

  return [
    ...mlEstimado.map((v) => ({
      marketplace: "ml" as const,
      fuente: "ventas" as const,
      retenido: false,
      cuentaId: v.cuentaId,
      cuenta: v.cuenta,
      moneda: monedas.get(v.cuentaId)!,
      referencia: v.referencia,
      estado: v.estado,
      fechaEsperada: v.fechaEsperada,
      monto: v.monto,
    })),
    ...pagosMp.map((p) => {
      const destino = destinoMp.get(p.cuentaMpId)!;
      return {
        marketplace: "ml" as const,
        fuente: "mp" as const,
        retenido: p.tipo === "retenido",
        cuentaId: destino.cuentaId,
        cuenta: destino.cuenta,
        moneda: p.moneda,
        referencia: p.ordenIdExterno ? `${p.ordenIdExterno} (pago ${p.pagoIdExterno})` : `Pago ${p.pagoIdExterno}`,
        estado: p.estado,
        fechaEsperada: p.fechaEsperada,
        monto: p.monto,
      };
    }),
    ...falabella.map((c) => ({
      marketplace: "falabella" as const,
      fuente: "falabella" as const,
      retenido: false,
      cuentaId: c.cuentaId,
      cuenta: c.cuenta,
      moneda: c.moneda,
      referencia: c.estadoCuenta ?? "Sin estado de cuenta todavía",
      estado: c.estados.filter(esEstadoFalabellaPorCobrar).sort().join(", ") || null,
      // Solo «Programado para AAAA-MM-DD» trae fecha; los cortes abiertos
      // siguen sin fecha (decisión 19-nov: no se estima).
      fechaEsperada: extraerFechaProgramadaFalabella(c.estados),
      monto: c.monto,
    })),
  ];
}

// ---------- Mercado Pago («Actualizar desde Mercado Pago») ----------

export type CuentaMpPorCobrar = {
  id: string;
  cuentaIdExterna: string;
  nickname: string | null;
  porCobrarSincronizadoTs: Date | null;
  ultimoErrorPorCobrar: string | null;
};

// Cuentas de Mercado Pago activas con su última sincronización. Sin
// llamadas a Mercado Pago: la página carga rápido y una cuenta caída no
// la tumba.
export async function leerCuentasMpPorCobrar(empresaId: string, usuarioId: string): Promise<CuentaMpPorCobrar[]> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: cuentasMp.id,
        cuentaIdExterna: cuentasMp.cuentaIdExterna,
        nickname: cuentasMp.nickname,
        porCobrarSincronizadoTs: cuentasMp.porCobrarSincronizadoTs,
        ultimoErrorPorCobrar: cuentasMp.ultimoErrorPorCobrar,
      })
      .from(cuentasMp)
      .where(and(eq(cuentasMp.empresaId, empresaId), isNull(cuentasMp.desconectadaTs)))
      .orderBy(asc(cuentasMp.creadoTs))
  );
}

export type CodigoErrorPorCobrarMp = CodigoErrorPagosMp | "mp_renovando" | "mp_reconectar" | "mp_error";

export type ResultadoSincronizacionPorCobrarMp = { estado: "actualizado"; pagos: number } | { estado: "error"; codigo: CodigoErrorPorCobrarMp };

function codigoDeErrorPorCobrar(error: unknown): CodigoErrorPorCobrarMp {
  if (error instanceof ErrorPagosMp) return error.codigo;
  if (error instanceof CandadoRenovacionMpError) return "mp_renovando";
  if (error instanceof RenovacionTokenMpFallidaError || error instanceof CuentaMpDesconectadaError) return "mp_reconectar";
  return "mp_error";
}

const LOTE_INSERCION = 500;

// «Actualizar desde Mercado Pago»: token y búsqueda FUERA de cualquier
// transacción; después, una transacción corta reemplaza la foto completa
// de la cuenta (DELETE + INSERT), marca por_cobrar_sincronizado_ts y deja
// rastro en la auditoría. Un error queda como código corto en
// ultimo_error_por_cobrar, nunca el body ni el token.
export async function sincronizarPorCobrarMp(entrada: { empresaId: string; usuarioId: string; cuentaMpId: string }): Promise<ResultadoSincronizacionPorCobrarMp> {
  const { empresaId, usuarioId, cuentaMpId } = entrada;
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  if (!esUuid(cuentaMpId)) throw new CuentaMpNoEncontradaError();
  const deEstaCuenta = and(eq(cuentasMp.id, cuentaMpId), eq(cuentasMp.empresaId, empresaId), isNull(cuentasMp.desconectadaTs));

  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx.select({ id: cuentasMp.id, nickname: cuentasMp.nickname, cuentaIdExterna: cuentasMp.cuentaIdExterna }).from(cuentasMp).where(deEstaCuenta)
  );
  if (!cuenta) throw new CuentaMpNoEncontradaError();
  const nombre = cuenta.nickname ?? cuenta.cuentaIdExterna;

  try {
    const token = await obtenerAccessTokenMpVigente(empresaId, cuenta.id);
    const pagos = await buscarPagosPendientesMp(token, cuenta.cuentaIdExterna, new Date());

    await dbComoEmpresa(empresaId, async (tx) => {
      await tx.delete(pagosMpPorCobrar).where(and(eq(pagosMpPorCobrar.empresaId, empresaId), eq(pagosMpPorCobrar.cuentaMpId, cuenta.id)));
      for (let i = 0; i < pagos.length; i += LOTE_INSERCION) {
        await tx.insert(pagosMpPorCobrar).values(
          pagos.slice(i, i + LOTE_INSERCION).map((p) => ({
            empresaId,
            cuentaMpId: cuenta.id,
            pagoIdExterno: p.pagoIdExterno,
            ordenIdExterno: p.ordenIdExterno,
            estado: p.estado,
            estadoLiberacion: p.estadoLiberacion,
            fechaLiberacion: p.fechaLiberacion,
            montoNeto: p.montoNeto,
            moneda: p.moneda,
            tipo: p.tipo,
          }))
        );
      }
      await tx.update(cuentasMp).set({ porCobrarSincronizadoTs: sql`now()`, ultimoErrorPorCobrar: null }).where(deEstaCuenta);
      await registrarAuditoria(tx, {
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "sincronizar_por_cobrar",
        entidad: "cuenta_mp",
        entidadId: cuenta.id,
        valorNuevo: String(pagos.length),
        detalle: `Por cobrar de Mercado Pago ${nombre}: ${pagos.length} ${pagos.length === 1 ? "pago" : "pagos"} sin liberar.`,
      });
    });
    return { estado: "actualizado", pagos: pagos.length };
  } catch (error) {
    const codigo = codigoDeErrorPorCobrar(error);
    const status = error instanceof ErrorPagosMp ? error.status : undefined;
    const guardado = status ? `${codigo}:${status}` : codigo;
    // Solo el código, el status HTTP y el nombre del error: nunca el token ni el body.
    console.warn(
      `[lib/finanzas/por-cobrar-consulta] no se pudo sincronizar por cobrar de Mercado Pago (cuenta ${cuenta.id}):`,
      "codigo",
      codigo,
      "status",
      status ?? "sin status",
      error instanceof Error ? error.name : "desconocido"
    );
    await dbComoEmpresa(empresaId, (tx) => tx.update(cuentasMp).set({ ultimoErrorPorCobrar: guardado }).where(deEstaCuenta));
    return { estado: "error", codigo };
  }
}
