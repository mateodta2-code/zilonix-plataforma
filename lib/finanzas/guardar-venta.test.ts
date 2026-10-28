import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { configuracionFinanzas, pedidoItems, pedidos, pedidosFinanzas, terceros } from "@/db/schema";
import { crearDosEmpresas } from "@/db/test-utils/aislamiento";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { guardarCostoSku } from "@/lib/costos-sku";
import { crearTercero } from "@/lib/terceros";
import { guardarVentaFinanzas } from "./guardar-venta";
import type { LineaVentaMl, VentaMl } from "./venta-ml";

// Issue #130 (Z-FIN-08) — escritura idempotente y foto congelada, contra
// Postgres real. Datos inventados.

vi.setConfig({ testTimeout: 20_000 });

type Linea = Partial<LineaVentaMl> & Pick<LineaVentaMl, "skuCodigo">;

function venta(datos: Partial<Omit<VentaMl, "lineas">> & { lineas?: Linea[] } = {}): VentaMl {
  const { lineas, ...resto } = datos;
  return {
    pedidoIdExterno: `orden-${randomUUID()}`,
    fecha: new Date("2026-10-20T15:00:00Z"),
    total: "50000.00",
    moneda: "COP",
    estado: "paid",
    formaEntrega: "agencia",
    logisticTypeMl: "cross_docking",
    fechaPagoAprobado: new Date("2026-10-20T16:00:00Z"),
    valorVenta: "50000.00",
    reembolsos: "0.00",
    comisionMl: "6000.00",
    fleteMl: "9000.00",
    cancelada: false,
    shipmentIdExterno: null,
    packIdExterno: null,
    fechaDespacho: null,
    fechaEntrega: null,
    ...resto,
    lineas: (lineas ?? [{ skuCodigo: "REF-1" }]).map((l, i) => ({
      itemIdExterno: `MCO${100 + i}`,
      cantidad: 1,
      precioUnitario: "50000.00",
      titulo: `Producto ${i + 1}`,
      imagenUrl: null,
      ...l,
    })),
  };
}

describe("guardarVentaFinanzas (issue #130)", () => {
  let empresaId: string;
  let usuarioId: string;
  let cuentaMlId: string;

  async function leer(pedidoId: string) {
    return dbComoEmpresa(empresaId, async (tx) => ({
      cabecera: (await tx.select().from(pedidosFinanzas).where(eq(pedidosFinanzas.pedidoId, pedidoId)))[0],
      lineas: await tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, pedidoId)).orderBy(pedidoItems.linea),
    }));
  }

  function costo(sku: string, datos: Parameters<typeof guardarCostoSku>[0]["datos"]) {
    return guardarCostoSku({ empresaId, usuarioId, skuCodigo: sku, datos });
  }

  beforeAll(async () => {
    ({ empresaAId: empresaId, usuarioAId: usuarioId } = await crearDosEmpresas());
    cuentaMlId = await crearCuentaMlDePrueba(empresaId);
    await dbComoEmpresa(empresaId, (tx) => tx.insert(configuracionFinanzas).values({ empresaId, flexValor: "7000.00" }));
  });

  it("reprocesar no duplica filas ni cambia lo congelado; sí actualiza comisión, flete, valor y reembolsos", async () => {
    await costo("IDEM-1", { costo: "20000", empaque: "1500", envioAgencia: "2000" });
    const original = venta({ lineas: [{ skuCodigo: "idem-1 ", titulo: "Título original", imagenUrl: "https://a/original.jpg" }] });

    const primera = await guardarVentaFinanzas(empresaId, cuentaMlId, original);
    expect(primera).toMatchObject({ congelada: true, recienCongelada: true, estadoCosteo: "completo" });
    const antes = await leer(primera.pedidoId);

    const segunda = await guardarVentaFinanzas(empresaId, cuentaMlId, {
      ...original,
      comisionMl: "6100.00",
      reembolsos: "1000.00",
      lineas: [{ ...original.lineas[0], titulo: "Título nuevo", imagenUrl: "https://a/nueva.jpg" }],
    });
    expect(segunda).toMatchObject({ pedidoId: primera.pedidoId, congelada: true, recienCongelada: false });

    const despues = await leer(primera.pedidoId);
    expect(despues.lineas).toHaveLength(1);
    const filasPedido = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.pedidoIdExterno, original.pedidoIdExterno)));
    expect(filasPedido).toHaveLength(1);
    expect(despues.cabecera).toMatchObject({ comisionMl: "6100.00", reembolsos: "1000.00", valorVenta: "50000.00" });
    expect(despues.cabecera.congeladoTs).toEqual(antes.cabecera.congeladoTs);
    expect(despues.lineas[0]).toMatchObject({
      skuCodigo: "IDEM-1",
      costoCongelado: "20000.00",
      empaqueCongelado: "1500.00",
      envioCongelado: "2000.00",
      comisionMl: "6100.00",
      titulo: "Título original",
      imagenUrl: "https://a/original.jpg",
    });
  });

  it("cambiar el costo de la maestra o el valor Flex no cambia ventas congeladas; sí las nuevas", async () => {
    await costo("CAMBIA-1", { costo: "10000", empaque: "0", envioAgencia: "0" });
    const vieja = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ formaEntrega: "flex", lineas: [{ skuCodigo: "CAMBIA-1" }] }));

    await costo("CAMBIA-1", { costo: "12000" });
    await dbComoEmpresa(empresaId, (tx) => tx.update(configuracionFinanzas).set({ flexValor: "9000.00" }).where(eq(configuracionFinanzas.empresaId, empresaId)));
    const nueva = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ formaEntrega: "flex", lineas: [{ skuCodigo: "CAMBIA-1" }] }));

    // Reprocesar la vieja tampoco la cambia.
    const { pedidoIdExterno } = (await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.id, vieja.pedidoId))))[0];
    await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ pedidoIdExterno, formaEntrega: "flex", lineas: [{ skuCodigo: "CAMBIA-1" }] }));

    const v = await leer(vieja.pedidoId);
    const n = await leer(nueva.pedidoId);
    expect([v.lineas[0].costoCongelado, v.cabecera.envioAgenciaCongelado]).toEqual(["10000.00", "7000.00"]);
    expect([n.lineas[0].costoCongelado, n.cabecera.envioAgenciaCongelado]).toEqual(["12000.00", "9000.00"]);
  });

  it("SKU fuera de la maestra queda sin costo y sin congelar; al cargarlo y sincronizar, se congela", async () => {
    const datos = venta({ lineas: [{ skuCodigo: "NUEVO-1" }, { skuCodigo: "NUEVO-2" }] });
    await costo("NUEVO-2", { costo: "100" });

    const sinCosto = await guardarVentaFinanzas(empresaId, cuentaMlId, datos);
    expect(sinCosto).toMatchObject({ congelada: false, estadoCosteo: "parcial" });
    expect(sinCosto.alertas).toContainEqual(expect.objectContaining({ tipo: "sin_costo", skuCodigo: "NUEVO-1" }));
    const antes = await leer(sinCosto.pedidoId);
    expect(antes.cabecera).toMatchObject({ estadoCosteo: "parcial", congeladoTs: null, empaqueCongelado: null });
    expect(antes.lineas.map((l) => l.costoCongelado)).toEqual([null, null]);

    await costo("NUEVO-1", { costo: "0" });
    const congelada = await guardarVentaFinanzas(empresaId, cuentaMlId, datos);
    expect(congelada).toMatchObject({ congelada: true, recienCongelada: true });
    expect((await leer(sinCosto.pedidoId)).lineas.map((l) => l.costoCongelado)).toEqual(["0.00", "100.00"]);
  });

  it("costo 0.00 congela sin alerta de costo; costo vacío queda sin costo", async () => {
    await costo("CERO-1", { costo: "0", empaque: "0", envioAgencia: "0" });
    await costo("VACIO-1", { costo: null });
    const cero = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ lineas: [{ skuCodigo: "CERO-1" }] }));
    expect(cero).toMatchObject({ congelada: true, alertas: [] });
    const vacio = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ lineas: [{ skuCodigo: "VACIO-1" }] }));
    expect(vacio).toMatchObject({ congelada: false, estadoCosteo: "sin_costo" });
  });

  it("FUL + agencia congela $2.000 de envío; el mismo SKU por Full congela $0 de envío y $2.000 de packing", async () => {
    await costo("FUL-INF-01", { costo: "5000", empaque: "2000", envioAgencia: "2000" });
    const agencia = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ formaEntrega: "agencia", lineas: [{ skuCodigo: "FUL-INF-01" }] }));
    const full = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ formaEntrega: "full_ml", lineas: [{ skuCodigo: "FUL-INF-01" }] }));
    expect((await leer(agencia.pedidoId)).cabecera).toMatchObject({ empaqueCongelado: "2000.00", envioAgenciaCongelado: "2000.00" });
    expect((await leer(full.pedidoId)).cabecera).toMatchObject({ empaqueCongelado: "2000.00", envioAgenciaCongelado: "0.00" });
  });

  it("sin packing propio congela el del proveedor; si después cambia el del proveedor, la venta no cambia", async () => {
    const { id: proveedorId } = await crearTercero({ empresaId, usuarioId, nombre: `Prov ${randomUUID()}`, tipo: "proveedor_producto", condicionPago: "inmediato", empaque: "2500" });
    await costo("PROV-1", { costo: "1000", envioAgencia: "0", terceroId: proveedorId });
    const r = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ lineas: [{ skuCodigo: "PROV-1" }] }));
    await dbComoEmpresa(empresaId, (tx) => tx.update(terceros).set({ empaque: "4000" }).where(eq(terceros.id, proveedorId)));
    await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ pedidoIdExterno: (await leerPedidoExterno(r.pedidoId)), lineas: [{ skuCodigo: "PROV-1" }] }));
    expect((await leer(r.pedidoId)).cabecera.empaqueCongelado).toBe("2500.00");
  });

  it("forma de entrega desconocida no congela y alerta", async () => {
    await costo("DESC-1", { costo: "1000" });
    const r = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ formaEntrega: "desconocida", lineas: [{ skuCodigo: "DESC-1" }] }));
    expect(r).toMatchObject({ congelada: false, estadoCosteo: "completo" });
    expect(r.alertas).toContainEqual({ tipo: "forma_entrega_desconocida" });
    expect((await leer(r.pedidoId)).cabecera.congeladoTs).toBeNull();
  });

  it("dos líneas en un paquete cobran empaque y envío una vez, y las líneas suman el total", async () => {
    await costo("PAQ-A", { costo: "1", empaque: "1500", envioAgencia: "2000" });
    await costo("PAQ-B", { costo: "1", empaque: "3000", envioAgencia: "1000" });
    const r = await guardarVentaFinanzas(
      empresaId,
      cuentaMlId,
      venta({ lineas: [{ skuCodigo: "PAQ-A", precioUnitario: "10000.00" }, { skuCodigo: "PAQ-B", precioUnitario: "10000.00", cantidad: 2 }] })
    );
    const { cabecera, lineas } = await leer(r.pedidoId);
    expect(cabecera).toMatchObject({ empaqueCongelado: "3000.00", envioAgenciaCongelado: "2000.00" });
    expect(lineas.map((l) => [l.valorLinea, l.empaqueCongelado, l.envioCongelado])).toEqual([
      ["10000.00", "1000.00", "666.67"],
      ["20000.00", "2000.00", "1333.33"],
    ]);
    // Comisión y flete de la orden también se reparten con suma exacta.
    expect(lineas.map((l) => l.comisionMl)).toEqual(["2000.00", "4000.00"]);
  });

  it("carrito: dos órdenes del mismo envío pagan el cargo del paquete una sola vez", async () => {
    await costo("CARR-1", { costo: "1", empaque: "3000", envioAgencia: "2000" });
    const shipmentIdExterno = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const primera = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ shipmentIdExterno, lineas: [{ skuCodigo: "CARR-1" }] }));
    const segunda = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ shipmentIdExterno, lineas: [{ skuCodigo: "CARR-1" }] }));
    const a = (await leer(primera.pedidoId)).cabecera;
    const b = (await leer(segunda.pedidoId)).cabecera;
    expect([a.empaqueCongelado, a.envioAgenciaCongelado]).toEqual(["3000.00", "2000.00"]);
    expect([b.empaqueCongelado, b.envioAgenciaCongelado]).toEqual(["0.00", "0.00"]);
  });

  it("la fecha de despacho se llena en una sincronización posterior y nunca se borra", async () => {
    const datos = venta({ lineas: [{ skuCodigo: "SIN-MAESTRA-FECHAS" }] });
    const r = await guardarVentaFinanzas(empresaId, cuentaMlId, datos);
    expect((await leer(r.pedidoId)).cabecera.fechaDespacho).toBeNull();

    const despacho = new Date("2026-10-22T14:00:00Z");
    await guardarVentaFinanzas(empresaId, cuentaMlId, { ...datos, fechaDespacho: despacho, shipmentIdExterno: "99887766" });
    await guardarVentaFinanzas(empresaId, cuentaMlId, { ...datos, fechaDespacho: null, shipmentIdExterno: null });
    expect((await leer(r.pedidoId)).cabecera).toMatchObject({ fechaDespacho: despacho, shipmentIdExterno: "99887766" });
  });

  it("reembolso total deja la venta cancelada", async () => {
    const r = await guardarVentaFinanzas(empresaId, cuentaMlId, venta({ reembolsos: "50000.00", cancelada: true, lineas: [{ skuCodigo: "SIN-MAESTRA-RE" }] }));
    expect((await leer(r.pedidoId)).cabecera).toMatchObject({ cancelada: true, valorVenta: "50000.00", reembolsos: "50000.00" });
  });

  it("dos empresas escriben solo sus filas, aunque el SKU y la orden de ML se llamen igual", async () => {
    const otra = await crearDosEmpresas();
    const cuentaOtra = await crearCuentaMlDePrueba(otra.empresaAId);
    await guardarCostoSku({ empresaId: otra.empresaAId, usuarioId: otra.usuarioAId, skuCodigo: "IDEM-1", datos: { costo: "99" } });
    const misma = venta({ lineas: [{ skuCodigo: "IDEM-1" }] });
    const deA = await guardarVentaFinanzas(empresaId, cuentaMlId, misma);
    const deOtra = await guardarVentaFinanzas(otra.empresaAId, cuentaOtra, misma);
    expect(deA.pedidoId).not.toBe(deOtra.pedidoId);
    const vistasPorOtra = await dbComoEmpresa(otra.empresaAId, (tx) => tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, deA.pedidoId)));
    expect(vistasPorOtra).toHaveLength(0);
    const lineasOtra = await dbComoEmpresa(otra.empresaAId, (tx) => tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, deOtra.pedidoId)));
    expect(lineasOtra[0].costoCongelado).toBe("99.00");
  });

  async function leerPedidoExterno(pedidoId: string): Promise<string> {
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select({ externo: pedidos.pedidoIdExterno }).from(pedidos).where(eq(pedidos.id, pedidoId)));
    return fila.externo;
  }
});
