import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { costosSku, kardexMovimientos, skus, stockBodega } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearBodega } from "../lib/inventario/bodegas";
import { aplicarMovimientos } from "../lib/inventario/movimientos";
import { CodigoBloqueadoError, crearProducto, editarProducto, listarSkusCreados } from "../lib/inventario/crear-producto";
import { SkuCodigoDuplicadoError } from "../lib/ml/sku";

// Issue #280 — «Crear producto (SKU)» contra Postgres real con app_user:
// stock inicial al kardex, doble clic, SKU repetido y aislamiento.

async function kardexDe(empresaId: string, skuId: string) {
  return dbComoEmpresa(empresaId, (tx) => tx.select().from(kardexMovimientos).where(eq(kardexMovimientos.skuId, skuId)));
}

describe("crear producto (issue #280)", () => {
  let c: ContextoDosEmpresas;
  let bodegaA: string;

  beforeAll(async () => {
    c = await crearDosEmpresas();
    ({ id: bodegaA } = await crearBodega(c.empresaAId, c.usuarioAId, { nombre: "Principal", tipo: "propia" }));
  });

  it("SKU vacío se genera; stock 5 deja una entrada «Inventario inicial» y saldo 5; costo y precio en costos_sku", async () => {
    const creado = await crearProducto(c.empresaAId, c.usuarioAId, {
      nombre: "Linterna",
      costo: "5000",
      precioVenta: "12900",
      stockInicial: 5,
      bodegaId: bodegaA,
      operacionId: randomUUID(),
    });
    expect(creado.codigo).toBe("FULLIN0001");
    expect(creado.codigoGenerado).toBe(true);

    const kardex = await kardexDe(c.empresaAId, creado.skuId);
    expect(kardex).toHaveLength(1);
    expect(kardex[0]).toMatchObject({ tipo: "entrada", origen: "manual", deltaDisponible: 5, saldoDisponible: 5, nota: "Inventario inicial" });
    const [saldo] = await dbComoEmpresa(c.empresaAId, (tx) => tx.select().from(stockBodega).where(eq(stockBodega.skuId, creado.skuId)));
    expect(saldo.disponible).toBe(5);
    const [costo] = await dbComoEmpresa(c.empresaAId, (tx) =>
      tx.select().from(costosSku).where(and(eq(costosSku.empresaId, c.empresaAId), eq(costosSku.skuCodigo, "FULLIN0001")))
    );
    expect(costo).toMatchObject({ costo: "5000.00", precioVenta: "12900.00", nombreProducto: "Linterna", fuente: "manual" });
  });

  it("el mismo operacionId (doble clic) no crea nada nuevo", async () => {
    const operacionId = randomUUID();
    const datos = { nombre: "Cama", stockInicial: 2, bodegaId: bodegaA, operacionId };
    const primero = await crearProducto(c.empresaAId, c.usuarioAId, datos);
    const segundo = await crearProducto(c.empresaAId, c.usuarioAId, datos);
    expect(segundo.skuId).toBe(primero.skuId);
    expect(segundo.yaExistia).toBe(true);
    const camas = await dbComoEmpresa(c.empresaAId, (tx) => tx.select().from(skus).where(and(eq(skus.empresaId, c.empresaAId), eq(skus.nombre, "Cama"))));
    expect(camas).toHaveLength(1);
    expect(await kardexDe(c.empresaAId, primero.skuId)).toHaveLength(1);
  });

  it("SKU manual repetido (con espacios o minúsculas) falla y no crea nada", async () => {
    await crearProducto(c.empresaAId, c.usuarioAId, { codigo: "001", nombre: "Uno", operacionId: randomUUID() });
    await expect(crearProducto(c.empresaAId, c.usuarioAId, { codigo: "001 ", nombre: "Otro", operacionId: randomUUID() })).rejects.toBeInstanceOf(
      SkuCodigoDuplicadoError
    );
    await crearProducto(c.empresaAId, c.usuarioAId, { codigo: "abc-9", nombre: "Abc", operacionId: randomUUID() });
    await expect(crearProducto(c.empresaAId, c.usuarioAId, { codigo: "ABC-9", nombre: "Otro", operacionId: randomUUID() })).rejects.toBeInstanceOf(
      SkuCodigoDuplicadoError
    );
    const otros = await dbComoEmpresa(c.empresaAId, (tx) => tx.select().from(skus).where(and(eq(skus.empresaId, c.empresaAId), eq(skus.nombre, "Otro"))));
    expect(otros).toHaveLength(0);
  });

  it("stock 0: sin movimiento y el código sigue editable; tras un movimiento solo cambia el nombre", async () => {
    const creado = await crearProducto(c.empresaAId, c.usuarioAId, { codigo: "EDIT-1", nombre: "Editable", costo: "10", operacionId: randomUUID() });
    expect(await kardexDe(c.empresaAId, creado.skuId)).toHaveLength(0);

    await editarProducto(c.empresaAId, c.usuarioAId, { skuId: creado.skuId, nombre: "Editable", codigo: "EDIT-2" });
    const [costo] = await dbComoEmpresa(c.empresaAId, (tx) =>
      tx.select().from(costosSku).where(and(eq(costosSku.empresaId, c.empresaAId), eq(costosSku.skuCodigo, "EDIT-2")))
    );
    expect(costo?.costo).toBe("10.00");

    await aplicarMovimientos(c.empresaAId, {
      claveIdempotencia: `prueba:${randomUUID()}`,
      origen: "manual",
      actor: { tipo: "persona", usuarioId: c.usuarioAId },
      lineas: [{ tipo: "entrada", bodegaId: bodegaA, skuId: creado.skuId, cantidad: 1 }],
    });
    await expect(editarProducto(c.empresaAId, c.usuarioAId, { skuId: creado.skuId, nombre: "Editable", codigo: "EDIT-3" })).rejects.toBeInstanceOf(
      CodigoBloqueadoError
    );
    expect(await editarProducto(c.empresaAId, c.usuarioAId, { skuId: creado.skuId, nombre: "Nombre nuevo", codigo: "EDIT-2" })).toEqual({ codigo: "EDIT-2" });
  });

  it("empresa B: contador propio, no choca con los códigos de A y no ve sus SKU", async () => {
    const b = await crearProducto(c.empresaBId, c.usuarioBId, { nombre: "Linterna", operacionId: randomUUID() });
    expect(b.codigo).toBe("FULLIN0001");
    await crearProducto(c.empresaBId, c.usuarioBId, { codigo: "001", nombre: "Uno de B", operacionId: randomUUID() });
    const listaB = await listarSkusCreados(c.empresaBId);
    expect(listaB.filas.map((f) => f.codigo).sort()).toEqual(["001", "FULLIN0001"]);
    const listaA = await listarSkusCreados(c.empresaAId, { q: "Uno de B" });
    expect(listaA.total).toBe(0);
  });
});
