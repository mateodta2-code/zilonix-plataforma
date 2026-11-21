import { describe, expect, it } from "vitest";
import { leerItemEdicion } from "@/lib/ml/cliente";
import { leerPrecioEscrito, simularPrecio } from "@/lib/optimizacion/simulador";

describe("precio escrito a mano", () => {
  it("en sitios sin decimales, el punto y la coma son miles", () => {
    expect(leerPrecioEscrito("45.900", "MCO")).toBe("45900.00");
    expect(leerPrecioEscrito("$ 129.000", "MCO")).toBe("129000.00");
    expect(leerPrecioEscrito("45900", "MCO")).toBe("45900.00");
  });

  it("en sitios con decimales acepta 1.234,56 y 1234.56", () => {
    expect(leerPrecioEscrito("1.234,56", "MLM")).toBe("1234.56");
    expect(leerPrecioEscrito("1234.56", "MLM")).toBe("1234.56");
  });

  it("rechaza vacío, cero, negativo y texto", () => {
    for (const malo of ["", "0", "-100", "abc", "1..2"]) expect(leerPrecioEscrito(malo, "MCO")).toBeNull();
  });
});

describe("simulador de precio", () => {
  // Período: ventas 300.000 con 45.000 de comisión (15 %); fijo 31.000 por unidad.
  const base = { fijoPorUnidad: "31000.00", comision: "45000.00", ventas: "300000.00", precioParaGanar: "95000.00" };

  it("ganancia por unidad = precio − comisión proporcional − fijo", () => {
    expect(simularPrecio("100000.00", base)).toEqual({ ganancia: "54000.00", margen: "54.00", competencia: "compitiendo" });
  });

  it("al precio para ganar o por debajo queda Ganando", () => {
    expect(simularPrecio("95000.00", base).competencia).toBe("ganando");
    expect(simularPrecio("90000.00", base).competencia).toBe("ganando");
  });

  it("sin costos del período no inventa ganancia; sin catálogo no hay competencia", () => {
    expect(simularPrecio("100000.00", { fijoPorUnidad: null, comision: null, ventas: null, precioParaGanar: null })).toEqual({
      ganancia: null,
      margen: null,
      competencia: null,
    });
  });

  it("ganancia negativa cuando el precio no cubre los costos", () => {
    expect(simularPrecio("30000.00", base).ganancia).toBe("-5500.00");
  });
});

describe("publicación para editar (forma confirmada en staging, #464)", () => {
  it("ventas, variantes y fotos en https", () => {
    const item = leerItemEdicion({
      id: "MCO3489505958",
      title: "Fibra natural",
      price: 42630,
      sold_quantity: 4,
      variations: [],
      status: "active",
      seller_id: 123456,
      pictures: [
        { id: "123-MCO1_1", secure_url: "https://http2.mlstatic.com/a.jpg" },
        { id: "123-MCO1_2", url: "http://http2.mlstatic.com/b.jpg" },
        { id: 5, url: "https://x" },
      ],
    });
    expect(item).toEqual({
      id: "MCO3489505958",
      titulo: "Fibra natural",
      precio: 42630,
      vendidas: 4,
      tieneVariantes: false,
      estado: "active",
      sellerId: "123456",
      fotos: [
        { id: "123-MCO1_1", url: "https://http2.mlstatic.com/a.jpg" },
        { id: "123-MCO1_2", url: "https://http2.mlstatic.com/b.jpg" },
      ],
    });
    expect(leerItemEdicion({ id: "MCO1", variations: [{ id: 1 }] })?.tieneVariantes).toBe(true);
  });
});
