import { describe, expect, it } from "vitest";
import { estadoVisiblePedido } from "./estado-visible-pedido";

// Pura, sin base: el mapa de estados de /panel/pedidos (#166).
describe("estadoVisiblePedido", () => {
  it("pedido cancelled → Cancelada, peligro", () => {
    expect(estadoVisiblePedido("cancelled", null)).toEqual({ etiqueta: "Cancelada", color: "peligro" });
  });

  it("pedido invalid → Inválida, peligro", () => {
    expect(estadoVisiblePedido("invalid", null)).toEqual({ etiqueta: "Inválida", color: "peligro" });
  });

  it("envío not_delivered → No entregada, peligro", () => {
    expect(estadoVisiblePedido("paid", "not_delivered")).toEqual({ etiqueta: "No entregada", color: "peligro" });
  });

  it("envío delivered → Entregada, exito", () => {
    expect(estadoVisiblePedido("paid", "delivered")).toEqual({ etiqueta: "Entregada", color: "exito" });
  });

  it("envío shipped → Enviada, neutro", () => {
    expect(estadoVisiblePedido("paid", "shipped")).toEqual({ etiqueta: "Enviada", color: "neutro" });
  });

  it("pedido paid con el envío sin salir, sin envío o con envío cancelado → Pagada, aviso", () => {
    for (const envio of [null, "pending", "handling", "ready_to_ship", "cancelled"]) {
      expect(estadoVisiblePedido("paid", envio)).toEqual({ etiqueta: "Pagada", color: "aviso" });
    }
  });

  it("payment_required, payment_in_process y confirmed → en español, neutro", () => {
    expect(estadoVisiblePedido("payment_required", null)).toEqual({ etiqueta: "Pago pendiente", color: "neutro" });
    expect(estadoVisiblePedido("payment_in_process", null)).toEqual({ etiqueta: "Pago en proceso", color: "neutro" });
    expect(estadoVisiblePedido("confirmed", "pending")).toEqual({ etiqueta: "Confirmada", color: "neutro" });
  });

  it("la cancelación del pedido gana sobre el envío", () => {
    expect(estadoVisiblePedido("cancelled", "delivered")).toEqual({ etiqueta: "Cancelada", color: "peligro" });
    expect(estadoVisiblePedido("invalid", "shipped")).toEqual({ etiqueta: "Inválida", color: "peligro" });
  });

  it("un estado desconocido sale tal cual y neutro, nunca vacío", () => {
    expect(estadoVisiblePedido("partially_refunded", null)).toEqual({ etiqueta: "partially_refunded", color: "neutro" });
    expect(estadoVisiblePedido("otro_estado", "otro_envio")).toEqual({ etiqueta: "otro_estado", color: "neutro" });
  });
});
