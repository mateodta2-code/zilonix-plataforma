import { and, eq, gt, inArray, isNotNull, ne, or, isNull, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasFalabella, cuentasMl, movimientosMarketplace, pedidos, pedidosFinanzas } from "@/db/schema";
import { obtenerSitioDeCuenta } from "@/lib/ml/cuentas";
import { ESTADO_LIBERADO } from "@/lib/ml/liberacion";
import { requierePermiso } from "@/lib/permisos";
import { ESTADOS_FALABELLA_POR_COBRAR, type PartidaPorCobrar } from "./por-cobrar";

// Issue #422 (cuentas por cobrar) — lee lo que las plataformas le deben
// a la empresa de la sesión. Siempre dbComoEmpresa (RLS): nunca se ve una
// partida de otra empresa. requierePermiso también acá, para quien llame
// sin pasar por app/.
//
// Mercado Libre: ventas no canceladas con la plata sin liberar
// (estado_liberacion distinto de «released») y fecha de liberación
// futura o sin fecha. Una fecha ya pasada se da por liberada: ML libera
// sola ese día y la orden no siempre vuelve a la sync después.
// Falabella: líneas en Abierto / Procesando cierre / Pago programado,
// sumadas por corte (cuenta + Nº de estado de cuenta + moneda).

export async function leerPartidasPorCobrar(empresaId: string, usuarioId: string, ahora: Date): Promise<PartidaPorCobrar[]> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");

  const { ml, falabella } = await dbComoEmpresa(empresaId, async (tx) => {
    const pf = pedidosFinanzas;
    const ml = await tx
      .select({
        cuentaId: cuentasMl.id,
        cuenta: cuentasMl.nickname,
        referencia: pedidos.pedidoIdExterno,
        estado: pf.estadoLiberacion,
        fechaEsperada: sql<string | null>`(${pf.fechaLiberacion} at time zone 'America/Bogota')::date::text`,
        monto: sql<string>`${pf.montoPorLiberar}::text`,
      })
      .from(pf)
      .innerJoin(pedidos, eq(pedidos.id, pf.pedidoId))
      .innerJoin(cuentasMl, eq(cuentasMl.id, pf.cuentaMlId))
      .where(
        and(
          eq(pf.cancelada, false),
          isNotNull(pf.estadoLiberacion),
          ne(pf.estadoLiberacion, ESTADO_LIBERADO),
          gt(pf.montoPorLiberar, "0"),
          or(isNull(pf.fechaLiberacion), gt(pf.fechaLiberacion, ahora))
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
      .innerJoin(cuentasFalabella, eq(cuentasFalabella.id, m.cuentaFalabellaId))
      .where(and(eq(m.marketplace, "falabella"), inArray(m.estadoPago, [...ESTADOS_FALABELLA_POR_COBRAR])))
      .groupBy(cuentasFalabella.id, cuentasFalabella.nickname, m.estadoCuenta, m.moneda)
      .having(sql`sum(${m.monto}) <> 0`);

    return { ml, falabella };
  });

  // La moneda de ML es la del sitio de cada cuenta, nunca una fija.
  const monedas = new Map<string, string>();
  for (const id of new Set(ml.map((v) => v.cuentaId))) {
    monedas.set(id, (await obtenerSitioDeCuenta(empresaId, id)).moneda);
  }

  return [
    ...ml.map((v) => ({
      marketplace: "ml" as const,
      cuentaId: v.cuentaId,
      cuenta: v.cuenta,
      moneda: monedas.get(v.cuentaId)!,
      referencia: v.referencia,
      estado: v.estado,
      fechaEsperada: v.fechaEsperada,
      monto: v.monto,
    })),
    ...falabella.map((c) => ({
      marketplace: "falabella" as const,
      cuentaId: c.cuentaId,
      cuenta: c.cuenta,
      moneda: c.moneda,
      referencia: c.estadoCuenta ?? "Sin estado de cuenta todavía",
      estado: c.estados.filter(Boolean).sort().join(", ") || null,
      // El reporte de transacciones no trae fecha de pago (decisión 19-nov:
      // sin fecha por ahora, no se estima).
      fechaEsperada: null,
      monto: c.monto,
    })),
  ];
}
