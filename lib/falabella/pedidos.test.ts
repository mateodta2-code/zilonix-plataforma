import { beforeEach, describe, expect, it, vi } from "vitest";

// Prueba unitaria del armado de filas (montos y forma de la respuesta),
// no de aislamiento: la base se reemplaza por un tx falso que solo
// registra lo que se habría guardado. El aislamiento por RLS de
// pedidos_falabella se prueba aparte contra Postgres real.
const llamarFalabella = vi.fn();
const valoresGuardados: Record<string, unknown>[] = [];
const dbComoEmpresa = vi.fn(async (_empresaId: string, fn: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    insert: () => ({
      values: (valores: Record<string, unknown>) => {
        valoresGuardados.push(valores);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  };
  return fn(tx);
});

vi.mock("@/lib/falabella/cliente", () => ({ llamarFalabella: (...args: unknown[]) => llamarFalabella(...args) }));
vi.mock("@/lib/falabella/cuentas", () => ({
  obtenerCredenciales: async () => ({ userId: "vendedor@ejemplo.com", apiKey: "clave", sellerId: "S1" }),
}));
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: (...args: Parameters<typeof dbComoEmpresa>) => dbComoEmpresa(...args) }));

const { importarPedidos } = await import("./pedidos");
const { MontoFalabellaInvalidoError } = await import("./montos");

function respuestas(orden: Record<string, unknown>, item: Record<string, unknown>) {
  llamarFalabella.mockImplementation(async ({ action }: { action: string }) => {
    // Una sola orden llega como OBJETO, no como arreglo (así responde
    // Falabella cuando hay un único resultado).
    if (action === "GetOrders") return { TotalCount: "1", Orders: { Order: orden } };
    if (action === "GetOrderItems") return { OrderItems: { OrderItem: item } };
    throw new Error(`acción inesperada ${action}`);
  });
}

const ordenBase = {
  OrderId: "777001",
  CreatedAt: "2026-11-15 10:00:00",
  Price: "78,000.00",
  GrandTotal: "78,000.00",
  Statuses: { Status: "pending" },
};
const itemBase = {
  OrderItemId: "1",
  Sku: "SKU-1",
  Name: "Producto",
  ItemPrice: "78,000.00",
  PaidPrice: "78,000.00",
  Status: "pending",
  Currency: "COP",
};

describe("importarPedidos", () => {
  beforeEach(() => {
    valoresGuardados.length = 0;
    llamarFalabella.mockReset();
    dbComoEmpresa.mockClear();
  });

  it("normaliza Price/GrandTotal/ItemPrice/PaidPrice con coma de miles y acepta una orden como objeto", async () => {
    respuestas(ordenBase, itemBase);
    const resultado = await importarPedidos("empresa-1", "cuenta-1", new Date("2026-09-16T00:00:00Z"));

    expect(resultado).toEqual({ importados: 1, truncado: false });
    expect(valoresGuardados).toHaveLength(1);
    const fila = valoresGuardados[0] as { pedidoIdExterno: string; total: string; estado: string; items: Record<string, unknown>[] };
    expect(fila.pedidoIdExterno).toBe("777001");
    expect(fila.total).toBe("78000.00");
    expect(fila.estado).toBe("pending");
    expect(fila.items).toHaveLength(1);
    expect(fila.items[0].ItemPrice).toBe("78000.00");
    expect(fila.items[0].PaidPrice).toBe("78000.00");
  });

  it("sin GrandTotal usa Price, también normalizado", async () => {
    respuestas({ ...ordenBase, GrandTotal: undefined, Price: "1,234,567.89" }, itemBase);
    await importarPedidos("empresa-1", "cuenta-1", new Date());
    expect((valoresGuardados[0] as { total: string }).total).toBe("1234567.89");
  });

  it("un monto con formato desconocido falla con campo y OrderId, sin abrir la transacción", async () => {
    respuestas(ordenBase, { ...itemBase, PaidPrice: "78.000,00" });
    const error = await importarPedidos("empresa-1", "cuenta-1", new Date()).catch((e) => e);

    expect(error).toBeInstanceOf(MontoFalabellaInvalidoError);
    expect(error.campo).toBe("PaidPrice");
    expect(error.orderId).toBe("777001");
    expect(dbComoEmpresa).not.toHaveBeenCalled();
  });
});
