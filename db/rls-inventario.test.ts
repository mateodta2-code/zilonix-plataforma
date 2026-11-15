import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import {
  alertasUltimaUnidad,
  bodegas,
  configuracionInventario,
  kardexMovimientos,
  ordenCompraItems,
  ordenesCompra,
  recepcionItems,
  recepciones,
  skus,
  stockBodega,
  syncStockMl,
} from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearBodega } from "../lib/inventario/bodegas";
import { crearOrdenCompra, registrarRecepcion } from "../lib/inventario/compras";
import { aplicarMovimientos } from "../lib/inventario/movimientos";
import { guardarConfiguracionInventario } from "../lib/inventario/configuracion";
import { randomUUID } from "crypto";

// Issue #280 — aislamiento de las tablas de inventario contra Postgres
// real (RLS no se simula). Sin afirmarAislamiento(): app_user no tiene
// DELETE en ninguna de estas tablas, así que el DELETE no da "0 filas",
// da error de permiso — se prueba eso aparte.

async function crearSku(empresaId: string, codigo: string): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.insert(skus).values({ empresaId, codigo, nombre: codigo }).returning({ id: skus.id }));
  return fila.id;
}

describe("inventario (RLS, issue #280)", () => {
  let c: ContextoDosEmpresas;
  let bodegaA: string;
  let skuA: string;
  let ordenA: string;

  beforeAll(async () => {
    c = await crearDosEmpresas();
    ({ id: bodegaA } = await crearBodega(c.empresaAId, c.usuarioAId, { nombre: "Principal", tipo: "propia" }));
    skuA = await crearSku(c.empresaAId, "INV-A");
    await aplicarMovimientos(c.empresaAId, {
      claveIdempotencia: `prueba:${randomUUID()}`,
      origen: "manual",
      actor: { tipo: "persona", usuarioId: c.usuarioAId },
      lineas: [{ tipo: "entrada", bodegaId: bodegaA, skuId: skuA, cantidad: 3 }],
    });
    ({ id: ordenA } = await crearOrdenCompra(c.empresaAId, c.usuarioAId, {
      terceroId: null,
      bodegaDestinoId: bodegaA,
      nota: null,
      lineas: [{ skuId: skuA, cantidad: 5 }],
    }));
    await registrarRecepcion(c.empresaAId, c.usuarioAId, {
      recepcionId: randomUUID(),
      ordenCompraId: ordenA,
      bodegaId: bodegaA,
      nota: null,
      lineas: [{ skuId: skuA, cantidad: 2 }],
    });
    await guardarConfiguracionInventario(c.empresaAId, c.usuarioAId, {
      reglaUltimaUnidad: "preguntar",
      umbralUltimaUnidad: 1,
      bufferMl: 0,
      syncMlActivo: false,
      reservarPedidos: false,
    });
  });

  const tablas = [
    ["bodegas", bodegas],
    ["stock_bodega", stockBodega],
    ["kardex_movimientos", kardexMovimientos],
    ["ordenes_compra", ordenesCompra],
    ["orden_compra_items", ordenCompraItems],
    ["recepciones", recepciones],
    ["recepcion_items", recepcionItems],
    ["configuracion_inventario", configuracionInventario],
    ["sync_stock_ml", syncStockMl],
  ] as const;

  it.each(tablas)("%s: B no ve ni edita las filas de A; A sí las ve", async (_nombre, tabla) => {
    const deA = await dbComoEmpresa(c.empresaAId, (tx) => tx.select({ id: tabla.id }).from(tabla).where(eq(tabla.empresaId, c.empresaAId)));
    expect(deA.length).toBeGreaterThan(0);

    const veB = await dbComoEmpresa(c.empresaBId, (tx) => tx.select({ id: tabla.id }).from(tabla).where(eq(tabla.empresaId, c.empresaAId)));
    expect(veB).toHaveLength(0);
  });

  it.each([
    ["bodegas", bodegas],
    ["stock_bodega", stockBodega],
    ["ordenes_compra", ordenesCompra],
    ["orden_compra_items", ordenCompraItems],
    ["configuracion_inventario", configuracionInventario],
    ["sync_stock_ml", syncStockMl],
  ] as const)("%s: el UPDATE de B sobre una fila de A no afecta nada", async (_nombre, tabla) => {
    const editadas = await dbComoEmpresa(c.empresaBId, (tx) =>
      tx
        .update(tabla)
        .set({ empresaId: c.empresaBId } as never)
        .where(eq(tabla.empresaId, c.empresaAId))
        .returning({ id: tabla.id })
    );
    expect(editadas).toHaveLength(0);
  });

  it.each(tablas)("%s: app_user no puede borrar, ni siquiera la empresa dueña", async (_nombre, tabla) => {
    await expect(dbComoEmpresa(c.empresaAId, (tx) => tx.delete(tabla).where(eq(tabla.empresaId, c.empresaAId)))).rejects.toThrow(/permission denied/);
  });

  it("el kardex es de solo inserción: ni la empresa dueña lo edita", async () => {
    await expect(
      dbComoEmpresa(c.empresaAId, (tx) => tx.update(kardexMovimientos).set({ nota: "reescrito" }).where(eq(kardexMovimientos.empresaId, c.empresaAId)))
    ).rejects.toThrow(/permission denied/);
    await expect(
      dbComoEmpresa(c.empresaAId, (tx) => tx.update(recepciones).set({ nota: "reescrita" }).where(eq(recepciones.empresaId, c.empresaAId)))
    ).rejects.toThrow(/permission denied/);
  });

  it("una fila de B no puede apuntar a una bodega o un SKU de A (clave compuesta)", async () => {
    const { id: bodegaB } = await crearBodega(c.empresaBId, c.usuarioBId, { nombre: "Principal", tipo: "propia" });
    const skuB = await crearSku(c.empresaBId, "INV-B");
    await expect(
      dbComoEmpresa(c.empresaBId, (tx) => tx.insert(stockBodega).values({ empresaId: c.empresaBId, bodegaId: bodegaA, skuId: skuB }))
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(c.empresaBId, (tx) => tx.insert(stockBodega).values({ empresaId: c.empresaBId, bodegaId: bodegaB, skuId: skuA }))
    ).rejects.toThrow();
    // Y por la puerta única, el SKU de A "no existe" para B.
    await expect(
      aplicarMovimientos(c.empresaBId, {
        claveIdempotencia: `prueba:${randomUUID()}`,
        origen: "manual",
        actor: { tipo: "persona", usuarioId: c.usuarioBId },
        lineas: [{ tipo: "entrada", bodegaId: bodegaB, skuId: skuA, cantidad: 1 }],
      })
    ).rejects.toThrow(/no existe/);
  });

  it("la base no deja un saldo negativo aunque alguien se salte el servicio", async () => {
    await expect(
      dbComoEmpresa(c.empresaAId, (tx) =>
        tx.update(stockBodega).set({ disponible: sql`${stockBodega.disponible} - 1000` }).where(eq(stockBodega.empresaId, c.empresaAId))
      )
    ).rejects.toThrow();
  });

  it("alertas_ultima_unidad: B no ve ni resuelve las de A", async () => {
    const [alerta] = await dbComoEmpresa(c.empresaAId, (tx) =>
      tx.insert(alertasUltimaUnidad).values({ empresaId: c.empresaAId, skuId: skuA, disponibleAlCrear: 1, regla: "preguntar" }).returning({ id: alertasUltimaUnidad.id })
    );
    const veB = await dbComoEmpresa(c.empresaBId, (tx) => tx.select().from(alertasUltimaUnidad).where(eq(alertasUltimaUnidad.id, alerta.id)));
    expect(veB).toHaveLength(0);
    const resueltasPorB = await dbComoEmpresa(c.empresaBId, (tx) =>
      tx
        .update(alertasUltimaUnidad)
        .set({ estado: "descartada", resueltaTs: new Date() })
        .where(eq(alertasUltimaUnidad.id, alerta.id))
        .returning({ id: alertasUltimaUnidad.id })
    );
    expect(resueltasPorB).toHaveLength(0);
  });
});
