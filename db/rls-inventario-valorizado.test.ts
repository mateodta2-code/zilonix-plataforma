import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { membresias, roles, skus } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { guardarCostoSku } from "../lib/costos-sku";
import { crearBodega } from "../lib/inventario/bodegas";
import { crearOrdenCompra, registrarRecepcion } from "../lib/inventario/compras";
import { aplicarMovimientos } from "../lib/inventario/movimientos";
import { leerInventarioValorizado } from "../lib/finanzas/inventario-valorizado-db";
import { SinPermisoError } from "../lib/permisos";

// Issue #422 — el inventario valorizado de una empresa nunca suma stock,
// costos ni órdenes de compra de otra, contra Postgres real con app_user.

async function crearSku(empresaId: string, codigo: string): Promise<string> {
  const [f] = await dbComoEmpresa(empresaId, (tx) => tx.insert(skus).values({ empresaId, codigo, nombre: codigo }).returning({ id: skus.id }));
  return f.id;
}

// leerInventarioValorizado exige finanzas.consultar: cada usuario de
// prueba entra como Dueño de su propia empresa (y de ninguna otra).
async function hacerDueno(empresaId: string, usuarioId: string) {
  const rolId = randomUUID();
  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.insert(roles).values({ id: rolId, nombre: "Dueño", empresaId });
    await tx.insert(membresias).values({ id: randomUUID(), usuarioId, empresaId, rolId });
  });
}

async function entrada(empresaId: string, usuarioId: string, bodegaId: string, skuId: string, cantidad: number) {
  await aplicarMovimientos(empresaId, {
    claveIdempotencia: `prueba:${randomUUID()}`,
    origen: "manual",
    actor: { tipo: "persona", usuarioId },
    lineas: [{ tipo: "entrada", bodegaId, skuId, cantidad }],
  });
}

describe("inventario valorizado (RLS, issue #422)", () => {
  let c: ContextoDosEmpresas;

  beforeAll(async () => {
    c = await crearDosEmpresas();
    await hacerDueno(c.empresaAId, c.usuarioAId);
    await hacerDueno(c.empresaBId, c.usuarioBId);

    // Empresa A: mismo código de SKU que B, con otro costo y otro stock.
    const { id: principalA } = await crearBodega(c.empresaAId, c.usuarioAId, { nombre: "Principal", tipo: "propia" });
    const { id: fullA } = await crearBodega(c.empresaAId, c.usuarioAId, { nombre: "Full", tipo: "fulfillment_ml" });
    const skuA = await crearSku(c.empresaAId, "REF-1");
    const sinCostoA = await crearSku(c.empresaAId, "SIN-COSTO");
    await guardarCostoSku({ empresaId: c.empresaAId, usuarioId: c.usuarioAId, skuCodigo: "REF-1", datos: { costo: "1000" } });
    await entrada(c.empresaAId, c.usuarioAId, principalA, skuA, 3);
    await entrada(c.empresaAId, c.usuarioAId, fullA, skuA, 2);
    await entrada(c.empresaAId, c.usuarioAId, principalA, sinCostoA, 4);
    const oc = await crearOrdenCompra(c.empresaAId, c.usuarioAId, {
      terceroId: null,
      bodegaDestinoId: principalA,
      nota: null,
      lineas: [{ skuId: skuA, cantidad: 10, costoUnitario: "800" }],
    });
    await registrarRecepcion(c.empresaAId, c.usuarioAId, {
      recepcionId: randomUUID(),
      ordenCompraId: oc.id,
      bodegaId: principalA,
      nota: null,
      lineas: [{ skuId: skuA, cantidad: 4 }],
    });

    // Empresa B.
    const { id: principalB } = await crearBodega(c.empresaBId, c.usuarioBId, { nombre: "Principal", tipo: "propia" });
    const skuB = await crearSku(c.empresaBId, "REF-1");
    await guardarCostoSku({ empresaId: c.empresaBId, usuarioId: c.usuarioBId, skuCodigo: "REF-1", datos: { costo: "99999" } });
    await entrada(c.empresaBId, c.usuarioBId, principalB, skuB, 1);
  });

  it("A ve solo su stock, sus costos y su OC pendiente", async () => {
    const a = await leerInventarioValorizado(c.empresaAId, c.usuarioAId);
    // Recibir 4 de la OC sumó 4 a la Principal: 3 + 4 = 7 unidades × 1000.
    expect(a.totales).toEqual({
      total: "9000.00",
      porUbicacion: { bodegas: "7000.00", full: "2000.00", falabella: null },
      skusSinCosto: 1,
      unidadesSinCosto: 4,
      saldosNegativos: 0,
    });
    expect(a.enCamino.lineas).toEqual([
      expect.objectContaining({ codigo: "REF-1", unidades: 6, origenCosto: "orden", valor: "4800.00" }),
    ]);
    expect(a.bodegasFull).toHaveLength(1);
    expect(a.bodegasFull[0].ultimoMovimiento).toBeInstanceOf(Date);
  });

  it("B no ve nada de A aunque comparta el código de SKU", async () => {
    const b = await leerInventarioValorizado(c.empresaBId, c.usuarioBId);
    expect(b.lineas).toEqual([expect.objectContaining({ codigo: "REF-1", unidades: 1, valor: "99999.00" })]);
    expect(b.totales.total).toBe("99999.00");
    expect(b.totales.skusSinCosto).toBe(0);
    expect(b.enCamino.lineas).toEqual([]);
    expect(b.bodegasFull).toEqual([]);
  });

  it("un usuario de B no puede leer el inventario de A (requierePermiso adentro)", async () => {
    await expect(leerInventarioValorizado(c.empresaAId, c.usuarioBId)).rejects.toBeInstanceOf(SinPermisoError);
  });
});
