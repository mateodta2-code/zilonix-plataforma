import { describe, expect, it } from "vitest";
import { esUuid, MODULOS_SOPORTE, SoporteError, validarMensajeTicket, validarTicket } from "./validacion";

describe("validarTicket", () => {
  it("normaliza espacios y saltos de línea", () => {
    const r = validarTicket("  No   cargan mis pedidos ", "Línea uno\r\n\n\n\nLínea dos larga", "Pedidos");
    expect(r).toEqual({ asunto: "No cargan mis pedidos", mensaje: "Línea uno\n\nLínea dos larga", modulo: "Pedidos" });
  });

  it("rechaza asunto corto o largo, mensaje corto o largo", () => {
    expect(() => validarTicket("hola", "mensaje suficiente", "Pedidos")).toThrow(SoporteError);
    expect(() => validarTicket("a".repeat(151), "mensaje suficiente", "Pedidos")).toThrow(SoporteError);
    expect(() => validarTicket("Asunto válido", "corto", "Pedidos")).toThrow(SoporteError);
    expect(() => validarTicket("Asunto válido", "a".repeat(5001), "Pedidos")).toThrow(SoporteError);
  });

  it("solo acepta módulos de la lista cerrada", () => {
    for (const m of MODULOS_SOPORTE) expect(validarTicket("Asunto válido", "mensaje suficiente", m).modulo).toBe(m);
    expect(() => validarTicket("Asunto válido", "mensaje suficiente", "Inventado")).toThrow(SoporteError);
    expect(() => validarTicket("Asunto válido", "mensaje suficiente", undefined)).toThrow(SoporteError);
  });
});

describe("validarMensajeTicket y esUuid", () => {
  it("exige texto y respeta el máximo", () => {
    expect(validarMensajeTicket("  ok gracias ")).toBe("ok gracias");
    expect(() => validarMensajeTicket(" ")).toThrow(SoporteError);
    expect(() => validarMensajeTicket("a".repeat(5001))).toThrow(SoporteError);
  });

  it("reconoce uuids", () => {
    expect(esUuid("3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b")).toBe(true);
    expect(esUuid("../etc/passwd")).toBe(false);
  });
});
