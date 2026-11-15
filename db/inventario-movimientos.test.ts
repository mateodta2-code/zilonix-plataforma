import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { alertasUltimaUnidad, kardexMovimientos, kitComponentes, pedidoItems, pedidosFinanzas, pedidos, skus, stockBodega, syncStockMl } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearVentaDePrueba, lineaDePrueba } from "./test-utils/venta";
import { StockInsuficienteError } from "../lib/inventario/calculos";
import { crearBodega } from "../lib/inventario/bodegas";
import { guardarConfiguracionInventario } from "../lib/inventario/configuracion";
import { aplicarMovimientos, SkuNoValidoParaStockError } from "../lib/inventario/movimientos";
import { sincronizarInventarioPedido } from "../lib/inventario/pedidos-ml";
import { disponiblePublicado } from "../lib/inventario/stock";

// Issue #280 — la puerta única (aplicarMovimientos) y el ciclo de un
// pedido de ML, contra Postgres real con app_user.

async function crearSku(empresaId: string, codigo: string, esKit = false): Promise<string> {
  const [f] = await dbComoEmpresa(empresaId, (tx) => tx.insert(skus).values({ empresaId, codigo, nombre: codigo, esKit }).returning({ id: skus.id }));
  return f.id;
}

async function saldo(empresaId: string, bodegaId: string, skuId: string) {
  const [f] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ disponible: stockBodega.disponible, reservado: stockBodega.reservado })
      .from(stockBodega)
      .where(and(eq(stockBodega.bodegaId, bodegaId), eq(stockBodega.skuId, skuId)))
  );
  return f ?? { disponible: 0, reservado: 0 };
}

function entrada(usuarioId: string, bodegaId: string, skuId: string, cantidad: number) {
  return {
    claveIdempotencia: `prueba:${randomUUID()}`,
    origen: "manual" as const,
    actor: { tipo: "persona" as const, usuarioId },
    lineas: [{ tipo: "entrada" as const, bodegaId, skuId, cantidad }],
  };
}

describe("aplicarMovimientos (issue #280)", () => {
  let c: ContextoDosEmpresas;
  let principal: string;
  let secundaria: string;
  let sku: string;

  beforeAll(async () => {
    c = await crearDosEmpresas();
    ({ id: principal } = await crearBodega(c.empresaAId, c.usuarioAId, { nombre: "Principal", tipo: "propia" }));
    ({ id: secundaria } = await crearBodega(c.empresaAId, c.usuarioAId, { nombre: "Secundaria", tipo: "propia" }));
    sku = await crearSku(c.empresaAId, "MOV-1");
  });

  it("entrada suma, deja su fila en el kardex con el saldo, y marca el SKU para ML", async () => {
    await aplicarMovimientos(c.empresaAId, entrada(c.usuarioAId, principal, sku, 5));
    expect(await saldo(c.empresaAId, principal, sku)).toEqual({ disponible: 5, reservado: 0 });
    const kardex = await dbComoEmpresa(c.empresaAId, (tx) => tx.select().from(kardexMovimientos).where(eq(kardexMovimientos.skuId, sku)));
    expect(kardex).toHaveLength(1);
    expect(kardex[0]).toMatchObject({ tipo: "entrada", deltaDisponible: 5, saldoDisponible: 5, actorTipo: "persona", usuarioId: c.usuarioAId });
    const [marca] = await dbComoEmpresa(c.empresaAId, (tx) => tx.select().from(syncStockMl).where(eq(syncStockMl.skuId, sku)));
    expect(marca.pendienteDesdeTs).not.toBeNull();
  });

  it("la misma clave dos veces mueve una sola vez", async () => {
    const op = entrada(c.usuarioAId, principal, sku, 2);
    expect((await aplicarMovimientos(c.empresaAId, op)).aplicado).toBe(true);
    expect(await aplicarMovimientos(c.empresaAId, op)).toEqual({ aplicado: false, motivo: "ya_aplicado" });
    expect((await saldo(c.empresaAId, principal, sku)).disponible).toBe(7);
  });

  it("si una línea no alcanza, no se aplica ninguna", async () => {
    await expect(
      aplicarMovimientos(c.empresaAId, {
        claveIdempotencia: `prueba:${randomUUID()}`,
        origen: "manual",
        actor: { tipo: "persona", usuarioId: c.usuarioAId },
        lineas: [
          { tipo: "entrada", bodegaId: secundaria, skuId: sku, cantidad: 1 },
          { tipo: "salida", bodegaId: principal, skuId: sku, cantidad: 100 },
        ],
      })
    ).rejects.toBeInstanceOf(StockInsuficienteError);
    expect((await saldo(c.empresaAId, principal, sku)).disponible).toBe(7);
    expect((await saldo(c.empresaAId, secundaria, sku)).disponible).toBe(0);
  });

  it("traslado instantáneo: dos filas del mismo grupo, el total no cambia", async () => {
    const r = await aplicarMovimientos(c.empresaAId, {
      claveIdempotencia: `prueba:${randomUUID()}`,
      origen: "traslado",
      actor: { tipo: "persona", usuarioId: c.usuarioAId },
      lineas: [{ tipo: "traslado", bodegaId: principal, bodegaDestinoId: secundaria, skuId: sku, cantidad: 3 }],
    });
    expect(r.aplicado).toBe(true);
    expect((await saldo(c.empresaAId, principal, sku)).disponible).toBe(4);
    expect((await saldo(c.empresaAId, secundaria, sku)).disponible).toBe(3);
    const grupo = r.aplicado
      ? await dbComoEmpresa(c.empresaAId, (tx) => tx.select().from(kardexMovimientos).where(eq(kardexMovimientos.grupoId, r.grupoId)))
      : [];
    expect(grupo.map((g) => g.deltaDisponible).sort()).toEqual([-3, 3]);
    expect((await disponiblePublicado(c.empresaAId, [sku])).get(sku)).toBe(7);
  });

  it("un kit no tiene stock propio, pero publica cuántos se arman", async () => {
    const kit = await crearSku(c.empresaAId, "KIT-1", true);
    await dbComoEmpresa(c.empresaAId, (tx) => tx.insert(kitComponentes).values({ empresaId: c.empresaAId, skuKitId: kit, skuComponenteId: sku, cantidad: 2 }));
    await expect(aplicarMovimientos(c.empresaAId, entrada(c.usuarioAId, principal, kit, 1))).rejects.toBeInstanceOf(SkuNoValidoParaStockError);
    expect((await disponiblePublicado(c.empresaAId, [kit])).get(kit)).toBe(3); // 7 componentes / 2
  });

  it("bajar a la última unidad deja una sola alerta pendiente", async () => {
    const solo = await crearSku(c.empresaAId, "ULT-1");
    await aplicarMovimientos(c.empresaAId, entrada(c.usuarioAId, principal, solo, 3));
    const salida = (n: number) => ({
      claveIdempotencia: `prueba:${randomUUID()}`,
      origen: "manual" as const,
      actor: { tipo: "persona" as const, usuarioId: c.usuarioAId },
      lineas: [{ tipo: "salida" as const, bodegaId: principal, skuId: solo, cantidad: n }],
    });
    await aplicarMovimientos(c.empresaAId, salida(2)); // 3 → 1
    await aplicarMovimientos(c.empresaAId, salida(1)); // 1 → 0, ya hay una pendiente
    const alertas = await dbComoEmpresa(c.empresaAId, (tx) => tx.select().from(alertasUltimaUnidad).where(eq(alertasUltimaUnidad.skuId, solo)));
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ estado: "pendiente", disponibleAlCrear: 1, regla: "preguntar" });
  });
});

describe("pedidos de ML → reserva / confirmación / liberación (issue #280)", () => {
  let c: ContextoDosEmpresas;
  let principal: string;
  let sku: string;

  async function pedidoCon(cantidad: number, cabecera: Partial<typeof pedidosFinanzas.$inferInsert> = {}) {
    const { pedidoId } = await crearVentaDePrueba(c.empresaAId, { cabecera });
    await dbComoEmpresa(c.empresaAId, async (tx) => {
      // El pedido de prueba es del 2026-10-20: se mueve a "ahora" para
      // que caiga después del inicio de la reserva.
      await tx.update(pedidos).set({ fecha: new Date() }).where(eq(pedidos.id, pedidoId));
      await tx.insert(pedidoItems).values({ ...lineaDePrueba(c.empresaAId, pedidoId, 1), skuId: sku, cantidad });
    });
    return pedidoId;
  }

  beforeAll(async () => {
    c = await crearDosEmpresas();
    ({ id: principal } = await crearBodega(c.empresaAId, c.usuarioAId, { nombre: "Principal", tipo: "propia" }));
    sku = await crearSku(c.empresaAId, "PED-1");
    await aplicarMovimientos(c.empresaAId, entrada(c.usuarioAId, principal, sku, 3));
  });

  it("con la reserva apagada, un pedido no toca el stock", async () => {
    const pedidoId = await pedidoCon(1);
    expect(await sincronizarInventarioPedido(c.empresaAId, pedidoId)).toEqual({ resultado: "omitido", motivo: "reserva_apagada" });
    expect((await saldo(c.empresaAId, principal, sku)).disponible).toBe(3);
  });

  it("pagado reserva una vez; despachado confirma; repetir no mueve nada", async () => {
    await guardarConfiguracionInventario(c.empresaAId, c.usuarioAId, {
      reglaUltimaUnidad: "preguntar",
      umbralUltimaUnidad: 0,
      bufferMl: 0,
      syncMlActivo: false,
      reservarPedidos: true,
    });
    // Desde que se prende, "ahora" ya pasó: este pedido nuevo cae adentro.
    await new Promise((r) => setTimeout(r, 5));
    const pedidoId = await pedidoCon(2);
    expect(await sincronizarInventarioPedido(c.empresaAId, pedidoId)).toEqual({ resultado: "aplicado", accion: "reservar" });
    expect(await sincronizarInventarioPedido(c.empresaAId, pedidoId)).toEqual({ resultado: "sin_cambios" });
    expect(await saldo(c.empresaAId, principal, sku)).toEqual({ disponible: 1, reservado: 2 });

    await dbComoEmpresa(c.empresaAId, (tx) => tx.update(pedidosFinanzas).set({ fechaDespacho: new Date() }).where(eq(pedidosFinanzas.pedidoId, pedidoId)));
    expect(await sincronizarInventarioPedido(c.empresaAId, pedidoId)).toEqual({ resultado: "aplicado", accion: "confirmar" });
    expect(await sincronizarInventarioPedido(c.empresaAId, pedidoId)).toEqual({ resultado: "sin_cambios" });
    expect(await saldo(c.empresaAId, principal, sku)).toEqual({ disponible: 1, reservado: 0 });
  });

  it("cancelado libera lo reservado", async () => {
    const pedidoId = await pedidoCon(1);
    await sincronizarInventarioPedido(c.empresaAId, pedidoId);
    expect(await saldo(c.empresaAId, principal, sku)).toEqual({ disponible: 0, reservado: 1 });
    await dbComoEmpresa(c.empresaAId, (tx) => tx.update(pedidosFinanzas).set({ cancelada: true }).where(eq(pedidosFinanzas.pedidoId, pedidoId)));
    expect(await sincronizarInventarioPedido(c.empresaAId, pedidoId)).toEqual({ resultado: "aplicado", accion: "liberar" });
    expect(await saldo(c.empresaAId, principal, sku)).toEqual({ disponible: 1, reservado: 0 });
  });

  it("sin stock para el pedido entero: no se reserva nada (rechazo total)", async () => {
    const pedidoId = await pedidoCon(5);
    expect(await sincronizarInventarioPedido(c.empresaAId, pedidoId)).toEqual({ resultado: "rechazado", motivo: "sin_stock" });
    expect(await saldo(c.empresaAId, principal, sku)).toEqual({ disponible: 1, reservado: 0 });
  });

  it("un pedido Full no toca el stock propio", async () => {
    const pedidoId = await pedidoCon(1, { formaEntrega: "full_ml" });
    expect(await sincronizarInventarioPedido(c.empresaAId, pedidoId)).toEqual({ resultado: "omitido", motivo: "full" });
  });

  it("la empresa B no puede mover el stock de A con un pedido de A", async () => {
    const pedidoId = await pedidoCon(1);
    await expect(sincronizarInventarioPedido(c.empresaBId, pedidoId)).resolves.toEqual({ resultado: "omitido", motivo: "reserva_apagada" });
    await guardarConfiguracionInventario(c.empresaBId, c.usuarioBId, {
      reglaUltimaUnidad: "preguntar",
      umbralUltimaUnidad: 0,
      bufferMl: 0,
      syncMlActivo: false,
      reservarPedidos: true,
    });
    await expect(sincronizarInventarioPedido(c.empresaBId, pedidoId)).rejects.toThrow(/no existe/);
    expect(await saldo(c.empresaAId, principal, sku)).toEqual({ disponible: 1, reservado: 0 });
  });
});
