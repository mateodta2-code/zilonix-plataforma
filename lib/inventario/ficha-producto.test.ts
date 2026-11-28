import { describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { armarFichas, leerFichasProducto } from "./ficha-producto";

// Sin base: el módulo real exige DATABASE_URL_APP al importarse. El
// mock deja contar que un lote vacío no consulta nada.
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));

// Issue #280 — la ficha de cada fila de inventario, sin base.
describe("ficha de producto del inventario", () => {
  it("lote vacío → Map vacío, sin consultar la base", async () => {
    const fichas = await leerFichasProducto("00000000-0000-0000-0000-000000000000", []);
    expect(fichas.size).toBe(0);
    expect(dbComoEmpresa).not.toHaveBeenCalled();
  });

  it("un código en minúsculas casa con la maestra (normalizada)", () => {
    const fichas = armarFichas(
      [{ id: "s1", codigo: " ab-1 " }],
      [{ skuCodigo: "AB-1", costo: "1500.00", precioVenta: "3000.00", proveedorNombre: "Proveedor Uno" }],
      [{ skuCodigo: "AB-1", imagenUrl: "https://http2.mlstatic.com/foto-I.jpg" }]
    );
    expect(fichas.get("s1")).toEqual({
      fotoUrl: "https://http2.mlstatic.com/foto-I.jpg",
      costo: "1500.00",
      precioVenta: "3000.00",
      proveedorNombre: "Proveedor Uno",
    });
  });

  it("un código inválido se salta sin romper: queda con todo en null", () => {
    const fichas = armarFichas([{ id: "s1", codigo: "   " }], [{ skuCodigo: "AB-1", costo: "1.00", precioVenta: null, proveedorNombre: null }], []);
    expect(fichas.get("s1")).toEqual({ fotoUrl: null, costo: null, precioVenta: null, proveedorNombre: null });
  });

  it('un costo "0.00" se conserva (es un $0 real, no "sin dato")', () => {
    const fichas = armarFichas([{ id: "s1", codigo: "AB-1" }], [{ skuCodigo: "AB-1", costo: "0.00", precioVenta: "0.00", proveedorNombre: null }], []);
    expect(fichas.get("s1")?.costo).toBe("0.00");
    expect(fichas.get("s1")?.precioVenta).toBe("0.00");
  });

  it("un SKU sin datos sale igual en el Map, con todo en null", () => {
    const fichas = armarFichas([{ id: "s1", codigo: "AB-1" }, { id: "s2", codigo: "SIN-DATOS" }], [{ skuCodigo: "AB-1", costo: "1.00", precioVenta: null, proveedorNombre: null }], []);
    expect(fichas.size).toBe(2);
    expect(fichas.get("s2")).toEqual({ fotoUrl: null, costo: null, precioVenta: null, proveedorNombre: null });
  });

  it("con varias fotos del mismo código, se queda con la primera (la más reciente)", () => {
    const fichas = armarFichas(
      [{ id: "s1", codigo: "AB-1" }],
      [],
      [
        { skuCodigo: "AB-1", imagenUrl: "https://nueva-I.jpg" },
        { skuCodigo: "AB-1", imagenUrl: "https://vieja-I.jpg" },
      ]
    );
    expect(fichas.get("s1")?.fotoUrl).toBe("https://nueva-I.jpg");
  });
});
