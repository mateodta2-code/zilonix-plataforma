import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoBodega } from "./bodega-context";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { auditoria, despachoItemsBodega3pl, despachosBodega3pl, pedidos, stockBodega3pl, usuarios } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";
import { crearVentaDePrueba } from "./test-utils/venta";
import { aceptarInvitacionBodega } from "../lib/bodega/invitaciones";
import { registrarRecepcion } from "../lib/bodega/recepcion";
import { DespachoBodegaError, enviarPedidoABodega, listarDespachosBodega, listarDespachosBodegaDePedidos, marcarPreparado, StockInsuficienteError } from "../lib/bodega/despachos";
import { cambiarEstadoVinculo, crearBodega, invitarAdminBodega, ligarEmpresaABodega } from "../lib/superadmin-bodegas";

// Issue #628 (Bodega-3) — contra Postgres real. Pruebas A/B propias (no
// afirmarAislamiento). Un UPDATE/DELETE filtrado por RLS no falla: afecta 0
// filas, por eso .returning() + longitud 0.
describe("despachos_bodega_3pl (RLS + lib, Bodega-3)", () => {
  const superadminId = randomUUID();
  const adminAId = randomUUID();
  const adminBId = randomUUID();
  const sufijo = randomUUID().slice(0, 8);
  let empresaA: string;
  let empresaB: string;
  let usuarioA: string;
  let usuarioB: string;
  let bodegaA: string;
  let bodegaB: string;
  let numeroA: string;
  let despachoA: string;

  async function usuario(id: string, extra: Partial<typeof usuarios.$inferInsert> = {}) {
    await db.insert(usuarios).values({ id, email: `despachos3pl-${id.slice(0, 8)}@zilonix.test`, nombre: `Persona ${id.slice(0, 4)}`, ...extra });
  }
  async function numeroDe(empresaId: string, pedidoId: string) {
    const [p] = await dbComoEmpresa(empresaId, (tx) => tx.select({ n: pedidos.pedidoIdExterno }).from(pedidos).where(eq(pedidos.id, pedidoId)));
    return p.n;
  }
  const stockDe = (bodegaId: string, empresaId: string, sku: string) =>
    dbComoBodega(bodegaId, async (tx) => (await tx.select({ c: stockBodega3pl.cantidad }).from(stockBodega3pl).where(and(eq(stockBodega3pl.empresaId, empresaId), eq(stockBodega3pl.sku, sku))))[0]?.c ?? 0);

  beforeAll(async () => {
    await usuario(superadminId, { esSuperadmin: true });
    await usuario(adminAId);
    await usuario(adminBId);
    const ctx = await crearDosEmpresas();
    empresaA = ctx.empresaAId;
    empresaB = ctx.empresaBId;
    usuarioA = ctx.usuarioAId;
    usuarioB = ctx.usuarioBId;
    bodegaA = (await crearBodega(superadminId, { nombre: `Bodega A ${sufijo}`, nit: "" })).id;
    bodegaB = (await crearBodega(superadminId, { nombre: `Bodega B ${sufijo}`, nit: "" })).id;
    await aceptarInvitacionBodega((await invitarAdminBodega(superadminId, bodegaA, "a@zilonix.test")).token, adminAId);
    await aceptarInvitacionBodega((await invitarAdminBodega(superadminId, bodegaB, "b@zilonix.test")).token, adminBId);
    await ligarEmpresaABodega(superadminId, bodegaA, empresaA);
    const venta = await crearVentaDePrueba(empresaA, { lineas: 2 });
    numeroA = await numeroDe(empresaA, venta.pedidoId);
  });

  it("el vendedor envía su pedido a la bodega ligada; una empresa sin bodega no puede", async () => {
    ({ despachoId: despachoA } = await enviarPedidoABodega(empresaA, usuarioA, numeroA));
    await expect(enviarPedidoABodega(empresaA, usuarioA, numeroA)).rejects.toBeInstanceOf(DespachoBodegaError);
    const ventaB = await crearVentaDePrueba(empresaB, { lineas: 1 });
    await expect(enviarPedidoABodega(empresaB, usuarioB, await numeroDe(empresaB, ventaB.pedidoId))).rejects.toBeInstanceOf(DespachoBodegaError);
    // Aun saltándose la lib, la base rechaza enviar a una bodega no ligada.
    const venta2 = await crearVentaDePrueba(empresaA, { lineas: 1 });
    await expect(
      dbComoEmpresa(empresaA, (tx) => tx.insert(despachosBodega3pl).values({ bodegaId: bodegaB, empresaId: empresaA, pedidoId: venta2.pedidoId, numeroPedido: "x", creadoPor: usuarioA }))
    ).rejects.toThrow();
    // Y la empresa B no puede insertar un despacho a nombre de A.
    await expect(
      dbComoEmpresa(empresaB, (tx) => tx.insert(despachosBodega3pl).values({ bodegaId: bodegaA, empresaId: empresaA, pedidoId: venta2.pedidoId, numeroPedido: "x", creadoPor: usuarioA }))
    ).rejects.toThrow();
  });

  it("A/B: la bodega ve solo lo suyo; la otra bodega y la otra empresa no ven nada", async () => {
    const deA = await listarDespachosBodega(bodegaA);
    expect(deA.map((d) => d.numeroPedido)).toContain(numeroA);
    expect(deA.find((d) => d.id === despachoA)?.lineas).toHaveLength(2);
    expect(await listarDespachosBodega(bodegaB)).toHaveLength(0);
    expect(await dbComoEmpresa(empresaB, (tx) => tx.select().from(despachosBodega3pl))).toHaveLength(0);
    expect(await dbComoEmpresa(empresaB, (tx) => tx.select().from(despachoItemsBodega3pl))).toHaveLength(0);
    expect(await dbComoBodega(bodegaB, (tx) => tx.select().from(despachoItemsBodega3pl))).toHaveLength(0);
    const tocados = await dbComoBodega(bodegaB, (tx) => tx.update(despachosBodega3pl).set({ estado: "preparado" }).returning({ id: despachosBodega3pl.id }), "admin_bodega");
    expect(tocados).toHaveLength(0);
    await expect(marcarPreparado(bodegaB, adminBId, despachoA, "admin_bodega")).rejects.toBeInstanceOf(DespachoBodegaError);
    expect((await listarDespachosBodegaDePedidos(empresaA, [numeroA]))[0].estado).toBe("pendiente");
  });

  it("la bodega no lee pedidos ni datos del comprador: ni en las tablas ni en lo que devuelve la lib", async () => {
    expect(await dbComoBodega(bodegaA, (tx) => tx.select().from(pedidos))).toHaveLength(0);
    const columnas = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name IN ('despachos_bodega_3pl', 'despacho_items_bodega_3pl')`);
    const nombres = (columnas as unknown as { column_name: string }[]).map((c) => c.column_name).join(" ");
    expect(nombres).not.toMatch(/comprador|nombre|telefono|direccion|documento|precio|valor|total|email/);
    const [fila] = (await listarDespachosBodega(bodegaA)).filter((d) => d.id === despachoA);
    expect(Object.keys(fila).sort()).toEqual(["creadoTs", "empresaId", "empresaNombre", "estado", "id", "lineas", "numeroPedido", "preparadoTs", "tipoEnvio"]);
    expect(Object.keys(fila.lineas[0]).sort()).toEqual(["cantidad", "sku"]);
  });

  it("la bodega solo cambia estado/preparado_*; nadie borra", async () => {
    await expect(dbComoBodega(bodegaA, (tx) => tx.update(despachosBodega3pl).set({ numeroPedido: "otro" }), "admin_bodega")).rejects.toThrow();
    await expect(dbComoBodega(bodegaA, (tx) => tx.delete(despachosBodega3pl), "admin_bodega")).rejects.toThrow();
    await expect(dbComoEmpresa(empresaA, (tx) => tx.update(despachosBodega3pl).set({ estado: "preparado" }))).rejects.toThrow();
  });

  it("stock insuficiente: avisa, no descuenta nada y el despacho sigue pendiente", async () => {
    // Solo alcanza para uno de los dos SKU del pedido (REF-1 y REF-2, 1 unidad c/u).
    await registrarRecepcion(bodegaA, adminAId, { empresaId: empresaA, lineas: [{ sku: "REF-1", cantidad: 5 }] }, "admin_bodega");
    await expect(marcarPreparado(bodegaA, adminAId, despachoA, "admin_bodega")).rejects.toBeInstanceOf(StockInsuficienteError);
    expect(await stockDe(bodegaA, empresaA, "REF-1")).toBe(5);
    expect((await listarDespachosBodegaDePedidos(empresaA, [numeroA]))[0].estado).toBe("pendiente");
    const acciones = (await dbComoBodega(bodegaA, (tx) => tx.select().from(auditoria).where(eq(auditoria.entidadId, despachoA)), "admin_bodega")).map((a) => a.accion);
    expect(acciones).not.toContain("bodega.despacho.preparar");
  });

  it("preparado descuenta stock una sola vez, queda en auditoria con empresa_id y el vendedor lo ve", async () => {
    await registrarRecepcion(bodegaA, adminAId, { empresaId: empresaA, lineas: [{ sku: "REF-2", cantidad: 3 }] }, "admin_bodega");
    await marcarPreparado(bodegaA, adminAId, despachoA, "admin_bodega");
    expect(await stockDe(bodegaA, empresaA, "REF-1")).toBe(4);
    expect(await stockDe(bodegaA, empresaA, "REF-2")).toBe(2);
    // Segundo «preparado»: se rechaza y no descuenta otra vez.
    await expect(marcarPreparado(bodegaA, adminAId, despachoA, "admin_bodega")).rejects.toBeInstanceOf(DespachoBodegaError);
    expect(await stockDe(bodegaA, empresaA, "REF-1")).toBe(4);

    const filas = await dbComoEmpresa(empresaA, (tx) => tx.select().from(auditoria).where(and(eq(auditoria.entidadId, despachoA), eq(auditoria.accion, "bodega.despacho.preparar"))));
    expect(filas).toHaveLength(1);
    expect(filas[0].empresaId).toBe(empresaA);
    expect(filas[0].bodegaId).toBe(bodegaA);

    const visto = (await listarDespachosBodegaDePedidos(empresaA, [numeroA]))[0];
    expect(visto.estado).toBe("preparado");
    expect(visto.preparadoTs).not.toBeNull();
    // Una vez preparado, ni la base deja volver a tocarlo.
    const retocados = await dbComoBodega(bodegaA, (tx) => tx.update(despachosBodega3pl).set({ estado: "preparado" }).where(eq(despachosBodega3pl.id, despachoA)).returning({ id: despachosBodega3pl.id }), "admin_bodega");
    expect(retocados).toHaveLength(0);
  });

  it("una empresa con vínculo pausado no puede preparar (la base lo impide)", async () => {
    const venta = await crearVentaDePrueba(empresaA, { lineas: 1 });
    const { despachoId } = await enviarPedidoABodega(empresaA, usuarioA, await numeroDe(empresaA, venta.pedidoId));
    await cambiarEstadoVinculo(superadminId, bodegaA, empresaA, "pausada");
    await expect(marcarPreparado(bodegaA, adminAId, despachoId, "admin_bodega")).rejects.toBeInstanceOf(DespachoBodegaError);
    await cambiarEstadoVinculo(superadminId, bodegaA, empresaA, "activa");
  });
});
