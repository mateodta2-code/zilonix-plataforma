// Issue #58 (Z-ML-09) — SOLO el parser puro. La pantalla (vista previa
// con errores por fila antes de confirmar) y la escritura en base
// (crear/actualizar SKUs + movimiento "importacion" de stock inicial)
// esperan al #57 (Z-ML-06) — acá no se toca Postgres ni ninguna tabla.
//
// Formato que cubre este archivo: la plantilla PROPIA de Zilonix
// (encabezados fijos sku, nombre, bodega, cantidad_inicial). El issue
// real también menciona la exportación del Zilonix OS actual
// (`/api/inventario-recompras/exportar`) o de Fulfy como fuente
// posible para Mateo — esas quedan fuera de este archivo a propósito:
// sus columnas reales no están confirmadas todavía (el propio issue
// pide "un fixture anonimizado de las columnas reales que pase Mateo"
// antes de poder portarlas sin adivinar).
//
// Nunca devuelve una acción de borrar: el tipo de fila válida no tiene
// ningún campo "accion" — decidir si una fila crea o actualiza un SKU
// necesita mirar la base (si el sku ya existe), algo que este parser
// puro no hace ni debe hacer. Eso es trabajo del #57.

export type FilaSkuValida = {
  sku: string;
  nombre?: string;
  bodega?: string;
  cantidadInicial: number;
};

// numeroFila es 1-indexado y cuenta el encabezado como fila 1 — igual
// que al abrir el CSV en Excel y mirar el número de fila real. La
// primera fila de datos es la fila 2.
export type ErrorFilaCsv = {
  numeroFila: number;
  columna: string;
  mensaje: string;
};

export type ResumenImportacionCsv = {
  validas: number;
  conError: number;
  skusRepetidos: string[];
  // Nombres de columnas de más que trajo el archivo (ni sku, nombre,
  // bodega ni cantidad_inicial) — se ignoran al construir las filas,
  // nunca hacen fallar el archivo completo, pero quedan avisadas acá.
  columnasIgnoradas: string[];
};

export type ResultadoImportarCsvSkus = {
  filas: FilaSkuValida[];
  errores: ErrorFilaCsv[];
  resumen: ResumenImportacionCsv;
};

const ENCABEZADOS_OBLIGATORIOS = ["sku", "cantidad_inicial"] as const;
const ENCABEZADOS_OPCIONALES = ["nombre", "bodega"] as const;
const ENCABEZADOS_CONOCIDOS = new Set<string>([...ENCABEZADOS_OBLIGATORIOS, ...ENCABEZADOS_OPCIONALES]);

// BOM de Excel (U+FEFF) al principio del archivo — Excel lo agrega
// solo al exportar CSV como "UTF-8 con BOM"; si no se quita, el primer
// encabezado (normalmente "sku") nunca hace match.
function quitarBom(texto: string): string {
  return texto.length > 0 && texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

// Coma o punto y coma — se detecta mirando la fila de encabezado: si
// trae un punto y coma en algún lado, es el delimitador real (patrón
// típico de un CSV exportado por Excel en configuración regional
// donde la coma es el separador decimal); si no, coma.
function detectarDelimitador(lineaEncabezado: string): string {
  return lineaEncabezado.includes(";") ? ";" : ",";
}

// Separador de línea propio (no un simple .split(delimitador)): un
// campo entre comillas puede contener el delimitador sin que cuente
// como separación real, y "" dentro de un campo entre comillas es una
// comilla literal escapada (regla real de CSV, RFC 4180).
function separarLineaCsv(linea: string, delimitador: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let dentroDeComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (dentroDeComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') {
          actual += '"';
          i++; // salta la segunda comilla del escape
        } else {
          dentroDeComillas = false;
        }
      } else {
        actual += c;
      }
    } else if (c === '"') {
      dentroDeComillas = true;
    } else if (c === delimitador) {
      campos.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos;
}

// Una fila sin ningún dato real (ni siquiera espacios) — filas vacías
// al final del archivo son el caso real que pide el issue (Excel casi
// siempre deja una al guardar), pero esto las detecta en cualquier
// posición: una fila sin ningún campo con contenido no tiene nada que
// validar de todos modos, así que ignorarla siempre es seguro.
function esFilaEnBlanco(campos: string[]): boolean {
  return campos.every((c) => c.trim() === "");
}

// Entero no negativo, sin decimales, sin signo, sin texto — "10", "0",
// "007" son válidos; "10.5", "-3", "10,5", "abc", "" no lo son.
const PATRON_ENTERO_NO_NEGATIVO = /^\d+$/;

export function importarCsvSkus(textoCsv: string): ResultadoImportarCsvSkus {
  const texto = quitarBom(textoCsv);
  const lineas = texto.split(/\r\n|\r|\n/);

  // Primera línea no vacía = encabezado (una fila 1 en blanco no
  // debería pasar en la práctica, pero si pasara, no hay nada que
  // interpretar como encabezado real).
  const lineaEncabezado = lineas[0] ?? "";
  const delimitador = detectarDelimitador(lineaEncabezado);
  const encabezadosCrudos = separarLineaCsv(lineaEncabezado, delimitador);
  const encabezadosNormalizados = encabezadosCrudos.map((h) => h.trim().toLowerCase());

  const indicePorEncabezado = new Map<string, number>();
  encabezadosNormalizados.forEach((h, i) => {
    if (h && !indicePorEncabezado.has(h)) indicePorEncabezado.set(h, i);
  });

  const encabezadosFaltantes = ENCABEZADOS_OBLIGATORIOS.filter((h) => !indicePorEncabezado.has(h));
  if (encabezadosFaltantes.length > 0) {
    // Falta un encabezado obligatorio: error general, ninguna fila
    // válida — no tiene sentido intentar leer filas de datos sin saber
    // en qué columna está el SKU o la cantidad.
    return {
      filas: [],
      errores: encabezadosFaltantes.map((h) => ({
        numeroFila: 1,
        columna: h,
        mensaje: `Falta la columna obligatoria "${h}" en el encabezado — revisa que el archivo use la plantilla de Zilonix (sku, nombre, bodega, cantidad_inicial).`,
      })),
      resumen: { validas: 0, conError: 0, skusRepetidos: [], columnasIgnoradas: [] },
    };
  }

  const columnasIgnoradas = encabezadosNormalizados.filter((h) => h && !ENCABEZADOS_CONOCIDOS.has(h));

  const indiceSku = indicePorEncabezado.get("sku")!;
  const indiceCantidad = indicePorEncabezado.get("cantidad_inicial")!;
  const indiceNombre = indicePorEncabezado.get("nombre");
  const indiceBodega = indicePorEncabezado.get("bodega");

  const errores: ErrorFilaCsv[] = [];
  // Candidatas = filas que pasaron su propia validación de campo a
  // campo (antes de revisar SKUs repetidos entre filas distintas).
  const candidatas: { numeroFila: number; sku: string; nombre?: string; bodega?: string; cantidadInicial: number }[] = [];
  // Todo sku no vacío de CUALQUIER fila de datos (tenga o no otros
  // errores) — un sku repetido es un problema real sin importar si
  // una de las dos filas además tiene la cantidad mal escrita.
  const filasPorSku = new Map<string, number[]>();

  for (let i = 1; i < lineas.length; i++) {
    const numeroFila = i + 1; // 1-indexado, encabezado ya es la fila 1
    const campos = separarLineaCsv(lineas[i], delimitador);
    if (esFilaEnBlanco(campos)) continue;

    const skuCrudo = (campos[indiceSku] ?? "").trim();
    const cantidadCruda = (campos[indiceCantidad] ?? "").trim();
    const nombreCrudo = indiceNombre !== undefined ? (campos[indiceNombre] ?? "").trim() : "";
    const bodegaCruda = indiceBodega !== undefined ? (campos[indiceBodega] ?? "").trim() : "";

    let filaValida = true;

    if (!skuCrudo) {
      errores.push({ numeroFila, columna: "sku", mensaje: "El SKU es obligatorio y quedó vacío." });
      filaValida = false;
    } else {
      const lista = filasPorSku.get(skuCrudo) ?? [];
      lista.push(numeroFila);
      filasPorSku.set(skuCrudo, lista);
    }

    let cantidadInicial = 0;
    if (!PATRON_ENTERO_NO_NEGATIVO.test(cantidadCruda)) {
      errores.push({
        numeroFila,
        columna: "cantidad_inicial",
        mensaje: `"${cantidadCruda || "(vacío)"}" no es una cantidad válida — tiene que ser un número entero igual o mayor a 0, sin decimales ni signo.`,
      });
      filaValida = false;
    } else {
      cantidadInicial = Number(cantidadCruda);
    }

    if (filaValida && skuCrudo) {
      candidatas.push({
        numeroFila,
        sku: skuCrudo,
        nombre: nombreCrudo || undefined,
        bodega: bodegaCruda || undefined,
        cantidadInicial,
      });
    }
  }

  // SKUs repetidos: cualquier sku que aparezca en más de una fila es
  // error en TODAS esas filas, nunca solo en la segunda — ninguna de
  // las dos puede saber por sí sola cuál es "la correcta".
  const skusRepetidos: string[] = [];
  for (const [sku, filasConEseSku] of filasPorSku) {
    if (filasConEseSku.length > 1) {
      skusRepetidos.push(sku);
      for (const numeroFila of filasConEseSku) {
        errores.push({
          numeroFila,
          columna: "sku",
          mensaje: `El SKU "${sku}" está repetido en las filas ${filasConEseSku.join(", ")} — no se puede saber cuál es la correcta.`,
        });
      }
    }
  }
  skusRepetidos.sort();

  const filasConSkuRepetido = new Set(skusRepetidos);
  const filas = candidatas
    .filter((c) => !filasConSkuRepetido.has(c.sku))
    .map(({ numeroFila: _numeroFila, ...fila }) => fila);

  const filasConError = new Set(errores.map((e) => e.numeroFila));

  return {
    filas,
    errores,
    resumen: {
      validas: filas.length,
      conError: filasConError.size,
      skusRepetidos,
      columnasIgnoradas,
    },
  };
}

// Plantilla propia de Zilonix (encabezados + 2 filas de ejemplo con
// datos inventados, nunca reales) — para que la pantalla del #57 la
// ofrezca para descargar antes de pedirle a nadie que suba un CSV a
// ciegas. Separador coma: es el que generamos nosotros, nuestro propio
// parser acepta los dos de todos modos.
export function generarPlantillaCsvSkus(): string {
  const encabezado = "sku,nombre,bodega,cantidad_inicial";
  const filaEjemplo1 = "SKU-DEMO-001,Camiseta azul talla M,Bodega Principal,25";
  const filaEjemplo2 = "SKU-DEMO-002,Gorra negra,,10";
  return [encabezado, filaEjemplo1, filaEjemplo2].join("\n") + "\n";
}
