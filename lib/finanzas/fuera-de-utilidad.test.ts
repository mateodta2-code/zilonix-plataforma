import { describe, expect, it } from "vitest";
import { motivoFueraDeUtilidad, ordenarFueraDeUtilidad, totalizarFueraDeUtilidad, type VentaFueraDeUtilidad } from "./fuera-de-utilidad";

// Pestaña «Canceladas y devoluciones» (28-nov): qué ventas salen de la
// utilidad y con qué motivo, sin base.

const base = { estado: "paid", cancelada: false, reembolsos: "0.00", tieneReclamo: false };

describe("motivoFueraDeUtilidad", () => {
  it("una venta normal suma (sin motivo)", () => {
    expect(motivoFueraDeUtilidad(base)).toBeNull();
  });

  it("cancelled e invalid son «cancelada», aunque también tengan reembolso o reclamo", () => {
    expect(motivoFueraDeUtilidad({ ...base, estado: "cancelled", cancelada: true, reembolsos: "50000.00", tieneReclamo: true })).toBe("cancelada");
    expect(motivoFueraDeUtilidad({ ...base, estado: "invalid" })).toBe("cancelada");
  });

  it("reembolso total, parcial y reclamo, en ese orden", () => {
    expect(motivoFueraDeUtilidad({ ...base, cancelada: true, reembolsos: "50000.00" })).toBe("reembolso_total");
    expect(motivoFueraDeUtilidad({ ...base, reembolsos: "0.01", tieneReclamo: true })).toBe("reembolso_parcial");
    expect(motivoFueraDeUtilidad({ ...base, tieneReclamo: true })).toBe("reclamo_devolucion");
  });
});

function venta(extra: Partial<VentaFueraDeUtilidad>): VentaFueraDeUtilidad {
  return {
    pedidoId: "p",
    pedidoIdExterno: "1",
    fechaCreacion: new Date("2026-11-01T12:00:00Z"),
    cuenta: "TIENDA",
    estado: "paid",
    motivo: "reembolso_parcial",
    productos: [],
    valorVenta: "50000.00",
    reembolsos: "10000.00",
    comisionMl: "6000.00",
    fleteMl: null,
    ...extra,
  };
}

describe("totalizarFueraDeUtilidad y ordenarFueraDeUtilidad", () => {
  it("suma en centavos y cuenta por motivo", () => {
    const totales = totalizarFueraDeUtilidad([
      venta({ pedidoId: "a" }),
      venta({ pedidoId: "b", motivo: "cancelada", valorVenta: "0.10", reembolsos: "0.00" }),
      venta({ pedidoId: "c", motivo: "cancelada", valorVenta: "0.20", reembolsos: "0.00" }),
    ]);
    expect(totales).toEqual({
      ventas: 3,
      porMotivo: { cancelada: 2, reembolso_total: 0, reembolso_parcial: 1, reclamo_devolucion: 0 },
      valorVenta: "50000.30",
      reembolsos: "10000.00",
    });
  });

  it("la más nueva primero", () => {
    const vieja = venta({ pedidoId: "vieja", fechaCreacion: new Date("2026-11-01T12:00:00Z") });
    const nueva = venta({ pedidoId: "nueva", fechaCreacion: new Date("2026-11-02T12:00:00Z") });
    expect(ordenarFueraDeUtilidad([vieja, nueva]).map((v) => v.pedidoId)).toEqual(["nueva", "vieja"]);
  });
});
