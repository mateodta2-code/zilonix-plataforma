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

// numeroFila es el índice 1-based de la fila LÓGICA, no de la línea
// física. Una fila lógica es un registro CSV (RFC 4180): un salto de
// línea (\n, \r\n o \r) dentro de un campo entre comillas no abre otra
// fila, y el número que se reporta es el de ese registro completo.
//
// Se cuenta desde el principio del archivo, incluidas las filas lógicas
// en blanco. El encabezado es la primera fila lógica no vacía, pero su
// numeroFila es su posición real: si hay dos líneas en blanco antes, el
// encabezado es la fila 3 y la primera fila de datos es la 4. Si el
// archivo empieza por el encabezado (el caso de la plantilla), el
// encabezado es la fila 1 y la primera fila de datos es la 2 — el mismo
// número que muestra Excel al abrir el CSV, porque Excel también deja
// en una sola celda el campo que trae un salto de línea adentro.
// Un salto de línea al final del archivo no crea una fila vacía extra.
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

// 5 MB de UTF-8. Por encima de eso el archivo se rechaza entero, antes
// de tokenizar: un CSV de catálogo cabe holgado y el tope corta un
// pegado enorme sin recorrer millones de caracteres. El límite es en
// bytes (no en el .length de JS, que cuenta unidades UTF-16): "á" pesa
// 2 bytes y tiene que contar como 2.
export const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024;

// Máximo de filas lógicas del archivo entero: encabezado, filas en
// blanco y filas de datos. Un campo entre comillas con saltos de línea
// cuenta como una sola. 20.000 cubre un catálogo grande; pasarse es un
// rechazo del archivo completo (no se devuelven filas parciales — un
// import a medias dejaría el stock a medias).
export const FILAS_MAXIMAS = 20_000;

// Tope de negocio de cantidad_inicial, por fila. Un stock inicial de
// más de un millón de unidades de un solo SKU se trata como error de
// datos de este importador, no como un número a guardar. Queda muy por
// debajo de Number.MAX_SAFE_INTEGER (9_007_199_254_740_991): Number()
// deja de ser exacto por encima de ese valor y un dígito de más se
// redondearía en silencio. Tiene que seguir siendo un entero >= 0 y
// <= Number.MAX_SAFE_INTEGER, para que String(tope) sea su decimal
// plano y el valor que se guarda sea exacto. 1.000.000 entra; 1.000.001
// no.
export const CANTIDAD_INICIAL_MAXIMA = 1_000_000;

const ENCABEZADOS_OBLIGATORIOS = ["sku", "cantidad_inicial"] as const;
const ENCABEZADOS_OPCIONALES = ["nombre", "bodega"] as const;
const ENCABEZADOS_CONOCIDOS = new Set<string>([...ENCABEZADOS_OBLIGATORIOS, ...ENCABEZADOS_OPCIONALES]);

function resumenSinFilas(): ResumenImportacionCsv {
  return { validas: 0, conError: 0, skusRepetidos: [], columnasIgnoradas: [] };
}

// BOM de Excel (U+FEFF) al principio del archivo — Excel lo agrega
// solo al exportar CSV como "UTF-8 con BOM"; si no se quita, el primer
// encabezado (normalmente "sku") nunca hace match.
export function quitarBom(texto: string): string {
  return texto.length > 0 && texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

// UTF-8. Si el string ya es más largo que el tope, cada unidad pesa al
// menos un byte y no hace falta codificar (un archivo de decenas de MB
// no debería asignar otro buffer del mismo tamaño solo para medirlo).
export function excedeTamanoMaximo(texto: string): boolean {
  if (texto.length > TAMANO_MAXIMO_BYTES) return true;
  return new TextEncoder().encode(texto).length > TAMANO_MAXIMO_BYTES;
}

// Coma o punto y coma — se detecta mirando la fila lógica de encabezado.
// Solo cuenta un ";" fuera de comillas: uno adentro de un campo citado
// es texto (si no, un encabezado separado por comas con un ";" citado
// se leería como si el delimitador fuera ";" y toda la fila quedaría
// en una sola columna).
export function detectarDelimitador(lineaEncabezado: string): string {
  let dentroDeComillas = false;
  for (let i = 0; i < lineaEncabezado.length; i++) {
    const c = lineaEncabezado[i];
    if (c === '"') {
      if (dentroDeComillas && lineaEncabezado[i + 1] === '"') {
        i++;
        continue;
      }
      dentroDeComillas = !dentroDeComillas;
      continue;
    }
    if (!dentroDeComillas && c === ";") return ";";
  }
  return ",";
}

type FilaLogica = { raw: string; numeroFila: number };

// Parte el texto en filas lógicas SIN interpretar columnas todavía.
// Dentro de comillas, \n, \r\n y \r son parte del campo; "" es una
// comilla escapada y no cierra el campo. Fuera de comillas, \r\n es un
// solo separador de fila (no dos). Si el archivo se pasa de
// FILAS_MAXIMAS se corta ahí y se devuelve la fila que ya no cabe — no
// se sigue leyendo ni se lanza.
export function partirFilasLogicas(texto: string): { ok: true; filas: FilaLogica[] } | { ok: false; numeroFila: number } {
  const filas: FilaLogica[] = [];
  let inicio = 0;
  let numeroFila = 1;
  let dentroDeComillas = false;
  let i = 0;

  const cerrar = (fin: number): boolean => {
    if (filas.length >= FILAS_MAXIMAS) return false;
    filas.push({ raw: texto.slice(inicio, fin), numeroFila });
    numeroFila++;
    return true;
  };

  while (i < texto.length) {
    const c = texto[i];
    if (dentroDeComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          i += 2;
          continue;
        }
        dentroDeComillas = false;
      }
      i++;
      continue;
    }
    if (c === '"') {
      dentroDeComillas = true;
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (!cerrar(i)) return { ok: false, numeroFila };
      if (c === "\r" && texto[i + 1] === "\n") i += 2;
      else i += 1;
      inicio = i;
      continue;
    }
    i++;
  }

  // Sin salto final no hay fila vacía de más (RFC 4180). Un archivo
  // vacío sí es una fila, para poder decir que le falta el encabezado.
  if (inicio < texto.length || filas.length === 0) {
    if (!cerrar(texto.length)) return { ok: false, numeroFila };
  }
  return { ok: true, filas };
}

// Separador de campos de UNA fila lógica ya partida (puede traer saltos
// de línea adentro de un campo citado: esos ya no separan filas). Un
// campo entre comillas puede contener el delimitador, y "" dentro de
// comillas es una comilla literal escapada (RFC 4180).
export function separarCamposCsv(linea: string, delimitador: string): string[] {
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
// "007" son válidos; "10.5", "-3", "10,5", "abc", "" no lo son. El tope
// no vive en el patrón: un \d+ de 30 dígitos haría match y Number() lo
// redondearía. Se compara el decimal sin ceros a la izquierda contra
// el tope, como texto, para no perder precisión.
const PATRON_ENTERO_NO_NEGATIVO = /^\d+$/;

function cantidadCabeEnElTope(digitos: string): boolean {
  const sinCeros = digitos.replace(/^0+/, "") || "0";
  const tope = String(CANTIDAD_INICIAL_MAXIMA);
  if (sinCeros.length !== tope.length) return sinCeros.length < tope.length;
  return sinCeros <= tope;
}

function mostrarCantidad(cantidadCruda: string): string {
  // Una celda puede traer millones de dígitos (el archivo llega hasta
  // 5 MB). El mensaje no repite ese texto: alcanza con ver el principio
  // y cuántos dígitos eran.
  if (cantidadCruda.length <= 40) return cantidadCruda;
  return `${cantidadCruda.slice(0, 20)}… (${cantidadCruda.length} dígitos)`;
}

function rechazoDeArchivo(numeroFila: number, mensaje: string): ResultadoImportarCsvSkus {
  return {
    filas: [],
    errores: [{ numeroFila, columna: "archivo", mensaje }],
    resumen: resumenSinFilas(),
  };
}

function erroresDeEncabezado(numeroFila: number, faltantes: readonly string[]): ResultadoImportarCsvSkus {
  return {
    filas: [],
    errores: faltantes.map((h) => ({
      numeroFila,
      columna: h,
      mensaje: `Falta la columna obligatoria "${h}" en el encabezado — revisa que el archivo use la plantilla de Zilonix (sku, nombre, bodega, cantidad_inicial).`,
    })),
    resumen: resumenSinFilas(),
  };
}

export function importarCsvSkus(textoCsv: string): ResultadoImportarCsvSkus {
  if (excedeTamanoMaximo(textoCsv)) {
    return rechazoDeArchivo(
      1,
      `El archivo supera el tamaño máximo de ${TAMANO_MAXIMO_BYTES / (1024 * 1024)} MB (${TAMANO_MAXIMO_BYTES} bytes).`
    );
  }

  const texto = quitarBom(textoCsv);
  const particion = partirFilasLogicas(texto);
  if (!particion.ok) {
    return rechazoDeArchivo(
      particion.numeroFila,
      `El archivo supera el máximo de ${FILAS_MAXIMAS} filas lógicas. Divide el CSV y vuelve a importarlo.`
    );
  }

  // Primera fila lógica no vacía = encabezado. Una o varias filas en
  // blanco al principio (línea vacía o solo espacios) no son encabezado:
  // Excel las deja y el export a veces también. Una fila de comas
  // (",,,") no está vacía — es una fila de campos vacíos y se interpreta
  // como encabezado, que va a fallar por columnas faltantes.
  const filaEncabezado = particion.filas.find((f) => f.raw.trim() !== "");
  if (!filaEncabezado) {
    return erroresDeEncabezado(1, ENCABEZADOS_OBLIGATORIOS);
  }

  const delimitador = detectarDelimitador(filaEncabezado.raw);
  const encabezadosCrudos = separarCamposCsv(filaEncabezado.raw, delimitador);
  const encabezadosNormalizados = encabezadosCrudos.map((h) => h.trim().toLowerCase());

  const indicePorEncabezado = new Map<string, number>();
  encabezadosNormalizados.forEach((h, i) => {
    if (h && !indicePorEncabezado.has(h)) indicePorEncabezado.set(h, i);
  });

  const encabezadosFaltantes = ENCABEZADOS_OBLIGATORIOS.filter((h) => !indicePorEncabezado.has(h));
  if (encabezadosFaltantes.length > 0) {
    // Falta un encabezado obligatorio: error general, ninguna fila
    // válida — no tiene sentido intentar leer filas de datos sin saber
    // en qué columna está el SKU o la cantidad. numeroFila es la de la
    // fila lógica del encabezado, no siempre 1.
    return erroresDeEncabezado(filaEncabezado.numeroFila, encabezadosFaltantes);
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

  for (const fila of particion.filas) {
    if (fila.numeroFila <= filaEncabezado.numeroFila) continue;
    const numeroFila = fila.numeroFila;
    const campos = separarCamposCsv(fila.raw, delimitador);
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
    } else if (!cantidadCabeEnElTope(cantidadCruda)) {
      errores.push({
        numeroFila,
        columna: "cantidad_inicial",
        mensaje: `"${mostrarCantidad(cantidadCruda)}" supera el máximo de ${CANTIDAD_INICIAL_MAXIMA} unidades por fila — la cantidad inicial tiene que ser un entero entre 0 y ${CANTIDAD_INICIAL_MAXIMA}.`,
      });
      filaValida = false;
    } else {
      const sinCeros = cantidadCruda.replace(/^0+/, "") || "0";
      cantidadInicial = Number(sinCeros);
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
