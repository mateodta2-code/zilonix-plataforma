import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import {
  alertasUltimaUnidad,
  bodegas,
  configuracionInventario,
  kardexMovimientos,
  ordenCompraItems,
  pedidoItems,
  pedidos,
  pedidosFinanzas,
  ordenesCompra,
  recepcionItems,
  recepciones,
  skus,
  stockBodega,
  syncStockMl,
  devolucionesInventario,
} from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearCuentaMlDePrueba } from "./test-utils/venta";
import { crearBodega } from "../lib/inventario/bodegas";
import { actualizarDatosCompra, actualizarLineasCompra, CompraInvalidaError, crearOrdenCompra, listarRegistroCompras, registrarCompra, registrarRecepcion } from "../lib/inventario/compras";
import { SkuCodigoDuplicadoError } from "../lib/ml/sku";
import { anularDevolucion, DevolucionInvalidaError, guardarDevolucionesMl, listarDevoluciones, NOMBRE_BODEGA_AVERIADOS, recibirDevolucion, registrarDevolucion } from "../lib/inventario/devoluciones";
import { aplicarMovimientos } from "../lib/inventario/movimientos";
import { guardarConfiguracionInventario } from "../lib/inventario/configuracion";
import { listarInventarioParaExportar, listarKardexParaExportar, stockPorBodegaDeSkus } from "../lib/inventario/stock";
import { randomUUID } from "crypto";

// Issue #280 — aislamiento de las tablas de inventario contra Postgres
// real (RLS no se simula). Sin afirmarAislamiento(): app_user no tiene
// DELETE en ninguna de estas tablas, así que el DELETE no da "0 filas",
// da error de permiso — se prueba eso aparte.

async function crearSku(empresaId: string, codigo: string): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.insert(skus).values({ empresaId, codigo, nombre: codigo }).returning({ id: skus.id }));
  return fila.id;
}

// Una venta de hoy (dentro de la ventana de 30 días) con una línea del
// SKU dado. La línea guarda sku_id con una FK simple: la base deja que
// B apunte al id de un SKU de A, por eso el conteo no puede fiarse del
// sku_id solo.
async function crearVentaHoy(empresaId: string, skuId: string, cantidad: number): Promise<void> {
  const cuentaMlId = await crearCuentaMlDePrueba(empresaId);
  await dbComoEmpresa(empresaId, async (tx) => {
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
      skuCodigo: "INV-A",
      skuId,
      cantidad,
      precioUnitario: "1000.00",
      valorLinea: "1000.00",
      titulo: "Producto",
    });
  });
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

  it("stockPorBodegaDeSkus: B no ve el stock de A ni pasando los skuIds de A", async () => {
    const deA = await stockPorBodegaDeSkus(c.empresaAId, [skuA]);
    expect(deA.get(skuA)?.totalDisponible).toBeGreaterThan(0);
    expect(deA.get(skuA)?.porTipo.propia).toBe(deA.get(skuA)?.totalDisponible);
    expect(deA.get(skuA)?.porBodega.map((b) => b.bodegaId)).toContain(bodegaA);

    const veB = await stockPorBodegaDeSkus(c.empresaBId, [skuA]);
    expect(veB.size).toBe(0);
  });

  it("listarInventarioParaExportar: B nunca trae SKU de A, ni buscando su código", async () => {
    const deA = await listarInventarioParaExportar(c.empresaAId);
    expect(deA.filas.map((f) => f.skuId)).toContain(skuA);

    const todoB = await listarInventarioParaExportar(c.empresaBId);
    expect(todoB.filas.map((f) => f.skuId)).not.toContain(skuA);
    const buscandoB = await listarInventarioParaExportar(c.empresaBId, { busqueda: "INV-A" });
    expect(buscandoB.filas).toHaveLength(0);
  });

  it("listarKardexParaExportar: B nunca trae movimientos de A, ni pasando el skuId o bodegaId de A", async () => {
    const deA = await listarKardexParaExportar(c.empresaAId, { skuId: skuA });
    expect(deA.filas.length).toBeGreaterThan(0);

    expect((await listarKardexParaExportar(c.empresaBId)).filas.filter((f) => f.skuCodigo === "INV-A")).toHaveLength(0);
    expect((await listarKardexParaExportar(c.empresaBId, { skuId: skuA })).filas).toHaveLength(0);
    expect((await listarKardexParaExportar(c.empresaBId, { bodegaId: bodegaA })).filas).toHaveLength(0);
  });

  it("días de stock: las ventas de B nunca suman a A, ni apuntando al SKU de A", async () => {
    await crearVentaHoy(c.empresaAId, skuA, 2);
    await crearVentaHoy(c.empresaBId, skuA, 5);
    const deA = await listarInventarioParaExportar(c.empresaAId, { busqueda: "INV-A" });
    expect(deA.filas.find((f) => f.skuId === skuA)?.vendidas30).toBe(2);
  });

  it("los topes del CSV marcan recortado", async () => {
    await crearSku(c.empresaAId, "INV-A2");
    const inv = await listarInventarioParaExportar(c.empresaAId, { busqueda: "INV-A" }, 1);
    expect(inv.filas).toHaveLength(1);
    expect(inv.recortado).toBe(true);
    expect((await listarInventarioParaExportar(c.empresaAId, { busqueda: "INV-A2" }, 1)).recortado).toBe(false);

    // skuA tiene al menos dos movimientos (la entrada y la recepción).
    const kardex = await listarKardexParaExportar(c.empresaAId, { skuId: skuA }, 1);
    expect(kardex.filas).toHaveLength(1);
    expect(kardex.recortado).toBe(true);
  });

  it("Registro de compras: crea producto y SKU en la compra, B no la ve ni la edita, y el kardex dice OC-N", async () => {
    const compra = {
      fechaCompra: "2026-05-14",
      formaPago: "MATEO AMEX",
      plataforma: "Amazon",
      ordenPlataforma: "114-0000001",
      linkCompra: "https://www.amazon.com/dp/PRUEBA",
      entregaEstimada: "2026-06-04",
    };
    const { id: ordenRegistro, numero } = await registrarCompra(c.empresaAId, c.usuarioAId, {
      producto: { nuevo: { codigo: "fulreg1234", nombre: "Producto del registro" } },
      cantidad: 4,
      costoUnitario: "1000",
      bodegaDestinoId: bodegaA,
      terceroId: null,
      nota: null,
      compra,
    });

    const [fila] = await listarRegistroCompras(c.empresaAId, "FULREG1234");
    expect(fila).toMatchObject({ ordenId: ordenRegistro, skuCodigo: "FULREG1234", producto: "Producto del registro", cantidad: 4, total: "4000.00", ...compra });
    expect(fila.liquidado).toBeNull();
    expect(await listarRegistroCompras(c.empresaAId, "amazon")).toEqual(expect.arrayContaining([expect.objectContaining({ ordenId: ordenRegistro })]));
    // B no ve la compra de A, ni buscando su SKU o su plataforma.
    expect(await listarRegistroCompras(c.empresaBId, "FULREG1234")).toHaveLength(0);
    expect(await listarRegistroCompras(c.empresaBId, "Amazon")).toHaveLength(0);
    // B no puede editar la OC de A.
    await expect(actualizarDatosCompra(c.empresaBId, c.usuarioBId, ordenRegistro, { plataforma: "Temu" })).rejects.toBeInstanceOf(CompraInvalidaError);

    // El mismo SKU dos veces: error claro y sin dejar otra OC.
    await expect(
      registrarCompra(c.empresaAId, c.usuarioAId, {
        producto: { nuevo: { codigo: "FULREG1234", nombre: "Repetido" } },
        cantidad: 1,
        costoUnitario: null,
        bodegaDestinoId: bodegaA,
        terceroId: null,
        nota: null,
        compra: {},
      })
    ).rejects.toBeInstanceOf(SkuCodigoDuplicadoError);
    expect(await listarRegistroCompras(c.empresaAId, "Repetido")).toHaveLength(0);

    // Al recibir, el kardex dice de qué OC son las unidades.
    const [{ id: skuRegistro }] = await dbComoEmpresa(c.empresaAId, (tx) => tx.select({ id: skus.id }).from(skus).where(eq(skus.codigo, "FULREG1234")));
    const recepcionId = randomUUID();
    await registrarRecepcion(c.empresaAId, c.usuarioAId, { recepcionId, ordenCompraId: ordenRegistro, bodegaId: bodegaA, nota: "Factura 55", lineas: [{ skuId: skuRegistro, cantidad: 4 }] });
    const [mov] = await dbComoEmpresa(c.empresaAId, (tx) =>
      tx.select({ nota: kardexMovimientos.nota }).from(kardexMovimientos).where(eq(kardexMovimientos.referenciaId, recepcionId))
    );
    expect(mov.nota).toBe(`OC-${numero} · Factura 55`);
    const [recibida] = await listarRegistroCompras(c.empresaAId, "FULREG1234");
    expect(recibida.estado).toBe("recibida");
    expect(recibida.fechaEntrega).not.toBeNull();

    // La base rechaza un link que no sea http(s), aunque alguien se salte la app.
    await expect(
      dbComoEmpresa(c.empresaAId, (tx) => tx.update(ordenesCompra).set({ linkCompra: "javascript:alert(1)" }).where(eq(ordenesCompra.id, ordenRegistro)))
    ).rejects.toThrow();
  });

  it("corregir cantidad y valor: cantidad solo sin nada recibido, valor solo sin liquidar, y B no toca la OC de A", async () => {
    const { id: oc } = await registrarCompra(c.empresaAId, c.usuarioAId, {
      producto: { nuevo: { codigo: "FULCOR0001", nombre: "Para corregir" } },
      cantidad: 3,
      costoUnitario: "2000",
      bodegaDestinoId: bodegaA,
      terceroId: null,
      nota: null,
      compra: {},
    });
    const linea = async () =>
      (await dbComoEmpresa(c.empresaAId, (tx) => tx.select().from(ordenCompraItems).where(eq(ordenCompraItems.ordenCompraId, oc))))[0];
    const item = await linea();

    // Abierta: se corrigen las dos cosas.
    await actualizarLineasCompra(c.empresaAId, c.usuarioAId, oc, [{ itemId: item.id, cantidad: 5, costoUnitario: "2500" }]);
    expect(await linea()).toMatchObject({ cantidadPedida: 5, costoUnitario: "2500.00" });
    // «2500» y «2500.00» son el mismo valor: no cuenta como cambio.
    await actualizarLineasCompra(c.empresaAId, c.usuarioAId, oc, [{ itemId: item.id, cantidad: 5, costoUnitario: "2500.00" }]);

    // B no corrige la OC de A.
    await expect(actualizarLineasCompra(c.empresaBId, c.usuarioBId, oc, [{ itemId: item.id, cantidad: 9, costoUnitario: null }])).rejects.toBeInstanceOf(CompraInvalidaError);

    // Llegó algo: la cantidad queda fija, el valor todavía se corrige.
    await registrarRecepcion(c.empresaAId, c.usuarioAId, { recepcionId: randomUUID(), ordenCompraId: oc, bodegaId: bodegaA, nota: null, lineas: [{ skuId: item.skuId, cantidad: 1 }] });
    await expect(actualizarLineasCompra(c.empresaAId, c.usuarioAId, oc, [{ itemId: item.id, cantidad: 6, costoUnitario: "2500" }])).rejects.toThrow(/cantidad no se corrige/);
    await actualizarLineasCompra(c.empresaAId, c.usuarioAId, oc, [{ itemId: item.id, cantidad: 5, costoUnitario: "2600" }]);
    expect((await linea()).costoUnitario).toBe("2600.00");

    // Liquidada: el valor queda fijo.
    // (Directo en la base: la regla solo mira fecha_pago; marcarla desde
    // Por pagar pide permisos de finanzas que este contexto no arma.)
    await dbComoEmpresa(c.empresaAId, (tx) => tx.update(ordenesCompra).set({ fechaPago: "2026-11-27", medioPago: "MATEO AMEX" }).where(eq(ordenesCompra.id, oc)));
    await expect(actualizarLineasCompra(c.empresaAId, c.usuarioAId, oc, [{ itemId: item.id, cantidad: 5, costoUnitario: "3000" }])).rejects.toThrow(/liquidada/);
  });

  it("Devoluciones: las de ML por llegar se traen una vez con el SKU de la venta; bueno suma a la bodega, averiado a Averiados; B no ve ni recibe", async () => {
    const skuDev = await crearSku(c.empresaAId, "DEV-A");
    const cuentaMlId = await crearCuentaMlDePrueba(c.empresaAId);
    const orden = `orden-dev-${randomUUID().slice(0, 8)}`;
    await dbComoEmpresa(c.empresaAId, async (tx) => {
      const [pedido] = await tx
        .insert(pedidos)
        .values({ empresaId: c.empresaAId, cuentaMlId, pedidoIdExterno: orden, fecha: new Date(), total: "1000.00", moneda: "COP", estado: "paid" })
        .returning({ id: pedidos.id });
      await tx.insert(pedidoItems).values({ empresaId: c.empresaAId, pedidoId: pedido.id, linea: 1, itemIdExterno: "MCO9", skuCodigo: "DEV-A", skuId: skuDev, cantidad: 2, precioUnitario: "500.00", valorLinea: "1000.00", titulo: "Producto devuelto" });
    });
    const aviso = { reclamoId: "900001", ordenId: orden, fecha: "2026-11-27", estadoEnvio: "En camino", cuentaMlId };
    expect(await guardarDevolucionesMl(c.empresaAId, c.usuarioAId, [aviso, { ...aviso, reclamoId: "900002", ordenId: "orden-que-no-existe" }])).toMatchObject({ nuevas: 2, sinVenta: 1 });
    // Traer otra vez no duplica; solo refresca el estado del envío.
    expect(await guardarDevolucionesMl(c.empresaAId, c.usuarioAId, [{ ...aviso, estadoEnvio: "Entregado" }])).toMatchObject({ nuevas: 0, actualizadas: 1 });

    const filas = await listarDevoluciones(c.empresaAId, orden);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ skuCodigo: "DEV-A", producto: "Producto devuelto", cantidad: 2, estado: "por_llegar", estadoEnvioMl: "Entregado" });
    // B no la ve ni la recibe.
    expect(await listarDevoluciones(c.empresaBId, orden)).toHaveLength(0);
    await expect(recibirDevolucion(c.empresaBId, c.usuarioBId, filas[0].id, { condicion: "bueno", bodegaId: bodegaA, skuId: null, cantidad: 2 })).rejects.toBeInstanceOf(DevolucionInvalidaError);

    // Bueno: suma a la bodega elegida, con su movimiento «devolucion».
    const stock = async (bodegaId: string) =>
      (await dbComoEmpresa(c.empresaAId, (tx) => tx.select({ d: stockBodega.disponible }).from(stockBodega).where(sql`${stockBodega.skuId} = ${skuDev} and ${stockBodega.bodegaId} = ${bodegaId}`)))[0]?.d ?? 0;
    await recibirDevolucion(c.empresaAId, c.usuarioAId, filas[0].id, { condicion: "bueno", bodegaId: bodegaA, skuId: null, cantidad: 2 });
    expect(await stock(bodegaA)).toBe(2);
    await expect(recibirDevolucion(c.empresaAId, c.usuarioAId, filas[0].id, { condicion: "bueno", bodegaId: bodegaA, skuId: null, cantidad: 2 })).rejects.toThrow(/ya se recibió/);

    // Averiado (la de la venta que no estaba: se elige el SKU al recibir) → bodega Averiados, que no suma a lo publicado.
    const [sinSku] = await listarDevoluciones(c.empresaAId, "orden-que-no-existe");
    expect(sinSku.skuId).toBeNull();
    await expect(recibirDevolucion(c.empresaAId, c.usuarioAId, sinSku.id, { condicion: "averiado", bodegaId: null, skuId: null, cantidad: 1 })).rejects.toThrow(/elige cuál volvió/);
    await recibirDevolucion(c.empresaAId, c.usuarioAId, sinSku.id, { condicion: "averiado", bodegaId: null, skuId: skuDev, cantidad: 1 });
    const [averiados] = await dbComoEmpresa(c.empresaAId, (tx) => tx.select().from(bodegas).where(eq(bodegas.nombre, NOMBRE_BODEGA_AVERIADOS)));
    expect(averiados.sumaAlPublicado).toBe(false);
    expect(await stock(averiados.id)).toBe(1);
    const [mov] = await dbComoEmpresa(c.empresaAId, (tx) => tx.select({ origen: kardexMovimientos.origen }).from(kardexMovimientos).where(eq(kardexMovimientos.referenciaId, sinSku.id)));
    expect(mov.origen).toBe("devolucion");

    // A mano + anular solo lo que sigue por llegar.
    const { id: manual } = await registrarDevolucion(c.empresaAId, c.usuarioAId, { fecha: "2026-11-27", tienda: { otra: "Tienda física" }, skuId: skuDev, cantidad: 1, pedidoIdExterno: null, nota: null });
    await anularDevolucion(c.empresaAId, c.usuarioAId, manual);
    await expect(anularDevolucion(c.empresaAId, c.usuarioAId, filas[0].id)).rejects.toBeInstanceOf(DevolucionInvalidaError);
    // Recibida a medias no existe: la base exige condición, bodega, SKU y fecha juntas.
    await expect(
      dbComoEmpresa(c.empresaAId, (tx) => tx.update(devolucionesInventario).set({ estado: "recibida" }).where(eq(devolucionesInventario.id, manual)))
    ).rejects.toThrow();
  });
});
