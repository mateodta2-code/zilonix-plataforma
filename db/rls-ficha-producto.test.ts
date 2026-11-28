import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { costosSku, pedidoItems, pedidos, pedidosFinanzas, skus, terceros } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearCuentaMlDePrueba } from "./test-utils/venta";
import { leerFichasProducto } from "../lib/inventario/ficha-producto";

// Issue #280 — la ficha de inventario (foto, costo, venta, proveedor)
// nunca muestra datos de otra empresa, aunque el código del SKU sea el
// mismo. Contra Postgres real (RLS no se simula).

const CODIGO = "FICHA-1";

async function crearSku(empresaId: string): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.insert(skus).values({ empresaId, codigo: CODIGO, nombre: CODIGO }).returning({ id: skus.id }));
  return fila.id;
}

// Costo, venta, proveedor y una venta con foto para el código.
async function cargarFicha(empresaId: string): Promise<void> {
  const cuentaMlId = await crearCuentaMlDePrueba(empresaId);
  await dbComoEmpresa(empresaId, async (tx) => {
    const [tercero] = await tx
      .insert(terceros)
      .values({ empresaId, nombre: "Proveedor B", tipo: "proveedor_producto", condicionPago: "inmediato" })
      .returning({ id: terceros.id });
    await tx.insert(costosSku).values({ empresaId, skuCodigo: CODIGO, costo: "1234.00", precioVenta: "5678.00", terceroId: tercero.id });
    const [pedido] = await tx
      .insert(pedidos)
      .values({ empresaId, cuentaMlId, pedidoIdExterno: `orden-${randomUUID()}`, fecha: new Date(), total: "1000.00", moneda: "COP", estado: "paid" })
      .returning({ id: pedidos.id });
    await tx.insert(pedidosFinanzas).values({ empresaId, pedidoId: pedido.id, cuentaMlId, valorVenta: "1000.00", formaEntrega: "agencia" });
    await tx.insert(pedidoItems).values({
      empresaId,
      pedidoId: pedido.id,
      linea: 1,
      itemIdExterno: "MCO1",
      skuCodigo: CODIGO,
      cantidad: 1,
      precioUnitario: "1000.00",
      valorLinea: "1000.00",
      titulo: "Producto B",
      imagenUrl: "https://http2.mlstatic.com/empresa-b-I.jpg",
    });
  });
}

describe("ficha de producto del inventario (RLS, issue #280)", () => {
  let c: ContextoDosEmpresas;
  let skuA: string;
  let skuB: string;

  beforeAll(async () => {
    c = await crearDosEmpresas();
    skuA = await crearSku(c.empresaAId);
    skuB = await crearSku(c.empresaBId);
    await cargarFicha(c.empresaBId);
  });

  it("la empresa B ve su propia ficha", async () => {
    const fichas = await leerFichasProducto(c.empresaBId, [{ id: skuB, codigo: CODIGO }]);
    expect(fichas.get(skuB)).toEqual({
      fotoUrl: "https://http2.mlstatic.com/empresa-b-I.jpg",
      costo: "1234.00",
      precioVenta: "5678.00",
      proveedorNombre: "Proveedor B",
    });
  });

  it("la empresa A, con el mismo código, no ve costo, venta, proveedor ni foto de B", async () => {
    const fichas = await leerFichasProducto(c.empresaAId, [{ id: skuA, codigo: CODIGO }]);
    expect(fichas.get(skuA)).toEqual({ fotoUrl: null, costo: null, precioVenta: null, proveedorNombre: null });
  });
});
