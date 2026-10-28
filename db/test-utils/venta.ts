import { randomUUID } from "crypto";
import { dbComoEmpresa } from "../empresa-context";
import { cuentasMl, pedidoItems, pedidos, pedidosFinanzas } from "../schema";
import { cifrarToken } from "../../lib/cifrado";

// Issue #129 — arma lo mínimo para probar las tablas de ventas: una
// cuenta de ML, un pedido y su cabecera financiera, siempre con
// app_user (dbComoEmpresa), igual que la app.
export type VentaDePrueba = { cuentaMlId: string; pedidoId: string };

export async function crearCuentaMlDePrueba(empresaId: string): Promise<string> {
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: `ml-user-${randomUUID()}`,
        nickname: "VENDEDOR_PRUEBA",
        accessTokenCifrado: cifrarToken("access-de-prueba"),
        refreshTokenCifrado: cifrarToken("refresh-de-prueba"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
      .returning({ id: cuentasMl.id })
  );
  return cuenta.id;
}

export async function crearPedidoDePrueba(empresaId: string, cuentaMlId: string): Promise<string> {
  const [pedido] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(pedidos)
      .values({
        empresaId,
        cuentaMlId,
        pedidoIdExterno: `orden-${randomUUID()}`,
        fecha: new Date("2026-10-20T15:00:00Z"),
        total: "100000.00",
        moneda: "COP",
        estado: "paid",
      })
      .returning({ id: pedidos.id })
  );
  return pedido.id;
}

// Pedido + cabecera (y, si se pide, líneas 1..n). La cabecera va
// primero: las líneas y las correcciones cuelgan de ella.
export async function crearVentaDePrueba(
  empresaId: string,
  opciones: { cuentaMlId?: string; lineas?: number; cabecera?: Partial<typeof pedidosFinanzas.$inferInsert> } = {}
): Promise<VentaDePrueba> {
  const cuentaMlId = opciones.cuentaMlId ?? (await crearCuentaMlDePrueba(empresaId));
  const pedidoId = await crearPedidoDePrueba(empresaId, cuentaMlId);
  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.insert(pedidosFinanzas).values({ empresaId, pedidoId, cuentaMlId, valorVenta: "100000.00", ...opciones.cabecera });
    for (let linea = 1; linea <= (opciones.lineas ?? 0); linea++) {
      await tx.insert(pedidoItems).values(lineaDePrueba(empresaId, pedidoId, linea));
    }
  });
  return { cuentaMlId, pedidoId };
}

export function lineaDePrueba(empresaId: string, pedidoId: string, linea: number): typeof pedidoItems.$inferInsert {
  return {
    empresaId,
    pedidoId,
    linea,
    itemIdExterno: `MCO${1000 + linea}`,
    skuCodigo: `REF-${linea}`,
    cantidad: 1,
    precioUnitario: "50000.00",
    valorLinea: "50000.00",
    titulo: `Producto ${linea}`,
  };
}
