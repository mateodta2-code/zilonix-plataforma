import { describe, expect, it } from "vitest";
import type { MaestraSku } from "./combo-sku";
import {
  monedaDeEmpresa,
  totalEnCamino,
  totalizarInventario,
  ubicacionValida,
  valorizarEnCamino,
  valorizarStock,
  type SaldoStock,
} from "./inventario-valorizado";

// Issue #422 — cálculo del inventario valorizado, sin base.

function fila(costo: string | null): MaestraSku {
  return { costo, empaque: null, empaqueProveedor: null, envioAgencia: null };
}

const maestra = new Map<string, MaestraSku>([
  ["AGUJA", fila("1000.50")],
  ["TAZA", fila("5000")],
  ["SINCOSTO", fila(null)],
]);

function saldo(parcial: Partial<SaldoStock> & Pick<SaldoStock, "skuId" | "codigo">): SaldoStock {
  return {
    nombre: parcial.codigo,
    bodegaId: "b1",
    bodegaNombre: "Principal",
    tipoBodega: "propia",
    disponible: 0,
    reservado: 0,
    ...parcial,
  };
}

describe("valorizarStock y totalizarInventario", () => {
  it("valoriza disponible + reservado al costo de la maestra y separa por ubicación", () => {
    const lineas = valorizarStock(
      [
        saldo({ skuId: "s1", codigo: "AGUJA", disponible: 3, reservado: 1 }),
        saldo({ skuId: "s2", codigo: "TAZA", bodegaId: "f", bodegaNombre: "Full", tipoBodega: "fulfillment_ml", disponible: 2 }),
        saldo({ skuId: "s3", codigo: "TAZA", bodegaId: "t", bodegaNombre: "3PL Norte", tipoBodega: "tercero", disponible: 1 }),
      ],
      maestra
    );
    expect(lineas.map((l) => [l.codigo, l.ubicacion, l.unidades, l.valor])).toEqual([
      ["AGUJA", "bodegas", 4, "4002.00"],
      ["TAZA", "bodegas", 1, "5000.00"],
      ["TAZA", "full", 2, "10000.00"],
    ]);
    expect(totalizarInventario(lineas)).toEqual({
      total: "19002.00",
      porUbicacion: { bodegas: "9002.00", full: "10000.00", falabella: null },
      skusSinCosto: 0,
      unidadesSinCosto: 0,
    });
  });

  it("combo X2/X3 sin fila propia usa el costo de la base multiplicado", () => {
    const [l] = valorizarStock([saldo({ skuId: "s1", codigo: "tazax3", disponible: 2 })], maestra);
    expect(l).toMatchObject({ costoUnitario: "15000.00", origenCosto: "combo_base", valor: "30000.00" });
  });

  it("un SKU sin costo queda «Falta costo»: no suma valor y se cuenta una vez aunque esté en dos bodegas", () => {
    const lineas = valorizarStock(
      [
        saldo({ skuId: "s9", codigo: "SINCOSTO", disponible: 2 }),
        saldo({ skuId: "s9", codigo: "SINCOSTO", bodegaId: "f", bodegaNombre: "Full", tipoBodega: "fulfillment_ml", disponible: 1 }),
        saldo({ skuId: "s8", codigo: "NOESTA", disponible: 5 }),
      ],
      maestra
    );
    expect(lineas.every((l) => l.valor === null && l.costoUnitario === null)).toBe(true);
    expect(totalizarInventario(lineas)).toMatchObject({ total: "0.00", skusSinCosto: 2, unidadesSinCosto: 8 });
  });

  it("saldos en cero no aparecen", () => {
    expect(valorizarStock([saldo({ skuId: "s1", codigo: "AGUJA" })], maestra)).toEqual([]);
  });
});

describe("valorizarEnCamino", () => {
  it("pedido − recibido, al costo de la OC si existe y si no al de la maestra", () => {
    const lineas = valorizarEnCamino(
      [
        { ordenNumero: 2, skuId: "s1", codigo: "AGUJA", nombre: "Aguja", cantidadPedida: 10, cantidadRecibida: 4, costoOrden: "900" },
        { ordenNumero: 1, skuId: "s2", codigo: "TAZA", nombre: "Taza", cantidadPedida: 3, cantidadRecibida: 0, costoOrden: null },
        { ordenNumero: 1, skuId: "s3", codigo: "SINCOSTO", nombre: "X", cantidadPedida: 1, cantidadRecibida: 0, costoOrden: null },
        { ordenNumero: 3, skuId: "s1", codigo: "AGUJA", nombre: "Aguja", cantidadPedida: 2, cantidadRecibida: 3, costoOrden: "900" },
      ],
      maestra
    );
    expect(lineas.map((l) => [l.ordenNumero, l.codigo, l.unidades, l.origenCosto, l.valor])).toEqual([
      [1, "SINCOSTO", 1, null, null],
      [1, "TAZA", 3, "maestra", "15000.00"],
      [2, "AGUJA", 6, "orden", "5400.00"],
    ]);
    expect(totalEnCamino(lineas)).toEqual({ total: "20400.00", lineasSinCosto: 1 });
  });
});

describe("monedaDeEmpresa y ubicacionValida", () => {
  it("una sola moneda en las cuentas → esa; ninguna o varias → la del sitio por defecto", () => {
    expect(monedaDeEmpresa(["MXN", "MXN"])).toBe("MXN");
    expect(monedaDeEmpresa([])).toBe("COP");
    expect(monedaDeEmpresa(["COP", "MXN"])).toBe("COP");
  });

  it("solo acepta ubicaciones de la lista blanca", () => {
    expect(ubicacionValida("full")).toBe("full");
    expect(ubicacionValida("'; drop")).toBeUndefined();
    expect(ubicacionValida(undefined)).toBeUndefined();
  });
});
