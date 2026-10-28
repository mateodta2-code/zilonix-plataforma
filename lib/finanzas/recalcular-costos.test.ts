import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, pedidoItems, ventasCorrecciones } from "@/db/schema";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { guardarCostoSku } from "@/lib/costos-sku";
import { SinPermisoError } from "@/lib/permisos";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { guardarVentaFinanzas } from "./guardar-venta";
import {
  FiltroRecalculoInvalidoError,
  RecalculoDesactualizadoError,
  confirmarRecalculoCostos,
  previsualizarRecalculoCostos,
} from "./recalcular-costos";
import type { VentaMl } from "./venta-ml";

// Issue #130 (Z-FIN-08) — recálculo masivo del costo congelado, contra
// Postgres real.

vi.setConfig({ testTimeout: 20_000 });

function venta(sku: string, cantidad = 1): VentaMl {
  return {
    pedidoIdExterno: `orden-${randomUUID()}`,
    fecha: new Date("2026-10-20T15:00:00Z"),
    total: "50000.00",
    moneda: "COP",
    estado: "paid",
    formaEntrega: "full_ml",
    logisticTypeMl: "fulfillment",
    fechaPagoAprobado: null,
    valorVenta: "50000.00",
    reembolsos: "0.00",
    comisionMl: "6000.00",
    fleteMl: "0.00",
    cancelada: false,
    shipmentIdExterno: null,
    packIdExterno: null,
    fechaDespacho: null,
    fechaEntrega: null,
    lineas: [{ itemIdExterno: "MCO1", skuCodigo: sku, cantidad, precioUnitario: "50000.00", titulo: "Producto", imagenUrl: null }],
  };
}

describe("recalcularCostosCongelados (issue #130)", () => {
  let empresaId: string;
  let usuarioId: string;
  let cuentaMlId: string;

  const costoDe = (pedidoId: string) =>
    dbComoEmpresa(empresaId, async (tx) => (await tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, pedidoId)))[0].costoCongelado);

  beforeAll(async () => {
    ({ empresaId, usuarioId } = await crearEmpresaConPermisos("Recalculo", [
      { modulo: "finanzas", accion: "consultar" },
      { modulo: "finanzas", accion: "modificar" },
    ]));
    cuentaMlId = await crearCuentaMlDePrueba(empresaId);
  });

  it("muestra antes → después sin escribir; al confirmar reescribe solo el costo, respeta correcciones y deja bitácora por venta", async () => {
    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: "REC-1", datos: { costo: "10000", empaque: "1000" } });
    const uno = await guardarVentaFinanzas(empresaId, cuentaMlId, venta("REC-1", 2));
    const dos = await guardarVentaFinanzas(empresaId, cuentaMlId, venta("REC-1"));
    const corregida = await guardarVentaFinanzas(empresaId, cuentaMlId, venta("REC-1"));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(ventasCorrecciones).values({ empresaId, pedidoId: corregida.pedidoId, linea: 1, campo: "costo_producto", valorNuevo: "8000", nota: "Factura real", creadoPor: usuarioId })
    );

    // La maestra cambia: lo congelado NO cambia solo.
    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: "REC-1", datos: { costo: "11000", empaque: "5000" } });
    expect(await costoDe(uno.pedidoId)).toBe("20000.00");

    const vista = await previsualizarRecalculoCostos(empresaId, usuarioId, { skuCodigo: "rec-1" });
    expect(vista.cambios.map((c) => [c.pedidoId, c.antes, c.despues]).sort()).toEqual(
      [
        [uno.pedidoId, "20000.00", "22000.00"],
        [dos.pedidoId, "10000.00", "11000.00"],
      ].sort()
    );
    expect(vista.omitidos).toEqual([{ pedidoId: corregida.pedidoId, linea: 1, skuCodigo: "REC-1", motivo: "correccion_manual" }]);
    // Antes de confirmar, las ventas siguen con el costo congelado.
    expect(await costoDe(uno.pedidoId)).toBe("20000.00");

    const resultado = await confirmarRecalculoCostos(empresaId, usuarioId, { skuCodigo: "REC-1" }, vista.cambios);
    expect(resultado).toEqual({ ventas: 2, lineas: 2 });
    expect(await costoDe(uno.pedidoId)).toBe("22000.00");
    expect(await costoDe(corregida.pedidoId)).toBe("10000.00");

    // Solo el costo: el empaque congelado sigue siendo el de antes.
    const [linea] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, uno.pedidoId)));
    expect(linea.empaqueCongelado).toBe("1000.00");

    const bitacora = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(auditoria).where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.accion, "recalcular_costo_congelado")))
    );
    expect(bitacora).toHaveLength(2);
    expect(bitacora.find((b) => b.entidadId === uno.pedidoId)).toMatchObject({
      usuarioId,
      actorTipo: "persona",
      valorAnterior: "línea 1 (REC-1): 20000.00",
      valorNuevo: "línea 1 (REC-1): 22000.00",
    });
  });

  it("todo o nada: si la maestra cambió después de la vista previa, no escribe ninguna venta", async () => {
    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: "REC-2", datos: { costo: "100" } });
    const a = await guardarVentaFinanzas(empresaId, cuentaMlId, venta("REC-2"));
    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: "REC-2", datos: { costo: "200" } });
    const vista = await previsualizarRecalculoCostos(empresaId, usuarioId, { skuCodigo: "REC-2" });

    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: "REC-2", datos: { costo: "300" } });
    await expect(confirmarRecalculoCostos(empresaId, usuarioId, { skuCodigo: "REC-2" }, vista.cambios)).rejects.toBeInstanceOf(RecalculoDesactualizadoError);
    expect(await costoDe(a.pedidoId)).toBe("100.00");
  });

  it("un SKU sin costo hoy en la maestra no des-costea la venta; sin filtro se rechaza; sin permiso falla", async () => {
    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: "REC-3", datos: { costo: "100" } });
    const a = await guardarVentaFinanzas(empresaId, cuentaMlId, venta("REC-3"));
    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: "REC-3", datos: { costo: null } });
    const vista = await previsualizarRecalculoCostos(empresaId, usuarioId, { skuCodigo: "REC-3" });
    expect(vista).toEqual({ cambios: [], omitidos: [{ pedidoId: a.pedidoId, linea: 1, skuCodigo: "REC-3", motivo: "sin_costo_en_maestra" }] });

    await expect(previsualizarRecalculoCostos(empresaId, usuarioId, {})).rejects.toBeInstanceOf(FiltroRecalculoInvalidoError);

    const soloVer = await crearEmpresaConPermisos("Solo ver", [{ modulo: "finanzas", accion: "consultar" }]);
    await expect(previsualizarRecalculoCostos(soloVer.empresaId, soloVer.usuarioId, { skuCodigo: "REC-3" })).rejects.toBeInstanceOf(SinPermisoError);
  });
});
