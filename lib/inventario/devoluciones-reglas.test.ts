import { describe, expect, it } from "vitest";
import { devolucionPorLlegar, diaBogotaDe, filasDeDevolucionMl } from "./devoluciones-reglas";

describe("Devoluciones — reglas puras (28-nov)", () => {
  it("solo avisa las que vienen en camino o ya se entregaron", () => {
    expect(devolucionPorLlegar("en_camino")).toBe(true);
    expect(devolucionPorLlegar("llego")).toBe(true);
    expect(devolucionPorLlegar("cerrada")).toBe(false);
    expect(devolucionPorLlegar("revisada")).toBe(false);
    expect(devolucionPorLlegar("en_proceso")).toBe(false);
  });

  it("el día es el de Bogotá, no el UTC del servidor", () => {
    expect(diaBogotaDe("2026-11-28T03:00:00.000Z", new Date())).toBe("2026-11-27");
    expect(diaBogotaDe(null, new Date("2026-11-28T15:00:00Z"))).toBe("2026-11-28");
  });

  const base = { reclamoId: "5001", ordenId: "2000019826695536", fecha: "2026-11-27", estadoEnvio: "En camino", cuentaMlId: "c1" };

  it("una fila por línea de la venta guardada, con su SKU, nombre y cantidad", () => {
    const filas = filasDeDevolucionMl(base, [
      { linea: 1, skuId: "s1", titulo: "Bebedero", cantidad: 2 },
      { linea: 2, skuId: null, titulo: "Orejeras", cantidad: 1 },
    ]);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ reclamoIdMl: "5001", lineaPedido: 1, skuId: "s1", producto: "Bebedero", cantidad: 2, pedidoIdExterno: "2000019826695536" });
    expect(filas[1]).toMatchObject({ lineaPedido: 2, skuId: null });
  });

  it("si la venta no está en Zilonix, una fila sin SKU para elegirlo al recibir", () => {
    const [fila] = filasDeDevolucionMl(base, []);
    expect(fila).toMatchObject({ lineaPedido: 0, skuId: null, cantidad: 1 });
    expect(fila.producto).toContain("2000019826695536");
  });
});
