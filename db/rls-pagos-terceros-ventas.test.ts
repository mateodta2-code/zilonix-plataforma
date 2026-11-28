import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { pagosTercerosVentas } from "./schema";
import { crearCuentaMlDePrueba } from "./test-utils/venta";
import { guardarCostoSku } from "../lib/costos-sku";
import { guardarVentaFinanzas } from "../lib/finanzas/guardar-venta";
import { leerPorPagar, marcarVentasPagadas, PartidaVentasNoPendienteError } from "../lib/finanzas/por-pagar-db";
import type { VentaMl } from "../lib/finanzas/venta-ml";
import { crearTercero } from "../lib/terceros";
import { crearEmpresaConPermisos } from "../lib/test-utils/empresa-con-permiso";

// Por pagar automático (28-nov, migración 0062) contra Postgres real con
// app_user: las ventas despachadas le deben a los terceros habituales
// por periodo, «Marcar pagado» registra el pago, y una empresa nunca ve
// ni paga lo de otra.

vi.setConfig({ testTimeout: 30_000 });

const HOY = "2030-03-20";
const SOLO_VENTAS = { origen: "ventas" as const, estado: null, proveedor: null };

function venta(despacho: Date | null, extra: Partial<VentaMl> = {}): VentaMl {
  const fecha = despacho ?? new Date("2030-03-06T12:00:00Z");
  return {
    pedidoIdExterno: `orden-${randomUUID()}`,
    fecha,
    total: "50000.00",
    moneda: "COP",
    estado: "paid",
    formaEntrega: "agencia",
    logisticTypeMl: "cross_docking",
    fechaPagoAprobado: fecha,
    valorVenta: "50000.00",
    reembolsos: "0.00",
    comisionMl: "6000.00",
    fleteMl: "4000.00",
    cancelada: false,
    shipmentIdExterno: null,
    packIdExterno: null,
    fechaDespacho: despacho,
    fechaEntrega: null,
    lineas: [{ itemIdExterno: "MCO1", skuCodigo: "PPV-1", cantidad: 1, precioUnitario: "50000.00", titulo: "Producto", imagenUrl: null }],
    ...extra,
  };
}

async function empresaConHabituales(nombre: string) {
  const e = await crearEmpresaConPermisos(nombre, [
    { modulo: "finanzas", accion: "consultar" },
    { modulo: "finanzas", accion: "modificar" },
  ]);
  const cuentaMlId = await crearCuentaMlDePrueba(e.empresaId);
  await guardarCostoSku({ empresaId: e.empresaId, usuarioId: e.usuarioId, skuCodigo: "PPV-1", datos: { costo: "20000", empaque: "1000", envioAgencia: "2000" } });
  const empaques = await crearTercero({
    empresaId: e.empresaId,
    usuarioId: e.usuarioId,
    nombre: `Empaques ${nombre}`,
    tipo: "empaque",
    condicionPago: "inmediato",
    predeterminadoEmpaque: true,
  });
  const agencia = await crearTercero({
    empresaId: e.empresaId,
    usuarioId: e.usuarioId,
    nombre: `Agencia ${nombre}`,
    tipo: "agencia",
    condicionPago: "cuenta_cobro",
    periodicidad: "semanal",
    plazoDias: 2,
    predeterminadoEnvioAgencia: true,
  });
  return { ...e, cuentaMlId, empaquesId: empaques.id, agenciaId: agencia.id };
}

describe("por pagar automático desde las ventas (migración 0062)", () => {
  let a: Awaited<ReturnType<typeof empresaConHabituales>>;

  beforeAll(async () => {
    a = await empresaConHabituales("PPV A");
  });

  it("agrupa por tercero y periodo, deja fuera lo no despachado y lo de antes del arranque, y cobra igual una cancelada despachada", async () => {
    // Miércoles 6 y jueves 7 de marzo de 2030 (semana del lunes 4 al domingo 10).
    await guardarVentaFinanzas(a.empresaId, a.cuentaMlId, venta(new Date("2030-03-06T15:00:00Z")));
    await guardarVentaFinanzas(a.empresaId, a.cuentaMlId, venta(new Date("2030-03-07T15:00:00Z"), { estado: "cancelled", cancelada: true }));
    await guardarVentaFinanzas(a.empresaId, a.cuentaMlId, venta(null));
    await guardarVentaFinanzas(a.empresaId, a.cuentaMlId, venta(new Date("2020-01-01T15:00:00Z")));

    const { filas, totales } = await leerPorPagar(a.empresaId, a.usuarioId, SOLO_VENTAS, HOY);
    const resumen = filas.map((f) => [f.proveedor, f.vence, f.valor, f.moneda]).sort();
    expect(resumen).toEqual(
      [
        [`Agencia PPV A`, "2030-03-12", "4000.00", "COP"],
        [`Empaques PPV A`, "2030-03-06", "1000.00", "COP"],
        [`Empaques PPV A`, "2030-03-07", "1000.00", "COP"],
      ].sort()
    );
    expect(filas.find((f) => f.terceroId === a.agenciaId)?.concepto).toBe("Empaque y envío de 2 ventas despachadas del 2030-03-04 al 2030-03-10");
    expect(totales).toMatchObject([{ moneda: "COP", total: "6000.00", vencido: "6000.00" }]);
  });

  it("«Marcar pagado» salda la partida; una venta tarde en el mismo periodo deja solo la diferencia; pagar dos veces no se puede", async () => {
    const clave = `${a.agenciaId}|2030-03-04|COP`;
    await marcarVentasPagadas({ empresaId: a.empresaId, usuarioId: a.usuarioId, clave, fechaPago: "2030-03-11", medioPago: "Transferencia" });
    let filas = (await leerPorPagar(a.empresaId, a.usuarioId, SOLO_VENTAS, HOY)).filas;
    expect(filas.some((f) => f.id === clave)).toBe(false);
    await expect(
      marcarVentasPagadas({ empresaId: a.empresaId, usuarioId: a.usuarioId, clave, fechaPago: "2030-03-11", medioPago: "" })
    ).rejects.toBeInstanceOf(PartidaVentasNoPendienteError);

    await guardarVentaFinanzas(a.empresaId, a.cuentaMlId, venta(new Date("2030-03-09T15:00:00Z")));
    filas = (await leerPorPagar(a.empresaId, a.usuarioId, SOLO_VENTAS, HOY)).filas;
    expect(filas.find((f) => f.id === clave)?.valor).toBe("2000.00");

    const pagos = await dbComoEmpresa(a.empresaId, (tx) => tx.select().from(pagosTercerosVentas).where(eq(pagosTercerosVentas.terceroId, a.agenciaId)));
    expect(pagos).toMatchObject([{ periodoDesde: "2030-03-04", periodoHasta: "2030-03-10", monto: "4000.00", moneda: "COP", fechaPago: "2030-03-11", medioPago: "Transferencia" }]);
  });

  it("aislamiento: B no ve ni paga lo de A, y nadie edita ni borra un pago", async () => {
    const b = await empresaConHabituales("PPV B");
    expect((await leerPorPagar(b.empresaId, b.usuarioId, SOLO_VENTAS, HOY)).filas).toEqual([]);
    await expect(
      marcarVentasPagadas({ empresaId: b.empresaId, usuarioId: b.usuarioId, clave: `${a.empaquesId}|2030-03-06|COP`, fechaPago: "2030-03-11", medioPago: "" })
    ).rejects.toBeInstanceOf(PartidaVentasNoPendienteError);
    expect(await dbComoEmpresa(b.empresaId, (tx) => tx.select().from(pagosTercerosVentas))).toEqual([]);

    // B no puede registrar un pago a un tercero de A, ni con la empresa de A.
    await expect(
      dbComoEmpresa(b.empresaId, (tx) =>
        tx.insert(pagosTercerosVentas).values({ empresaId: b.empresaId, terceroId: a.agenciaId, periodoDesde: "2030-03-04", periodoHasta: "2030-03-10", moneda: "COP", monto: "1", fechaPago: "2030-03-11" })
      )
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(b.empresaId, (tx) =>
        tx.insert(pagosTercerosVentas).values({ empresaId: a.empresaId, terceroId: a.agenciaId, periodoDesde: "2030-03-04", periodoHasta: "2030-03-10", moneda: "COP", monto: "1", fechaPago: "2030-03-11" })
      )
    ).rejects.toThrow();

    // Un pago es historia: app_user no lo edita ni lo borra, ni siquiera el dueño.
    await expect(dbComoEmpresa(a.empresaId, (tx) => tx.update(pagosTercerosVentas).set({ monto: "1" }))).rejects.toThrow(/permission denied/);
    await expect(dbComoEmpresa(a.empresaId, (tx) => tx.delete(pagosTercerosVentas))).rejects.toThrow(/permission denied/);
  });
});
