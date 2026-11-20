import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { costosSku, cuentasFalabella, movimientosMarketplace, pedidosFalabella } from "./schema";
import { SinPermisoError } from "../lib/permisos";
import { crearEmpresaConPermisos } from "../lib/test-utils/empresa-con-permiso";
import { crearReporteDePrueba, SELLER_ID_PRUEBA } from "../lib/test-utils/reporte-falabella";
import { importarReporteFalabella } from "../lib/falabella/conciliacion";
import { listarUtilidadFalabella } from "../lib/finanzas/utilidad-falabella-consulta";

// Issue #422 — la utilidad de Falabella lee pedidos_falabella,
// movimientos_marketplace y costos_sku con RLS de la empresa (contra
// Postgres real: RLS no se simula). Una empresa nunca ve órdenes,
// cobros ni costos de otra.

const PERMISOS = [
  { modulo: "finanzas" as const, accion: "consultar" as const },
  { modulo: "finanzas" as const, accion: "modificar" as const },
];

const RANGO = {
  cuentaId: null,
  desde: "2026-11-01",
  hasta: "2026-11-30",
  inicio: new Date("2026-11-01T05:00:00Z"),
  finExclusivo: new Date("2026-12-01T05:00:00Z"),
};

async function prepararEmpresa(nombre: string, sellerId: string, conReporte: boolean) {
  const empresa = await crearEmpresaConPermisos(nombre, PERMISOS);
  await dbComoEmpresa(empresa.empresaId, async (tx) => {
    const [cuenta] = await tx
      .insert(cuentasFalabella)
      .values({
        empresaId: empresa.empresaId,
        userId: `utilidad-${randomUUID()}@ejemplo.com`,
        apiKeyCifrada: { version: 1, iv: "x", authTag: "y", datos: "z" },
        sellerId,
        nickname: `Tienda ${sellerId}`,
      })
      .returning({ id: cuentasFalabella.id });
    // Órdenes 3000001 (por OrderId, fila vieja sin numero_orden) y
    // 3000002 (por numero_orden = OrderNumber de GetOrders); 3000099 sin reporte; una cancelada que no es venta.
    await tx.insert(pedidosFalabella).values([
      { empresaId: empresa.empresaId, cuentaFalabellaId: cuenta.id, pedidoIdExterno: "3000001", fecha: new Date("2026-11-03T15:00:00Z"), total: "20000", moneda: "COP", estado: "delivered", items: [{ Sku: "SKU-PRUEBA-1" }] },
      { empresaId: empresa.empresaId, cuentaFalabellaId: cuenta.id, pedidoIdExterno: "1104089002", numeroOrden: "3000002", fecha: new Date("2026-11-03T15:00:00Z"), total: "25000", moneda: "COP", estado: "delivered", items: [{ Sku: "SKU-PRUEBA-2" }] },
      { empresaId: empresa.empresaId, cuentaFalabellaId: cuenta.id, pedidoIdExterno: "3000099", fecha: new Date("2026-11-10T15:00:00Z"), total: "10000", moneda: "COP", estado: "shipped", items: [] },
      { empresaId: empresa.empresaId, cuentaFalabellaId: cuenta.id, pedidoIdExterno: "3000098", fecha: new Date("2026-11-10T15:00:00Z"), total: "10000", moneda: "COP", estado: "canceled", items: [] },
    ]);
    await tx.insert(costosSku).values([{ empresaId: empresa.empresaId, skuCodigo: "SKU-PRUEBA-1", costo: "5000.00" }]);
  });
  if (conReporte) {
    await importarReporteFalabella(empresa.empresaId, empresa.usuarioId, { nombre: "reporte.xlsx", contenido: crearReporteDePrueba() });
  }
  return empresa;
}

describe("utilidad de Falabella (RLS)", () => {
  let a: { empresaId: string; usuarioId: string };
  let b: { empresaId: string; usuarioId: string };

  beforeAll(async () => {
    a = await prepararEmpresa("Utilidad Falabella A", SELLER_ID_PRUEBA, true);
    b = await prepararEmpresa("Utilidad Falabella B", `OTRO-${randomUUID().slice(0, 8)}`, false);
  });

  it("calcula con las órdenes, los cobros y la maestra de la propia empresa", async () => {
    const consulta = await listarUtilidadFalabella(a.empresaId, a.usuarioId, RANGO);
    if (!consulta.ok) throw new Error(consulta.error);
    const { ordenes, totales } = consulta.resultado;
    expect(consulta.moneda).toBe("COP");
    expect(ordenes.map((o) => o.numero).sort()).toEqual(["3000001", "3000002", "3000099"]);
    expect(ordenes.find((o) => o.numero === "3000001")).toMatchObject({ estado: "calculada", utilidad: "3992.00" });
    // Se muestra el OrderNumber; el OrderId va aparte, en gris.
    expect(ordenes.find((o) => o.numero === "3000002")).toMatchObject({ numeroInterno: "1104089002", estado: "falta_costo", ventas: "25000.00" });
    expect(ordenes.find((o) => o.numero === "3000099")!.estado).toBe("sin_reporte");
    expect(totales).toMatchObject({ ordenesFaltaCosto: 1, ordenesSinReporte: 1 });
  });

  it("la publicidad sin orden del último día del rango entra (fecha_transaccion es date) y la del día siguiente no", async () => {
    const [cuenta] = await dbComoEmpresa(a.empresaId, (tx) => tx.select({ id: cuentasFalabella.id }).from(cuentasFalabella));
    const publicidad = (fecha: string, monto: string) => ({
      empresaId: a.empresaId,
      marketplace: "falabella",
      cuentaFalabellaId: cuenta.id,
      numeroOrden: null,
      tipoTransaccion: "Cobro publicidad",
      categoria: "publicidad" as const,
      moneda: "COP",
      monto,
      fechaTransaccion: fecha,
      huella: `prueba-borde-${fecha}-${randomUUID()}`,
    });
    await dbComoEmpresa(a.empresaId, (tx) =>
      tx.insert(movimientosMarketplace).values([publicidad("2026-11-30", "-11900"), publicidad("2026-12-01", "-5000")])
    );
    const consulta = await listarUtilidadFalabella(a.empresaId, a.usuarioId, RANGO);
    if (!consulta.ok) throw new Error(consulta.error);
    expect(consulta.resultado.totales.cargosSinOrden).toBe("-11900.00");
  });

  it("otra empresa no ve los cobros ni los costos de la primera", async () => {
    const consulta = await listarUtilidadFalabella(b.empresaId, b.usuarioId, RANGO);
    if (!consulta.ok) throw new Error(consulta.error);
    expect(consulta.resultado.ordenes.every((o) => o.estado === "sin_reporte")).toBe(true);
    expect(consulta.resultado.totales.ventas).toBe("0.00");
  });

  it("sin finanzas.consultar no lee nada", async () => {
    const sinPermiso = await crearEmpresaConPermisos("Utilidad Falabella sin permiso", []);
    await expect(listarUtilidadFalabella(sinPermiso.empresaId, sinPermiso.usuarioId, RANGO)).rejects.toBeInstanceOf(SinPermisoError);
  });
});
