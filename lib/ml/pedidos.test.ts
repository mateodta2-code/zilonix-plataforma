import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas, pedidos } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { listarPedidos, obtenerPedidoConEventos, PASOS_PEDIDO, registrarEventoPedido } from "./pedidos";

// Tarea 2.7 — prueba real contra Postgres: los eventos de un pedido
// respetan el aislamiento de siempre, nunca se duplica un paso, y la
// línea de tiempo siempre sale en el orden fijo de los 8 pasos.
describe("pedidos y línea de tiempo (tarea 2.7)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  let pedidoId: string;

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (prueba 2.7)", nit: `TEST-PED-A-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (prueba 2.7)", nit: `TEST-PED-B-${empresaBId.slice(0, 8)}` })
    );
    const [cuenta] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaAId,
          cuentaIdExterna: `ml-user-ped-${randomUUID()}`,
          nickname: "VENDEDOR_PED",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const [pedido] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values({
          empresaId: empresaAId,
          cuentaMlId: cuenta.id,
          pedidoIdExterno: `ORDEN-${randomUUID()}`,
          fecha: new Date("2026-09-01T10:00:00.000Z"),
          total: "50000",
          moneda: "COP",
          estado: "paid",
        })
        .returning({ id: pedidos.id })
    );
    pedidoId = pedido.id;
  });

  it("registra un evento y aparece en la línea de tiempo con fecha y quién", async () => {
    await registrarEventoPedido(empresaAId, pedidoId, "venta", new Date("2026-09-01T10:00:00.000Z"));

    const resultado = await obtenerPedidoConEventos(empresaAId, pedidoId);
    expect(resultado?.eventos).toHaveLength(1);
    expect(resultado?.eventos[0]).toMatchObject({ paso: "venta", actorTipo: "sistema" });
  });

  it("registrar el mismo paso dos veces no lo duplica", async () => {
    await registrarEventoPedido(empresaAId, pedidoId, "pago", new Date("2026-09-01T11:00:00.000Z"));
    await registrarEventoPedido(empresaAId, pedidoId, "pago", new Date("2026-09-01T12:00:00.000Z")); // reintento, misma clave

    const resultado = await obtenerPedidoConEventos(empresaAId, pedidoId);
    expect(resultado?.eventos.filter((e) => e.paso === "pago")).toHaveLength(1);
  });

  it("los 8 pasos del plan maestro están en el orden fijo correcto", () => {
    expect(PASOS_PEDIDO).toEqual(["venta", "pago", "factura", "empaque", "despacho", "entrega", "novedades", "dinero_conciliado"]);
  });

  it("empresa B nunca ve los pedidos ni los eventos de empresa A", async () => {
    const lista = await listarPedidos(empresaBId);
    expect(lista).toHaveLength(0);

    const resultado = await obtenerPedidoConEventos(empresaBId, pedidoId);
    expect(resultado).toBeNull(); // RLS: el pedido de A ni existe bajo el contexto de B
  });
});
