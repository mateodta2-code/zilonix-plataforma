import { describe, expect, it } from "vitest";
import { colorEstadoPago } from "./ChipEstadoPago";

describe("colorEstadoPago", () => {
  it("pinta cada estado del reporte de Falabella", () => {
    expect(colorEstadoPago("Pagado")).toBe("exito");
    expect(colorEstadoPago("Pago programado")).toBe("aviso");
    expect(colorEstadoPago("Abierto")).toBe("aviso");
    // Antes /pagad/i lo pintaba de verde.
    expect(colorEstadoPago("No pagado")).toBe("peligro");
  });
});
