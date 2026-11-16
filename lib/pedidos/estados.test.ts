import { describe, expect, it } from "vitest";
import { crudosDe, ESTADOS_FALABELLA, estadoPedidoFalabella, estadoPedidoMl, parsearEstadoUnificado } from "./estados";

describe("estados unificados de Pedidos (#422)", () => {
  it("ML: el envío manda sobre la orden pagada", () => {
    expect(estadoPedidoMl("paid", null).etiqueta).toBe("Pendiente");
    expect(estadoPedidoMl("paid", "handling").etiqueta).toBe("Pendiente");
    expect(estadoPedidoMl("paid", "ready_to_ship").etiqueta).toBe("Listo para enviar");
    expect(estadoPedidoMl("paid", "shipped").etiqueta).toBe("Enviado");
    expect(estadoPedidoMl("paid", "delivered")).toEqual({ valor: "entregado", etiqueta: "Entregado", color: "exito" });
    expect(estadoPedidoMl("paid", "cancelled").etiqueta).toBe("Cancelado");
  });

  it("ML: una orden cancelada es Cancelado aunque el envío diga otra cosa, y sin importar mayúsculas", () => {
    expect(estadoPedidoMl("CANCELLED", "ready_to_ship").valor).toBe("cancelado");
    expect(estadoPedidoMl("PAID", null).valor).toBe("pendiente");
  });

  it("Falabella: los cinco estados, con canceled de una sola l", () => {
    expect(estadoPedidoFalabella("pending").etiqueta).toBe("Pendiente");
    expect(estadoPedidoFalabella("ready_to_ship").etiqueta).toBe("Listo para enviar");
    expect(estadoPedidoFalabella("shipped").etiqueta).toBe("Enviado");
    expect(estadoPedidoFalabella("delivered").etiqueta).toBe("Entregado");
    expect(estadoPedidoFalabella("canceled").etiqueta).toBe("Cancelado");
  });

  it("un estado desconocido se muestra tal cual, en gris, sin inventar", () => {
    expect(estadoPedidoFalabella("returned")).toEqual({ valor: null, etiqueta: "returned", color: "neutro" });
    expect(estadoPedidoMl("payment_required", null)).toEqual({ valor: null, etiqueta: "payment_required", color: "neutro" });
    expect(estadoPedidoMl("paid", "not_delivered")).toEqual({ valor: null, etiqueta: "not_delivered", color: "neutro" });
  });

  it("el filtro de estado es lista blanca y conoce sus valores crudos", () => {
    expect(parsearEstadoUnificado("enviado")).toBe("enviado");
    expect(parsearEstadoUnificado("shipped")).toBeNull();
    expect(parsearEstadoUnificado("'; drop table pedidos;--")).toBeNull();
    expect(crudosDe(ESTADOS_FALABELLA, "cancelado").sort()).toEqual(["canceled", "cancelled"]);
  });
});
