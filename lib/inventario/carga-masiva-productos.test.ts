import { describe, expect, it, vi } from "vitest";

// Sin base: db/index.ts exige DATABASE_URL_APP al importarse.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));

import type { FilaArchivo } from "@/lib/importar-archivo";
import { CANTIDAD_INICIAL_MAXIMA } from "@/lib/importar-csv-skus";
import { filasDeTextoPegado, MAXIMO_PRODUCTOS_CARGA_MASIVA, parsearCargaMasivaProductos } from "./carga-masiva-productos";

function parsearTexto(texto: string) {
  const leido = filasDeTextoPegado(texto);
  if (!leido.ok) throw new Error(leido.mensaje);
  return parsearCargaMasivaProductos(leido.filas);
}

// Issue #280 — carga masiva de «Crear producto (SKU)», sin base.
describe("carga masiva de productos", () => {
  it("separador ; con montos 2.500,50", () => {
    const r = parsearTexto("A-1;Linterna;2.500,50;12.900;10");
    expect(r.errores).toEqual([]);
    expect(r.filas).toEqual([{ numeroLinea: 1, codigo: "A-1", nombre: "Linterna", costo: "2500.5", precioVenta: "12900", stockInicial: 10 }]);
  });

  it("separador coma con montos 2500.50", () => {
    const r = parsearTexto("a-1,Linterna,2500.50,12900,3");
    expect(r.filas[0]).toMatchObject({ codigo: "A-1", costo: "2500.5", precioVenta: "12900", stockInicial: 3 });
  });

  it("tabulación (lo que pega Excel)", () => {
    const r = parsearTexto("A-1\tLinterna, recargable\t5000\t\t");
    expect(r.filas[0]).toMatchObject({ codigo: "A-1", nombre: "Linterna, recargable", costo: "5000", precioVenta: null, stockInicial: 0 });
  });

  it("con encabezado mapea por nombre y avisa las columnas de más", () => {
    const r = parsearTexto("nombre;stock_inicial;precio_venta;sku;categoria\nLinterna;4;9.900;L1;hogar");
    expect(r.columnasIgnoradas).toEqual(["categoria"]);
    expect(r.filas).toEqual([{ numeroLinea: 2, codigo: "L1", nombre: "Linterna", costo: null, precioVenta: "9900", stockInicial: 4 }]);
  });

  it("sin encabezado: columnas de más se ignoran con aviso", () => {
    const r = parsearTexto("L1;Linterna;1;2;3;hogar;foto.jpg");
    expect(r.columnasIgnoradas).toEqual(["columna 6", "columna 7"]);
    expect(r.filas).toHaveLength(1);
  });

  it("sku vacío queda para generar; repetido en el archivo es error en la segunda", () => {
    const r = parsearTexto(";Linterna;;;\nX1;Uno;;;\nx1 ;Dos;;;");
    expect(r.filas.map((f) => f.codigo)).toEqual([null, "X1"]);
    expect(r.errores).toEqual([{ numeroLinea: 3, columna: "sku", mensaje: 'El SKU "X1" está repetido en esta carga.' }]);
  });

  it("nombre vacío y sku con formato inválido", () => {
    const r = parsearTexto("A1;;;;\na b;Linterna;;;");
    expect(r.filas).toEqual([]);
    expect(r.errores.map((e) => [e.numeroLinea, e.columna])).toEqual([
      [1, "nombre"],
      [2, "sku"],
    ]);
  });

  it("montos negativos o raros son error", () => {
    const r = parsearTexto("A1;Uno;-5;;\nA2;Dos;1,5,5;;");
    expect(r.filas).toEqual([]);
    expect(r.errores.map((e) => e.columna)).toEqual(["costo", "costo"]);
  });

  it("stock: texto, negativo, decimal y más del máximo son error; vacío es 0", () => {
    const r = parsearTexto(`A1;Uno;;;abc\nA2;Dos;;;-1\nA3;Tres;;;1.5\nA4;Cuatro;;;${CANTIDAD_INICIAL_MAXIMA + 1}\nA5;Cinco;;;`);
    expect(r.errores.map((e) => [e.numeroLinea, e.columna])).toEqual([
      [1, "stock"],
      [2, "stock"],
      [3, "stock"],
      [4, "stock"],
    ]);
    expect(r.filas).toEqual([{ numeroLinea: 5, codigo: "A5", nombre: "Cinco", costo: null, precioVenta: null, stockInicial: 0 }]);
  });

  it("el máximo de stock sí entra", () => {
    expect(parsearTexto(`A1;Uno;;;${CANTIDAD_INICIAL_MAXIMA}`).filas[0].stockInicial).toBe(CANTIDAD_INICIAL_MAXIMA);
  });

  it("líneas en blanco se ignoran y se conserva el número de línea real", () => {
    const r = parsearTexto("\nA1;Uno;;;\n\n   \nA2;;;;\n");
    expect(r.filas.map((f) => f.numeroLinea)).toEqual([2]);
    expect(r.errores[0].numeroLinea).toBe(5);
  });

  it(`más de ${MAXIMO_PRODUCTOS_CARGA_MASIVA} productos se rechaza entero`, () => {
    const texto = Array.from({ length: MAXIMO_PRODUCTOS_CARGA_MASIVA + 1 }, (_, i) => `S${i};Producto ${i};;;`).join("\n");
    const r = parsearTexto(texto);
    expect(r.rechazo).toContain(String(MAXIMO_PRODUCTOS_CARGA_MASIVA));
    expect(r.filas).toEqual([]);
    expect(parsearTexto(texto.split("\n").slice(1).join("\n")).filas).toHaveLength(MAXIMO_PRODUCTOS_CARGA_MASIVA);
  });

  it("celdas de xlsx tipadas como número para costo, precio y stock", () => {
    const filas: FilaArchivo[] = [
      {
        numeroFila: 1,
        celdas: [
          { tipo: "texto", valor: "X1" },
          { tipo: "texto", valor: "Linterna" },
          { tipo: "numero", valor: "5000" },
          { tipo: "numero", valor: "12900.5" },
          { tipo: "numero", valor: "7" },
        ],
      },
      {
        numeroFila: 2,
        celdas: [{ tipo: "vacia" }, { tipo: "texto", valor: "Cama" }, { tipo: "numero", valor: "-1" }, { tipo: "vacia" }, { tipo: "numero", valor: "2.5" }],
      },
    ];
    const r = parsearCargaMasivaProductos(filas);
    expect(r.filas).toEqual([{ numeroLinea: 1, codigo: "X1", nombre: "Linterna", costo: "5000", precioVenta: "12900.5", stockInicial: 7 }]);
    expect(r.errores.map((e) => e.columna)).toEqual(["costo", "stock"]);
  });

  it("sin líneas: rechazo claro", () => {
    expect(parsearTexto("\n\n").rechazo).toBe("No hay ninguna línea para cargar.");
  });
});
