import { describe, expect, it } from "vitest";
import { generarPlantillaCsvSkus, importarCsvSkus } from "./importar-csv-skus";

// Issue #58 (Z-ML-09) — parser puro, sin Postgres ni ninguna tabla.
// Todos los fixtures de acá son inventados a propósito (SKU-DEMO-*,
// "Producto de prueba", "Bodega 1"...) — nada de datos reales de
// clientes ni nombres propios del negocio.

describe("importarCsvSkus — plantilla propia de Zilonix (sku, nombre, bodega, cantidad_inicial)", () => {
  it("archivo sano con las 4 columnas -> todas las filas válidas, sin errores", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial", "SKU-001,Producto de prueba 1,Bodega 1,10", "SKU-002,Producto de prueba 2,Bodega 2,0"].join(
      "\n"
    );
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas).toEqual([
      { sku: "SKU-001", nombre: "Producto de prueba 1", bodega: "Bodega 1", cantidadInicial: 10 },
      { sku: "SKU-002", nombre: "Producto de prueba 2", bodega: "Bodega 2", cantidadInicial: 0 },
    ]);
    expect(resultado.resumen).toEqual({ validas: 2, conError: 0, skusRepetidos: [], columnasIgnoradas: [] });
  });

  it("nombre y bodega son opcionales — un archivo solo con sku y cantidad_inicial también es válido", () => {
    const csv = ["sku,cantidad_inicial", "SKU-001,5"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas).toEqual([{ sku: "SKU-001", nombre: undefined, cantidadInicial: 5, bodega: undefined }]);
  });

  it("acepta punto y coma como delimitador (detectado por la fila de encabezado)", () => {
    const csv = ["sku;nombre;bodega;cantidad_inicial", "SKU-001;Producto de prueba;Bodega 1;7"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas).toEqual([{ sku: "SKU-001", nombre: "Producto de prueba", bodega: "Bodega 1", cantidadInicial: 7 }]);
  });

  it("acepta coma como delimitador por defecto cuando no hay ningún punto y coma", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial", "SKU-001,Producto,Bodega 1,3"].join("\n");
    expect(importarCsvSkus(csv).resumen.validas).toBe(1);
  });

  it("quita el BOM de Excel al principio del archivo", () => {
    const csv = "﻿" + ["sku,nombre,bodega,cantidad_inicial", "SKU-001,Producto,Bodega 1,1"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas[0]?.sku).toBe("SKU-001");
  });

  it("respeta comillas: un campo con comas adentro no se parte, y una comilla doblada dentro de comillas es una comilla literal", () => {
    const csv = [
      "sku,nombre,bodega,cantidad_inicial",
      'SKU-001,"Producto, con coma adentro",Bodega 1,2',
      'SKU-002,"Producto con ""comillas"" adentro",Bodega 1,3',
    ].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas[0]?.nombre).toBe("Producto, con coma adentro");
    expect(resultado.filas[1]?.nombre).toBe('Producto con "comillas" adentro');
  });

  it("ignora filas vacías al final del archivo (no cuentan como error ni como fila válida)", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial", "SKU-001,Producto,Bodega 1,1", "", "   ", ",,,"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.resumen.validas).toBe(1);
  });

  it("acepta saltos de línea estilo Windows (CRLF)", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial", "SKU-001,Producto,Bodega 1,1", "SKU-002,Producto 2,Bodega 2,2"].join("\r\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.resumen.validas).toBe(2);
  });

  it("SKU vacío -> error de fila en la columna sku, esa fila no queda en las válidas", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial", ",Producto sin SKU,Bodega 1,1"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toEqual([{ numeroFila: 2, columna: "sku", mensaje: "El SKU es obligatorio y quedó vacío." }]);
    expect(resultado.resumen).toEqual({ validas: 0, conError: 1, skusRepetidos: [], columnasIgnoradas: [] });
  });

  it("un SKU repetido en el archivo es error en las DOS filas, ninguna de las dos queda válida", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial", "SKU-001,Producto A,Bodega 1,1", "SKU-001,Producto B,Bodega 2,2"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toHaveLength(2);
    expect(resultado.errores.every((e) => e.columna === "sku" && e.numeroFila >= 2)).toBe(true);
    expect(resultado.resumen.skusRepetidos).toEqual(["SKU-001"]);
    expect(resultado.resumen.conError).toBe(2);
  });

  it("SKU repetido: una de las dos filas puede además tener otro error propio, igual quedan las dos marcadas", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial", "SKU-001,Producto A,Bodega 1,no-es-numero", "SKU-001,Producto B,Bodega 2,2"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    const filasConSku = resultado.errores.filter((e) => e.columna === "sku");
    expect(filasConSku.map((e) => e.numeroFila).sort()).toEqual([2, 3]);
  });

  it("cantidad con decimales, negativa o con texto -> error de fila, columna cantidad_inicial", () => {
    const csv = [
      "sku,nombre,bodega,cantidad_inicial",
      "SKU-001,Producto 1,Bodega 1,10.5",
      "SKU-002,Producto 2,Bodega 1,-3",
      "SKU-003,Producto 3,Bodega 1,diez",
      "SKU-004,Producto 4,Bodega 1,",
    ].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toHaveLength(4);
    expect(resultado.errores.every((e) => e.columna === "cantidad_inicial")).toBe(true);
    expect(resultado.resumen.conError).toBe(4);
  });

  it("cantidad en 0 es válida (no es lo mismo que vacío o negativa)", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial", "SKU-001,Producto,Bodega 1,0"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas[0]?.cantidadInicial).toBe(0);
  });

  it("columnas de más se ignoran, con un aviso en el resumen — nunca hacen fallar el archivo", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial,costo,proveedor", "SKU-001,Producto,Bodega 1,1,5000,Proveedor X"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.resumen.validas).toBe(1);
    expect(resultado.resumen.columnasIgnoradas.sort()).toEqual(["costo", "proveedor"]);
    // Las columnas de más nunca aparecen en la fila construida.
    expect(Object.keys(resultado.filas[0]!)).toEqual(["sku", "nombre", "bodega", "cantidadInicial"]);
  });

  it("falta un encabezado obligatorio (cantidad_inicial) -> error general, ninguna fila válida", () => {
    const csv = ["sku,nombre,bodega", "SKU-001,Producto,Bodega 1"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toEqual([
      {
        numeroFila: 1,
        columna: "cantidad_inicial",
        mensaje: 'Falta la columna obligatoria "cantidad_inicial" en el encabezado — revisa que el archivo use la plantilla de Zilonix (sku, nombre, bodega, cantidad_inicial).',
      },
    ]);
    expect(resultado.resumen).toEqual({ validas: 0, conError: 0, skusRepetidos: [], columnasIgnoradas: [] });
  });

  it("faltan los dos encabezados obligatorios -> un error por cada uno", () => {
    const csv = ["nombre,bodega", "Producto,Bodega 1"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores.map((e) => e.columna).sort()).toEqual(["cantidad_inicial", "sku"]);
  });

  it("el encabezado es tolerante a mayúsculas/minúsculas y espacios alrededor", () => {
    const csv = [" SKU , Nombre , Bodega , Cantidad_Inicial ", "SKU-001,Producto,Bodega 1,1"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.resumen.validas).toBe(1);
  });

  it("nunca devuelve ningún concepto de borrar — la fila válida solo tiene sku/nombre/bodega/cantidadInicial", () => {
    const csv = ["sku,nombre,bodega,cantidad_inicial", "SKU-001,Producto,Bodega 1,1"].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas[0]).not.toHaveProperty("accion");
    expect(JSON.stringify(resultado).toLowerCase()).not.toContain("borrar");
    expect(JSON.stringify(resultado).toLowerCase()).not.toContain("delete");
  });

  it("archivo vacío (solo encabezado, sin filas de datos) -> sin filas ni errores", () => {
    const csv = "sku,nombre,bodega,cantidad_inicial";
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toEqual([]);
    expect(resultado.resumen).toEqual({ validas: 0, conError: 0, skusRepetidos: [], columnasIgnoradas: [] });
  });
});

describe("generarPlantillaCsvSkus — la plantilla que la pantalla del #57 va a ofrecer", () => {
  it("trae los 4 encabezados fijos y 2 filas de ejemplo con datos inventados", () => {
    const plantilla = generarPlantillaCsvSkus();
    expect(plantilla.startsWith("sku,nombre,bodega,cantidad_inicial\n")).toBe(true);
    expect(plantilla.split("\n").filter(Boolean)).toHaveLength(3); // encabezado + 2 filas de ejemplo
  });

  it("la plantilla que genera este mismo archivo, el propio parser la lee sin errores", () => {
    const resultado = importarCsvSkus(generarPlantillaCsvSkus());
    expect(resultado.errores).toEqual([]);
    expect(resultado.resumen.validas).toBe(2);
  });

  it("no trae ningún dato real de cliente ni nombre propio del negocio — solo marcadores DEMO", () => {
    const plantilla = generarPlantillaCsvSkus();
    expect(plantilla).toContain("SKU-DEMO-001");
    expect(plantilla).toContain("SKU-DEMO-002");
  });
});
