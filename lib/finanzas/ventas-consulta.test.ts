import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { ventasCorrecciones } from "@/db/schema";
import { crearCuentaMlDePrueba, crearVentaDePrueba } from "@/db/test-utils/venta";
import { guardarCostoSku } from "@/lib/costos-sku";
import { limitesDiaBogota } from "@/lib/filtros-listado";
import { SinPermisoError } from "@/lib/permisos";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { guardarVentaFinanzas } from "./guardar-venta";
import type { VentaMl } from "./venta-ml";
import { RangoVentasInvalidoError, listarVentasUtilidad, obtenerDetalleVentaUtilidad, tieneVentaFinanzas } from "./ventas-consulta";

// Issue #131 (Z-FIN-09, Parte A) — lecturas de la pantalla de ventas y
// utilidad, contra Postgres real (RLS y permisos no se simulan).

vi.setConfig({ testTimeout: 20_000 });

function venta(fecha: Date, extra: Partial<VentaMl> = {}): VentaMl {
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
    fechaDespacho: null,
    fechaEntrega: null,
    lineas: [{ itemIdExterno: "MCO1", skuCodigo: "PANT-1", cantidad: 1, precioUnitario: "50000.00", titulo: "Producto pantalla", imagenUrl: null }],
    ...extra,
  };
}

function rangoDe(dia: string) {
  const limites = limitesDiaBogota(dia)!;
  return { desde: limites.inicio, hastaExclusivo: limites.finExclusivo };
}

const pedidosDelDetalle = (detalle: Awaited<ReturnType<typeof listarVentasUtilidad>>["detalle"]) =>
  detalle.dias.flatMap((d) => d.cuentas.flatMap((c) => c.productos.map((p) => p.pedido_id)));

describe("ventas y utilidad, solo lectura (issue #131 Parte A)", () => {
  let empresaId: string;
  let usuarioId: string;
  let cuentaMlId: string;

  beforeAll(async () => {
    ({ empresaId, usuarioId } = await crearEmpresaConPermisos("Ventas pantalla", [
      { modulo: "finanzas", accion: "consultar" },
      { modulo: "finanzas", accion: "modificar" },
    ]));
    cuentaMlId = await crearCuentaMlDePrueba(empresaId);
    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: "PANT-1", datos: { costo: "20000", empaque: "1000", envioAgencia: "2000" } });
  });

  it("(a/b) la empresa B no ve las ventas de A, y sin finanzas.consultar no se lee nada", async () => {
    const deA = await guardarVentaFinanzas(empresaId, cuentaMlId, venta(new Date("2026-09-05T15:00:00Z")));

    const b = await crearEmpresaConPermisos("Ventas pantalla B", [{ modulo: "finanzas", accion: "consultar" }]);
    const cuentaB = await crearCuentaMlDePrueba(b.empresaId);
    const deB = await guardarVentaFinanzas(b.empresaId, cuentaB, venta(new Date("2026-09-05T16:00:00Z")));

    const vistaB = await listarVentasUtilidad(b.empresaId, b.usuarioId, { cuentaId: null, ...rangoDe("2026-09-05") });
    expect(pedidosDelDetalle(vistaB.detalle)).toEqual([deB.pedidoId]);
    // Aunque B pida la cuenta o el pedido de A por id, no los ve.
    const conCuentaDeA = await listarVentasUtilidad(b.empresaId, b.usuarioId, { cuentaId: cuentaMlId, ...rangoDe("2026-09-05") });
    expect(conCuentaDeA.detalle.total.ventas).toBe(0);
    expect(await obtenerDetalleVentaUtilidad(b.empresaId, b.usuarioId, deA.pedidoId)).toBeNull();
    expect(await tieneVentaFinanzas(b.empresaId, deA.pedidoId)).toBe(false);
    expect(await obtenerDetalleVentaUtilidad(b.empresaId, b.usuarioId, "no-es-un-uuid")).toBeNull();

    const sinPermiso = await crearEmpresaConPermisos("Ventas sin permiso", [{ modulo: "ventas", accion: "consultar" }]);
    await expect(listarVentasUtilidad(sinPermiso.empresaId, sinPermiso.usuarioId, { cuentaId: null, ...rangoDe("2026-09-05") })).rejects.toBeInstanceOf(SinPermisoError);
    await expect(obtenerDetalleVentaUtilidad(sinPermiso.empresaId, sinPermiso.usuarioId, deA.pedidoId)).rejects.toBeInstanceOf(SinPermisoError);
  });

  it("(c) una venta creada a las 23:59 de Bogotá con pago al día siguiente sale en el día de creación", async () => {
    // 23:59 del 10-sep en Bogotá = 04:59 UTC del 11-sep.
    const creada = new Date("2026-09-11T04:59:00Z");
    const guardada = await guardarVentaFinanzas(empresaId, cuentaMlId, venta(creada, { fechaPagoAprobado: new Date("2026-09-11T14:00:00Z") }));

    const del10 = await listarVentasUtilidad(empresaId, usuarioId, { cuentaId: cuentaMlId, ...rangoDe("2026-09-10") });
    expect(del10.detalle.dias.map((d) => d.dia)).toEqual(["2026-09-10"]);
    expect(pedidosDelDetalle(del10.detalle)).toEqual([guardada.pedidoId]);
    const del11 = await listarVentasUtilidad(empresaId, usuarioId, { cuentaId: cuentaMlId, ...rangoDe("2026-09-11") });
    expect(pedidosDelDetalle(del11.detalle)).not.toContain(guardada.pedidoId);
  });

  it("(d) una venta cancelled y una cancelada por reembolso total no aparecen ni suman", async () => {
    const dia = new Date("2026-09-12T15:00:00Z");
    const buena = await guardarVentaFinanzas(empresaId, cuentaMlId, venta(dia));
    await guardarVentaFinanzas(empresaId, cuentaMlId, venta(dia, { estado: "cancelled", valorVenta: "9999999.00" }));
    await guardarVentaFinanzas(empresaId, cuentaMlId, venta(dia, { valorVenta: "8888888.00", reembolsos: "8888888.00", cancelada: true }));

    const { detalle } = await listarVentasUtilidad(empresaId, usuarioId, { cuentaId: cuentaMlId, ...rangoDe("2026-09-12") });
    expect(pedidosDelDetalle(detalle)).toEqual([buena.pedidoId]);
    expect(detalle.total.recaudo).toBe("50000.00");
    // Recaudo − comisión − flete − costo − packing − envío agencia.
    expect(detalle.total.utilidad).toBe("17000.00");
  });

  it("(e) una corrección activa se ve como «corregido a mano»; anulada, vuelve al congelado", async () => {
    const guardada = await guardarVentaFinanzas(empresaId, cuentaMlId, venta(new Date("2026-09-13T15:00:00Z")));
    const [correccion] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(ventasCorrecciones)
        .values({ empresaId, pedidoId: guardada.pedidoId, linea: 1, campo: "costo_producto", valorNuevo: "15000", nota: "Error de SKU", creadoPor: usuarioId })
        .returning({ id: ventasCorrecciones.id })
    );

    const corregida = await obtenerDetalleVentaUtilidad(empresaId, usuarioId, guardada.pedidoId);
    expect(corregida?.resultado?.costo_producto).toEqual({ valor: "15000.00", origen: "corregido" });
    expect(corregida?.resultado?.utilidad).toBe("22000.00");
    expect(corregida?.correcciones).toMatchObject([{ campo: "costo_producto", valorNuevo: "15000.00", nota: "Error de SKU", creadoPorNombre: "Usuario Ventas pantalla", anuladaTs: null }]);
    const enLista = await listarVentasUtilidad(empresaId, usuarioId, { cuentaId: cuentaMlId, ...rangoDe("2026-09-13") });
    expect(enLista.detalle.total.costo_producto).toBe("15000.00");

    await dbComoEmpresa(empresaId, (tx) => tx.update(ventasCorrecciones).set({ anuladaTs: new Date() }).where(eq(ventasCorrecciones.id, correccion.id)));
    const anulada = await obtenerDetalleVentaUtilidad(empresaId, usuarioId, guardada.pedidoId);
    expect(anulada?.resultado?.costo_producto).toEqual({ valor: "20000.00", origen: "congelado" });
    expect(anulada?.correcciones[0].anuladaTs).toBeInstanceOf(Date);
    // Esta parte no escribe: leer dos veces no cambia nada.
    expect(await tieneVentaFinanzas(empresaId, guardada.pedidoId)).toBe(true);
  });

  it("(f) con reembolso parcial el recaudo no baja y la venta lleva la marca de revisar", async () => {
    const guardada = await guardarVentaFinanzas(empresaId, cuentaMlId, venta(new Date("2026-09-14T15:00:00Z"), { reembolsos: "10000.00" }));
    const resultado = await listarVentasUtilidad(empresaId, usuarioId, { cuentaId: cuentaMlId, ...rangoDe("2026-09-14") });
    expect(resultado.detalle.total.recaudo).toBe("50000.00");
    expect(resultado.conDevolucion).toEqual([guardada.pedidoId]);
    expect((await obtenerDetalleVentaUtilidad(empresaId, usuarioId, guardada.pedidoId))?.conDevolucion).toBe(true);
  });

  it("filtro con/sin costo, ventas que el motor rechaza aparte y rango validado", async () => {
    const dia = new Date("2026-09-15T15:00:00Z");
    const conCosto = await guardarVentaFinanzas(empresaId, cuentaMlId, venta(dia));
    const sinCosto = await guardarVentaFinanzas(empresaId, cuentaMlId, venta(dia, { lineas: [{ ...venta(dia).lineas[0], skuCodigo: "PANT-SIN-COSTO" }] }));
    // Una cabecera sin líneas: el motor la rechaza y la página no se rompe.
    const rota = await crearVentaDePrueba(empresaId, { cuentaMlId });

    const todas = await listarVentasUtilidad(empresaId, usuarioId, { cuentaId: cuentaMlId, ...rangoDe("2026-09-15") });
    expect(pedidosDelDetalle(todas.detalle).sort()).toEqual([conCosto.pedidoId, sinCosto.pedidoId].sort());
    expect(todas.detalle.total.ventas_sin_costo).toBe(1);
    expect(todas.resumenCuentas[0].porcentaje_ventas_con_costo).toBe("50.00");
    const soloSin = await listarVentasUtilidad(empresaId, usuarioId, { cuentaId: cuentaMlId, ...rangoDe("2026-09-15"), costo: "sin" });
    expect(pedidosDelDetalle(soloSin.detalle)).toEqual([sinCosto.pedidoId]);

    // crearVentaDePrueba usa el 20-oct.
    const conRota = await listarVentasUtilidad(empresaId, usuarioId, { cuentaId: cuentaMlId, ...rangoDe("2026-10-20") });
    expect(conRota.rechazadas.map((r) => r.pedidoId)).toContain(rota.pedidoId);
    expect(pedidosDelDetalle(conRota.detalle)).not.toContain(rota.pedidoId);

    await expect(
      listarVentasUtilidad(empresaId, usuarioId, { cuentaId: null, desde: new Date("2026-09-01T05:00:00Z"), hastaExclusivo: new Date("2026-10-03T05:00:00Z") })
    ).rejects.toBeInstanceOf(RangoVentasInvalidoError);
  });
});
