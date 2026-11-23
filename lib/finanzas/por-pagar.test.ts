import { describe, expect, it } from "vitest";
import { diasDeVencido, leerFiltrosPorPagar, leerProveedor } from "./por-pagar";

const UUID = "11111111-2222-4333-8444-555555555555";

describe("filtros de cuentas por pagar (issue #422)", () => {
  it("solo acepta valores de la lista blanca", () => {
    expect(leerFiltrosPorPagar({ origen: "orden", estado: "vencido", proveedor: `t:${UUID}` })).toEqual({
      origen: "orden",
      estado: "vencido",
      proveedor: { tipo: "tercero", id: UUID },
    });
    expect(leerFiltrosPorPagar({ origen: "drop table", estado: "x", proveedor: "t:no-uuid" })).toEqual({ origen: null, estado: null, proveedor: null });
  });

  it("lee un beneficiario escrito a mano y descarta los vacíos", () => {
    expect(leerProveedor("b: Arrendador ")).toEqual({ tipo: "beneficiario", nombre: "Arrendador" });
    expect(leerProveedor("b:   ")).toBeNull();
    expect(leerProveedor("otro")).toBeNull();
  });

  it("cuenta los días de vencido (0 si todavía no vence, null sin fecha)", () => {
    expect(diasDeVencido("2026-11-10", "2026-11-20")).toBe(10);
    expect(diasDeVencido("2026-11-25", "2026-11-20")).toBe(0);
    expect(diasDeVencido(null, "2026-11-20")).toBeNull();
  });
});
