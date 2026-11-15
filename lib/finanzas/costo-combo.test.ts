import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, pedidoItems, pedidosFinanzas, ventasCorrecciones } from "@/db/schema";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { guardarCostoSku } from "@/lib/costos-sku";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { guardarVentaFinanzas } from "./guardar-venta";
import { confirmarRecalculoCostos, previsualizarRecalculoCostos } from "./recalcular-costos";
import type { VentaMl } from "./venta-ml";

// Issue #130 (maestra de #127) — costo de los SKU combo X2/X3 (Sharel,
// 29-oct-2026) en el congelado y en el recálculo, contra Postgres real.
// Datos inventados.

vi.setConfig({ testTimeout: 20_000 });

function venta(sku: string, cantidad = 1): VentaMl {
  return {
    pedidoIdExterno: `orden-${randomUUID()}`,
    fecha: new Date("2026-10-20T15:00:00Z"),
    total: "80000.00",
    moneda: "COP",
    estado: "paid",
    formaEntrega: "agencia",
    logisticTypeMl: "cross_docking",
    fechaPagoAprobado: new Date("2026-10-20T16:00:00Z"),
    valorVenta: "80000.00",
    reembolsos: "0.00",
    comisionMl: "9000.00",
    fleteMl: "0.00",
    cancelada: false,
    shipmentIdExterno: null,
    packIdExterno: null,
    fechaDespacho: null,
    fechaEntrega: null,
    lineas: [{ itemIdExterno: "MCO1", skuCodigo: sku, cantidad, precioUnitario: "40000.00", titulo: "Combo", imagenUrl: null }],
  };
}

async function empresa(nombre: string) {
  const e = await crearEmpresaConPermisos(nombre, [
    { modulo: "finanzas", accion: "consultar" },
    { modulo: "finanzas", accion: "modificar" },
  ]);
  const cuentaMlId = await crearCuentaMlDePrueba(e.empresaId);
  const costo = (sku: string, datos: Parameters<typeof guardarCostoSku>[0]["datos"]) =>
    guardarCostoSku({ empresaId: e.empresaId, usuarioId: e.usuarioId, skuCodigo: sku, datos });
  const leer = (pedidoId: string) =>
    dbComoEmpresa(e.empresaId, async (tx) => ({
      cabecera: (await tx.select().from(pedidosFinanzas).where(eq(pedidosFinanzas.pedidoId, pedidoId)))[0],
      lineas: await tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, pedidoId)).orderBy(pedidoItems.linea),
    }));
  return { ...e, cuentaMlId, costo, leer };
}

describe("costo de SKU combo X2/X3 (issue #130)", () => {
  it("BASEX2 sin fila exacta se congela con base × 2 × cantidad, y empaque y envío de la base una sola vez", async () => {
    const e = await empresa("Combo congela");
    await e.costo("BASE", { costo: "10000", empaque: "1000", envioAgencia: "5000" });
    const r = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("basex2", 2));
    const v = await e.leer(r.pedidoId);
    expect(v.cabecera).toMatchObject({ estadoCosteo: "completo", empaqueCongelado: "1000.00", envioAgenciaCongelado: "5000.00" });
    expect(v.cabecera.congeladoTs).not.toBeNull();
    expect(v.lineas[0]).toMatchObject({ skuCodigo: "BASEX2", costoCongelado: "40000.00" });
  });

  it("BASEX3 con fila exacta con costo usa la exacta", async () => {
    const e = await empresa("Combo exacta");
    await e.costo("BASE", { costo: "10000", empaque: "1000", envioAgencia: "5000" });
    await e.costo("BASEX3", { costo: "27000", empaque: "1500", envioAgencia: "6000" });
    const r = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("BASEX3"));
    const v = await e.leer(r.pedidoId);
    expect(v.lineas[0].costoCongelado).toBe("27000.00");
    expect(v.cabecera).toMatchObject({ empaqueCongelado: "1500.00", envioAgenciaCongelado: "6000.00" });
  });

  it("AGUJA2 y BASEX4 sin fila exacta siguen sin costo y sin congelar", async () => {
    const e = await empresa("Combo no combos");
    await e.costo("AGUJA", { costo: "3000", empaque: "500", envioAgencia: "2000" });
    await e.costo("BASE", { costo: "10000", empaque: "1000", envioAgencia: "5000" });
    for (const sku of ["AGUJA2", "BASEX4"]) {
      const r = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta(sku));
      const v = await e.leer(r.pedidoId);
      expect(v.cabecera).toMatchObject({ estadoCosteo: "sin_costo", congeladoTs: null, empaqueCongelado: null });
      expect(v.lineas[0].costoCongelado).toBeNull();
    }
  });

  it("A/B: el BASE de la empresa B no le da costo al BASEX2 de la empresa A", async () => {
    const a = await empresa("Combo A/B — A");
    const b = await empresa("Combo A/B — B");
    await b.costo("BASE", { costo: "10000", empaque: "1000", envioAgencia: "5000" });
    const r = await guardarVentaFinanzas(a.empresaId, a.cuentaMlId, venta("BASEX2"));
    const v = await a.leer(r.pedidoId);
    expect(v.cabecera).toMatchObject({ estadoCosteo: "sin_costo", congeladoTs: null });
    expect(v.lineas[0].costoCongelado).toBeNull();
  });

  it("recálculo por SKU base: trae sus combos, reescribe solo el costo, deja bitácora y respeta la corrección manual", async () => {
    const e = await empresa("Combo recalculo");
    await e.costo("BASE", { costo: "10000", empaque: "1000", envioAgencia: "5000" });
    const combo = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("BASEX2"));
    const corregida = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("BASEX3"));
    await dbComoEmpresa(e.empresaId, (tx) =>
      tx
        .insert(ventasCorrecciones)
        .values({ empresaId: e.empresaId, pedidoId: corregida.pedidoId, linea: 1, campo: "costo_producto", valorNuevo: "25000", nota: "Factura real", creadoPor: e.usuarioId })
    );
    expect((await e.leer(combo.pedidoId)).lineas[0].costoCongelado).toBe("20000.00");

    await e.costo("BASE", { costo: "15000", empaque: "3000", envioAgencia: "9000" });
    const vista = await previsualizarRecalculoCostos(e.empresaId, e.usuarioId, { skuCodigo: "base" });
    expect(vista.cambios).toEqual([
      { pedidoId: combo.pedidoId, pedidoIdExterno: expect.any(String), linea: 1, skuCodigo: "BASEX2", antes: "20000.00", despues: "30000.00", origen: "combo_base" },
    ]);
    expect(vista.omitidos).toEqual([{ pedidoId: corregida.pedidoId, linea: 1, skuCodigo: "BASEX3", motivo: "correccion_manual" }]);

    // Filtrar por el combo trae solo el combo.
    const soloCombo = await previsualizarRecalculoCostos(e.empresaId, e.usuarioId, { skuCodigo: "BASEX2" });
    expect(soloCombo.cambios.map((c) => c.skuCodigo)).toEqual(["BASEX2"]);
    expect(soloCombo.omitidos).toEqual([]);

    expect(await confirmarRecalculoCostos(e.empresaId, e.usuarioId, { skuCodigo: "base" }, vista.cambios)).toEqual({ ventas: 1, lineas: 1 });
    const v = await e.leer(combo.pedidoId);
    expect(v.lineas[0].costoCongelado).toBe("30000.00");
    // Empaque y envío congelados no cambian.
    expect(v.cabecera).toMatchObject({ empaqueCongelado: "1000.00", envioAgenciaCongelado: "5000.00" });

    const bitacora = await dbComoEmpresa(e.empresaId, (tx) =>
      tx.select().from(auditoria).where(and(eq(auditoria.empresaId, e.empresaId), eq(auditoria.accion, "recalcular_costo_congelado")))
    );
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]).toMatchObject({
      entidadId: combo.pedidoId,
      valorAnterior: "línea 1 (BASEX2): 20000.00",
      valorNuevo: "línea 1 (BASEX2, costo de BASE × 2): 30000.00",
    });
  });

  it("recálculo por BASE: un BASEX2 con fila exacta con costo no depende de BASE y sale sin cambio", async () => {
    const e = await empresa("Combo recalculo exacta");
    await e.costo("BASE", { costo: "10000" });
    await e.costo("BASEX2", { costo: "18000" });
    await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, { ...venta("BASEX2"), formaEntrega: "full_ml", logisticTypeMl: "fulfillment" });
    await e.costo("BASE", { costo: "12000" });
    const vista = await previsualizarRecalculoCostos(e.empresaId, e.usuarioId, { skuCodigo: "BASE" });
    expect(vista).toEqual({ cambios: [], omitidos: [] });
  });
});
