import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { pedidosFinanzas } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearCuentaMlDePrueba, crearPedidoDePrueba, crearVentaDePrueba } from "./test-utils/venta";

// Issue #129 (Z-FIN-07) — cabecera financiera de la venta contra
// Postgres real. Sin afirmarAislamiento(): app_user no tiene DELETE en
// esta tabla, así que el DELETE da error de permiso, no "0 filas".
describe("pedidos_finanzas (RLS, issue #129)", () => {
  let contexto: ContextoDosEmpresas;
  let pedidoAId: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    ({ pedidoId: pedidoAId } = await crearVentaDePrueba(contexto.empresaAId));
  });

  it("empresa B no ve ni edita la cabecera de A; A sí la edita", async () => {
    const veB = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(pedidosFinanzas).where(eq(pedidosFinanzas.pedidoId, pedidoAId)));
    expect(veB).toHaveLength(0);

    const editadasPorB = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.update(pedidosFinanzas).set({ comisionMl: "1.00" }).where(eq(pedidosFinanzas.pedidoId, pedidoAId)).returning({ id: pedidosFinanzas.id })
    );
    expect(editadasPorB).toHaveLength(0);

    const editadasPorA = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .update(pedidosFinanzas)
        .set({ comisionMl: "12000.50" })
        .where(eq(pedidosFinanzas.pedidoId, pedidoAId))
        .returning({ comisionMl: pedidosFinanzas.comisionMl })
    );
    expect(editadasPorA).toEqual([{ comisionMl: "12000.50" }]);
  });

  it("con app_user, DELETE falla, aun para la empresa dueña", async () => {
    for (const empresaId of [contexto.empresaAId, contexto.empresaBId]) {
      await expect(dbComoEmpresa(empresaId, (tx) => tx.delete(pedidosFinanzas).where(eq(pedidosFinanzas.pedidoId, pedidoAId)))).rejects.toThrow(
        /permission denied/
      );
    }
  });

  it("B no puede crear una cabecera suya sobre el pedido de A (clave compuesta)", async () => {
    const cuentaBId = await crearCuentaMlDePrueba(contexto.empresaBId);
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(pedidosFinanzas).values({ empresaId: contexto.empresaBId, pedidoId: pedidoAId, cuentaMlId: cuentaBId, valorVenta: "1.00" })
      )
    ).rejects.toThrow();
  });

  it("una sola cabecera por pedido", async () => {
    await expect(crearCabecera(contexto.empresaAId, pedidoAId)).rejects.toThrow();
  });

  it("reembolsos vale 0.00 por defecto, no acepta negativos, y valor_venta no le resta el reembolso", async () => {
    const [fila] = await leer(contexto.empresaAId, pedidoAId);
    expect(fila.reembolsos).toBe("0.00");

    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.update(pedidosFinanzas).set({ reembolsos: "-1.00" }).where(eq(pedidosFinanzas.pedidoId, pedidoAId)))
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.update(pedidosFinanzas).set({ valorVenta: "-1.00" }).where(eq(pedidosFinanzas.pedidoId, pedidoAId)))
    ).rejects.toThrow();

    // Devolución parcial: se guardan por separado.
    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.update(pedidosFinanzas).set({ valorVenta: "100000.00", reembolsos: "30000.00" }).where(eq(pedidosFinanzas.pedidoId, pedidoAId))
    );
    const [conDevolucion] = await leer(contexto.empresaAId, pedidoAId);
    expect(conDevolucion.valorVenta).toBe("100000.00");
    expect(conDevolucion.reembolsos).toBe("30000.00");
  });

  it("fechas de despacho y entrega, envío, pack, empaque y envío congelados aceptan nulo; 0.00 se distingue de nulo", async () => {
    const { pedidoId } = await crearVentaDePrueba(contexto.empresaAId, { cabecera: { empaqueCongelado: "0.00", envioAgenciaCongelado: "0" } });
    const [conCeros] = await leer(contexto.empresaAId, pedidoId);
    expect(conCeros.empaqueCongelado).toBe("0.00");
    expect(conCeros.envioAgenciaCongelado).toBe("0.00");

    const [vacia] = await leer(contexto.empresaAId, pedidoAId);
    expect(vacia).toMatchObject({
      fechaDespacho: null,
      fechaEntrega: null,
      shipmentIdExterno: null,
      packIdExterno: null,
      empaqueCongelado: null,
      envioAgenciaCongelado: null,
      congeladoTs: null,
      formaEntrega: "desconocida",
      estadoCosteo: "sin_costo",
      cancelada: false,
    });
  });

  it("dos órdenes del mismo carrito comparten shipment_id_externo y pack_id_externo", async () => {
    const cuentaMlId = await crearCuentaMlDePrueba(contexto.empresaAId);
    const paquete = { shipmentIdExterno: "44000111222", packIdExterno: "2000009999" };
    const uno = await crearVentaDePrueba(contexto.empresaAId, { cuentaMlId, cabecera: paquete });
    const dos = await crearVentaDePrueba(contexto.empresaAId, { cuentaMlId, cabecera: paquete });

    const filas = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.select().from(pedidosFinanzas).where(eq(pedidosFinanzas.shipmentIdExterno, paquete.shipmentIdExterno))
    );
    expect(filas.map((f) => f.pedidoId).sort()).toEqual([uno.pedidoId, dos.pedidoId].sort());
  });

  it("forma_entrega y estado_costeo solo aceptan su lista", async () => {
    const cuentaMlId = await crearCuentaMlDePrueba(contexto.empresaAId);
    const pedidoId = await crearPedidoDePrueba(contexto.empresaAId, cuentaMlId);
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(pedidosFinanzas).values({
          empresaId: contexto.empresaAId,
          pedidoId,
          cuentaMlId,
          valorVenta: "1.00",
          formaEntrega: "fulfillment" as "full_ml",
        })
      )
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(pedidosFinanzas).values({
          empresaId: contexto.empresaAId,
          pedidoId,
          cuentaMlId,
          valorVenta: "1.00",
          estadoCosteo: "otro" as "completo",
        })
      )
    ).rejects.toThrow();
  });
});

function leer(empresaId: string, pedidoId: string) {
  return dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidosFinanzas).where(eq(pedidosFinanzas.pedidoId, pedidoId)));
}

async function crearCabecera(empresaId: string, pedidoId: string) {
  const [cabecera] = await leer(empresaId, pedidoId);
  return dbComoEmpresa(empresaId, (tx) =>
    tx.insert(pedidosFinanzas).values({ empresaId, pedidoId, cuentaMlId: cabecera.cuentaMlId, valorVenta: "1.00" })
  );
}
