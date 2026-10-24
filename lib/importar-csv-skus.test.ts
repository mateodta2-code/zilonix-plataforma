import { describe, expect, it } from "vitest";
import {
  CANTIDAD_INICIAL_MAXIMA,
  FILAS_MAXIMAS,
  TAMANO_MAXIMO_BYTES,
  generarPlantillaCsvSkus,
  importarCsvSkus,
} from "./importar-csv-skus";

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

describe("importarCsvSkus — límites de tamaño y de filas", () => {
  it("un archivo más grande que TAMANO_MAXIMO_BYTES devuelve error de archivo y ninguna fila, sin lanzar", () => {
    const csv = "x".repeat(TAMANO_MAXIMO_BYTES + 1);
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toEqual([
      {
        numeroFila: 1,
        columna: "archivo",
        mensaje: `El archivo supera el tamaño máximo de ${TAMANO_MAXIMO_BYTES / (1024 * 1024)} MB (${TAMANO_MAXIMO_BYTES} bytes).`,
      },
    ]);
    expect(resultado.resumen).toEqual({ validas: 0, conError: 0, skusRepetidos: [], columnasIgnoradas: [] });
  });

  it("el tamaño justo en el tope no es el error de tamaño (el tope es inclusive)", () => {
    // 5 MB justos de saltos de línea: pasa el tope de bytes y se rechaza
    // por filas. Si el tope de tamaño fuera >= en vez de >, este caso
    // devolvería el error de tamaño y no llegaría a tokenizar.
    const csv = "\n".repeat(TAMANO_MAXIMO_BYTES);
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores.some((e) => e.mensaje.includes("tamaño máximo"))).toBe(false);
    expect(resultado.errores[0]?.columna).toBe("archivo");
    expect(resultado.errores[0]?.mensaje).toContain("filas lógicas");
    expect(resultado.filas).toEqual([]);
  });

  it("cuenta bytes UTF-8, no unidades UTF-16: una cadena de á más corta que el tope en .length igual puede excederlo", () => {
    // "á" (U+00E1) es 1 en string.length y 2 bytes en UTF-8.
    const caracteres = Math.floor(TAMANO_MAXIMO_BYTES / 2) + 1;
    const csv = "á".repeat(caracteres);
    expect(csv.length).toBeLessThanOrEqual(TAMANO_MAXIMO_BYTES);
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toHaveLength(1);
    expect(resultado.errores[0]?.columna).toBe("archivo");
    expect(resultado.errores[0]?.mensaje).toContain(String(TAMANO_MAXIMO_BYTES));
  });

  it("exactamente FILAS_MAXIMAS filas lógicas (encabezado + datos) se aceptan", () => {
    const datos = FILAS_MAXIMAS - 1;
    const lineas = ["sku,cantidad_inicial"];
    for (let i = 0; i < datos; i++) lineas.push(`S${i},1`);
    const resultado = importarCsvSkus(lineas.join("\n"));
    expect(resultado.errores).toEqual([]);
    expect(resultado.resumen.validas).toBe(datos);
    expect(resultado.filas[0]?.sku).toBe("S0");
    expect(resultado.filas.at(-1)?.sku).toBe(`S${datos - 1}`);
    expect(resultado.filas.at(-1)?.cantidadInicial).toBe(1);
  });

  it("una fila lógica de más rechaza el archivo entero, con error estructurado y sin lanzar", () => {
    const lineas = ["sku,cantidad_inicial"];
    for (let i = 0; i < FILAS_MAXIMAS; i++) lineas.push(`S${i},1`);
    const resultado = importarCsvSkus(lineas.join("\n"));
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toEqual([
      {
        numeroFila: FILAS_MAXIMAS + 1,
        columna: "archivo",
        mensaje: `El archivo supera el máximo de ${FILAS_MAXIMAS} filas lógicas. Divide el CSV y vuelve a importarlo.`,
      },
    ]);
    expect(resultado.resumen).toEqual({ validas: 0, conError: 0, skusRepetidos: [], columnasIgnoradas: [] });
  });
});

describe("importarCsvSkus — tope de cantidad_inicial", () => {
  it("el tope inclusive es válido y una unidad por encima es error de esa fila y columna", () => {
    const csv = [
      "sku,nombre,bodega,cantidad_inicial",
      `SKU-OK,Producto,Bodega 1,${CANTIDAD_INICIAL_MAXIMA}`,
      `SKU-MAL,Producto,Bodega 1,${CANTIDAD_INICIAL_MAXIMA + 1}`,
    ].join("\n");
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([
      { sku: "SKU-OK", nombre: "Producto", bodega: "Bodega 1", cantidadInicial: CANTIDAD_INICIAL_MAXIMA },
    ]);
    expect(resultado.errores).toEqual([
      {
        numeroFila: 3,
        columna: "cantidad_inicial",
        mensaje: `"${CANTIDAD_INICIAL_MAXIMA + 1}" supera el máximo de ${CANTIDAD_INICIAL_MAXIMA} unidades por fila — la cantidad inicial tiene que ser un entero entre 0 y ${CANTIDAD_INICIAL_MAXIMA}.`,
      },
    ]);
    expect(resultado.resumen.conError).toBe(1);
    expect(resultado.resumen.validas).toBe(1);
  });

  it("ceros a la izquierda no esquivan el tope", () => {
    const enElTope = `sku,cantidad_inicial\nSKU-1,${"0".repeat(4)}${CANTIDAD_INICIAL_MAXIMA}`;
    const pasado = `sku,cantidad_inicial\nSKU-1,${"0".repeat(4)}${CANTIDAD_INICIAL_MAXIMA + 1}`;
    expect(importarCsvSkus(enElTope).filas[0]?.cantidadInicial).toBe(CANTIDAD_INICIAL_MAXIMA);
    const rechazado = importarCsvSkus(pasado);
    expect(rechazado.filas).toEqual([]);
    expect(rechazado.errores[0]?.columna).toBe("cantidad_inicial");
    expect(rechazado.errores[0]?.numeroFila).toBe(2);
  });

  it("un entero que Number() redondearía no entra a las filas válidas", () => {
    // Number("9007199254740993") === 9007199254740992. Comparar con
    // Number() > Number.MAX_SAFE_INTEGER dejaría pasar este valor ya
    // redondeado. El tope se compara por dígitos, sin perder precisión.
    const noExacto = "9007199254740993";
    expect(Number(noExacto)).toBe(9007199254740992);
    const csv = `sku,cantidad_inicial\nSKU-1,${noExacto}`;
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toHaveLength(1);
    expect(resultado.errores[0]?.columna).toBe("cantidad_inicial");
    expect(resultado.errores[0]?.numeroFila).toBe(2);
    expect(JSON.stringify(resultado)).not.toContain("9007199254740992");
  });

  it("una ristra de dígitos que no cabe en el mensaje se resume, sin lanzar", () => {
    const digitos = "9".repeat(80);
    const resultado = importarCsvSkus(`sku,cantidad_inicial\nSKU-1,${digitos}`);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores[0]?.columna).toBe("cantidad_inicial");
    expect(resultado.errores[0]?.mensaje).toContain("80 dígitos");
    expect(resultado.errores[0]?.mensaje).not.toContain(digitos);
  });
});

describe("importarCsvSkus — filas lógicas (comillas con salto de línea) y encabezado", () => {
  it("un campo entre comillas con \\n sigue en la misma fila, y la fila siguiente conserva su numeroFila lógico", () => {
    const csv = 'sku,nombre,bodega,cantidad_inicial\nSKU-001,"Producto con\nsalto de linea",Bodega 1,2\n,Sin SKU,Bodega 1,1\n';
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([{ sku: "SKU-001", nombre: "Producto con\nsalto de linea", bodega: "Bodega 1", cantidadInicial: 2 }]);
    // Líneas físicas: 1 encabezado, 2-3 el campo citado, 4 el SKU vacío.
    // Fila lógica del error: 3 (encabezado, fila citada, fila sin SKU).
    expect(resultado.errores).toEqual([{ numeroFila: 3, columna: "sku", mensaje: "El SKU es obligatorio y quedó vacío." }]);
  });

  it("un campo entre comillas con \\r\\n y comillas dobladas escapadas queda en una sola fila", () => {
    const csv = 'sku,nombre,bodega,cantidad_inicial\r\nSKU-001,"linea ""uno""\r\nlinea dos",Bodega 1,4\r\nSKU-002,Siguiente,Bodega 2,5\r\n';
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas).toEqual([
      { sku: "SKU-001", nombre: 'linea "uno"\r\nlinea dos', bodega: "Bodega 1", cantidadInicial: 4 },
      { sku: "SKU-002", nombre: "Siguiente", bodega: "Bodega 2", cantidadInicial: 5 },
    ]);
  });

  it("un salto dentro de comillas no parte un campo que también trae el delimitador", () => {
    const csv = 'sku,nombre,bodega,cantidad_inicial\nSKU-001,"Producto, con\ncoma y salto",Bodega 1,6\n';
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas[0]?.nombre).toBe("Producto, con\ncoma y salto");
  });

  it("una comilla sin cerrar no convierte el resto del archivo en otra fila válida", () => {
    const csv = 'sku,nombre,bodega,cantidad_inicial\nSKU-001,"sin cerrar\nSKU-002,Otro producto,Bodega 1,1\n';
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.filas.some((f) => f.sku === "SKU-002")).toBe(false);
  });

  it("el encabezado es la primera fila lógica no vacía, no la línea 1 si está en blanco", () => {
    const csv = "\n\nsku,nombre,bodega,cantidad_inicial\nSKU-001,Producto,Bodega 1,5\n";
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas).toEqual([{ sku: "SKU-001", nombre: "Producto", bodega: "Bodega 1", cantidadInicial: 5 }]);
  });

  it("líneas en blanco o con solo espacios antes del encabezado cuentan en el numeroFila lógico", () => {
    const csv = "\n   \nsku,nombre,bodega,cantidad_inicial\n,Producto sin SKU,Bodega 1,1\n";
    const resultado = importarCsvSkus(csv);
    // Fila 1 vacía, fila 2 solo espacios, fila 3 encabezado, fila 4 datos.
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores).toEqual([{ numeroFila: 4, columna: "sku", mensaje: "El SKU es obligatorio y quedó vacío." }]);
  });

  it("si el encabezado no está en la fila 1, el error de columna faltante usa esa fila lógica", () => {
    const csv = "\nnombre,bodega\nProducto,Bodega 1\n";
    const resultado = importarCsvSkus(csv);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores.map((e) => e.numeroFila)).toEqual([2, 2]);
    expect(resultado.errores.map((e) => e.columna).sort()).toEqual(["cantidad_inicial", "sku"]);
  });

  it("un salto de línea suelto (CR) entre filas sigue siendo separador de fila", () => {
    const csv = "sku,nombre,bodega,cantidad_inicial\rSKU-001,Producto,Bodega 1,8\r";
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas).toEqual([{ sku: "SKU-001", nombre: "Producto", bodega: "Bodega 1", cantidadInicial: 8 }]);
  });

  it("un punto y coma dentro de un encabezado entre comillas no cambia el delimitador coma", () => {
    const csv = 'sku,"nota; interna",nombre,bodega,cantidad_inicial\nSKU-1,ignorada,Producto,Bodega 1,2\n';
    const resultado = importarCsvSkus(csv);
    expect(resultado.errores).toEqual([]);
    expect(resultado.filas).toEqual([{ sku: "SKU-1", nombre: "Producto", bodega: "Bodega 1", cantidadInicial: 2 }]);
    expect(resultado.resumen.columnasIgnoradas).toEqual(["nota; interna"]);
  });
});
