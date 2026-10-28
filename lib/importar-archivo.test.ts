import { describe, expect, it } from "vitest";
import { decimalDeNumeroExcel, leerArchivo, leerCsv, leerMonto, leerXlsx, type Celda } from "./importar-archivo";
import { crearXlsxDePrueba } from "./test-utils/xlsx";

const texto = (valor: string): Celda => ({ tipo: "texto", valor });

describe("leerMonto — regla de montos (issue #128)", () => {
  it("1.234,56 y 1234.56 dan el mismo monto; nunca pasan por Number", () => {
    expect(leerMonto(texto("1.234,56"))).toEqual({ tipo: "monto", valor: "1234.56" });
    expect(leerMonto(texto("1234.56"))).toEqual({ tipo: "monto", valor: "1234.56" });
    expect(leerMonto(texto("$ 2.000"))).toEqual({ tipo: "monto", valor: "2000" });
    expect(leerMonto(texto("3000,5"))).toEqual({ tipo: "monto", valor: "3000.5" });
    expect(leerMonto(texto("999999999999.99"))).toEqual({ tipo: "monto", valor: "999999999999.99" });
  });

  it("0, 0,00 y 0.00 son un cero real; vacío y espacios son vacío", () => {
    for (const cero of ["0", "0,00", "0.00"]) expect(leerMonto(texto(cero))).toEqual({ tipo: "monto", valor: "0" });
    expect(leerMonto({ tipo: "numero", valor: "0" })).toEqual({ tipo: "monto", valor: "0" });
    expect(leerMonto({ tipo: "vacia" })).toEqual({ tipo: "vacio" });
    expect(leerMonto(texto("   "))).toEqual({ tipo: "vacio" });
  });

  it("rechaza negativos, más de 2 decimales, ambiguos y texto", () => {
    for (const malo of ["-5", "1,005", "2,000", "1.234.5", "abc", "1e3", "1234.567", "1234567890123"]) {
      expect(leerMonto(texto(malo)).tipo, malo).toBe("error");
    }
    // Punto de miles: "10.005" es diez mil cinco, no 10 con 3 decimales.
    expect(leerMonto(texto("10.005"))).toEqual({ tipo: "monto", valor: "10005" });
    expect(leerMonto({ tipo: "numero", valor: "-1" }).tipo).toBe("error");
    expect(leerMonto({ tipo: "numero", valor: "1.005" }).tipo).toBe("error");
  });
});

describe("decimalDeNumeroExcel", () => {
  it("pasa el double de Excel a decimal plano, a 15 cifras", () => {
    expect(decimalDeNumeroExcel("3000")).toBe("3000");
    expect(decimalDeNumeroExcel("45000.000000000007")).toBe("45000");
    expect(decimalDeNumeroExcel("0.30000000000000004")).toBe("0.3");
    expect(decimalDeNumeroExcel("1.2E-2")).toBe("0.012");
    expect(decimalDeNumeroExcel("1.5E3")).toBe("1500");
    expect(decimalDeNumeroExcel("9.9999999999999999E2")).toBe("1000");
    expect(decimalDeNumeroExcel("abc")).toBeNull();
  });
});

describe("leerCsv / leerXlsx", () => {
  it("CSV: `\"\"` es vacía y `0` es texto, con separador ; o ,", () => {
    const hoja = leerCsv("sku;costo\nA;\nB;0\n");
    expect(hoja.ok).toBe(true);
    if (!hoja.ok) return;
    expect(hoja.filas[1].celdas).toEqual([texto("A"), { tipo: "vacia" }]);
    expect(hoja.filas[2].celdas).toEqual([texto("B"), texto("0")]);
  });

  it("XLSX: lee la hoja PRODUCTOS, distingue celda vacía de número 0 y deja huecos donde falta una celda", () => {
    const xlsx = crearXlsxDePrueba([
      ["SKU", "Costo producto", "packing"],
      ["REF-1", null, 3000],
      ["REF-2", 0, null],
      ["REF & 3", 1234.56, "2.000"],
    ]);
    const hoja = leerXlsx(xlsx);
    expect(hoja.ok).toBe(true);
    if (!hoja.ok) return;
    expect(hoja.filas).toHaveLength(4);
    expect(hoja.filas[1].celdas).toEqual([texto("REF-1"), { tipo: "vacia" }, { tipo: "numero", valor: "3000" }]);
    expect(hoja.filas[2].celdas).toEqual([texto("REF-2"), { tipo: "numero", valor: "0" }]);
    expect(hoja.filas[3].celdas).toEqual([texto("REF & 3"), { tipo: "numero", valor: "1234.56" }, texto("2.000")]);
  });

  it("rechaza archivos que no son .xlsx/.csv y .xlsx dañados sin reventar", () => {
    expect(leerArchivo("hoja.xls", Buffer.from("x")).ok).toBe(false);
    expect(leerArchivo("hoja.xlsx", Buffer.from("no soy un zip")).ok).toBe(false);
    const roto = crearXlsxDePrueba([["SKU"]]).subarray(0, 60);
    expect(leerArchivo("hoja.xlsx", roto).ok).toBe(false);
  });
});
