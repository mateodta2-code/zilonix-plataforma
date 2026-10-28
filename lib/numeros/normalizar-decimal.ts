// Issue #254 — un solo lugar para pasar de texto (API JSON o CSV
// colombiano) a un decimal que Postgres `numeric` acepta. No usa
// parseFloat ni Number: un float pierde centavos.
//
// Acepta `1234.56` y `1.234,56`. Si las dos lecturas son posibles
// (`1.234` puede ser mil doscientos treinta y cuatro o uno con tres
// decimales) rechaza, salvo que quien llama pida el contexto COP sin
// decimales (api-research §9).

export class DecimalInvalidoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "DecimalInvalidoError";
  }
}

export type OpcionesDecimal = {
  // Moneda sin decimales: `1.234` y `1,234` son miles. Cualquier otro
  // caso ambiguo sigue rechazado.
  copSinDecimales?: boolean;
  // El texto salió de JSON.stringify de un número. El punto es decimal
  // siempre (`1.005` son milésimas, no miles). JSON no usa coma.
  origenJson?: boolean;
};

export function normalizarDecimal(entrada: string, opciones?: OpcionesDecimal): string {
  if (typeof entrada !== "string") throw new DecimalInvalidoError("no es texto");
  const s = entrada.trim();
  if (!s) throw new DecimalInvalidoError("vacío");
  if (!/^-?\d[\d.,]*$/.test(s) || /[.,]{2}/.test(s)) throw new DecimalInvalidoError("texto");

  const negativo = s.startsWith("-");
  const cuerpo = negativo ? s.slice(1) : s;
  if (!cuerpo || cuerpo.startsWith(".") || cuerpo.startsWith(",") || cuerpo.endsWith(".") || cuerpo.endsWith(",")) {
    throw new DecimalInvalidoError("separador suelto");
  }

  const tienePunto = cuerpo.includes(".");
  const tieneComa = cuerpo.includes(",");
  let entero = "";
  let fraccion = "";

  if (opciones?.origenJson) {
    if (tieneComa) throw new DecimalInvalidoError("texto");
    const partes = tienePunto ? cuerpo.split(".") : [cuerpo];
    if (partes.length > 2) throw new DecimalInvalidoError("texto");
    const [izq, der = ""] = partes;
    if (!/^\d+$/.test(izq) || (der !== "" && !/^\d+$/.test(der))) {
      throw new DecimalInvalidoError("fracción inválida");
    }
    entero = izq;
    fraccion = der;
  } else if (tienePunto && tieneComa) {
    const ultimoPunto = cuerpo.lastIndexOf(".");
    const ultimaComa = cuerpo.lastIndexOf(",");
    const decimalEsComa = ultimaComa > ultimoPunto;
    const separadorDecimal = decimalEsComa ? "," : ".";
    const separadorMiles = decimalEsComa ? "." : ",";
    const corte = cuerpo.lastIndexOf(separadorDecimal);
    entero = sinMiles(cuerpo.slice(0, corte), separadorMiles);
    fraccion = cuerpo.slice(corte + 1);
    if (!/^\d+$/.test(fraccion)) throw new DecimalInvalidoError("fracción inválida");
  } else if (tienePunto || tieneComa) {
    const separador = tienePunto ? "." : ",";
    const partes = cuerpo.split(separador);
    if (partes.length > 2) {
      if (!partes.every((p, i) => /^\d+$/.test(p) && (i === 0 ? p.length >= 1 && p.length <= 3 : p.length === 3))) {
        throw new DecimalInvalidoError("miles inválidos");
      }
      entero = partes.join("");
    } else {
      const [izq, der] = partes;
      if (!/^\d+$/.test(izq) || !/^\d+$/.test(der)) throw new DecimalInvalidoError("texto");
      if (der.length === 3) {
        if (!opciones?.copSinDecimales) throw new DecimalInvalidoError("ambiguo");
        entero = izq + der;
      } else {
        entero = izq;
        fraccion = der;
      }
    }
  } else {
    entero = cuerpo;
  }

  entero = entero.replace(/^0+(?=\d)/, "");
  const signo = negativo ? "-" : "";
  return fraccion ? `${signo}${entero}.${fraccion}` : `${signo}${entero}`;
}

function sinMiles(texto: string, separador: "." | ","): string {
  if (!texto.includes(separador)) {
    if (!/^\d+$/.test(texto)) throw new DecimalInvalidoError("miles inválidos");
    return texto;
  }
  const partes = texto.split(separador);
  if (!partes.every((p, i) => /^\d+$/.test(p) && (i === 0 ? p.length >= 1 && p.length <= 3 : p.length === 3))) {
    throw new DecimalInvalidoError("miles inválidos");
  }
  return partes.join("");
}

// Recorta o rellena la fracción a `escala` posiciones con enteros, sin
// float. A partir del dígito siguiente, 5 o más sube uno.
export function aEscala(decimal: string, escala: number, opciones?: OpcionesDecimal): string {
  if (!Number.isInteger(escala) || escala < 0 || escala > 6) throw new DecimalInvalidoError("escala inválida");
  const normal = normalizarDecimal(decimal, opciones);
  const negativo = normal.startsWith("-");
  const [enteroTxt, fraccionTxt = ""] = (negativo ? normal.slice(1) : normal).split(".");
  const cero = BigInt(0);
  const uno = BigInt(1);
  let entero = BigInt(enteroTxt);
  if (escala === 0) {
    if (fraccionTxt[0] >= "5") entero += uno;
    return `${negativo && entero !== cero ? "-" : ""}${entero}`;
  }
  const base = fraccionTxt.slice(0, escala).padEnd(escala, "0");
  let fraccion = BigInt(base);
  const unidad = BigInt(10) ** BigInt(escala);
  if (fraccionTxt[escala] >= "5") fraccion += uno;
  if (fraccion >= unidad) {
    fraccion -= unidad;
    entero += uno;
  }
  const signo = negativo && (entero !== cero || fraccion !== cero) ? "-" : "";
  return `${signo}${entero}.${fraccion.toString().padStart(escala, "0")}`;
}

// numeric(precision, escala) rechaza con 22003 si la parte entera no
// entra. Se mira el texto ya escalado, sin float.
export function cabeEnNumeric(escalado: string, precision: number, escala: number): boolean {
  if (!Number.isInteger(precision) || !Number.isInteger(escala) || escala < 0 || precision <= escala) return false;
  const cuerpo = escalado.startsWith("-") ? escalado.slice(1) : escalado;
  const [entero = "0"] = cuerpo.split(".");
  const digitos = entero.replace(/^0+/, "");
  return digitos.length <= precision - escala;
}

// JSON.stringify de un número chico sale en notación científica
// (`1e-7`). Se expande con los dígitos del texto, sin pasar por float.
function expandirCientifico(texto: string): string {
  const partes = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(texto);
  if (!partes) return texto;
  const signo = partes[1];
  const crudo = `${partes[2]}${partes[3] ?? ""}`;
  const pos = partes[2].length + Number(partes[4]);
  if (pos <= 0) return `${signo}0.${"0".repeat(-pos)}${crudo}`;
  if (pos >= crudo.length) return `${signo}${crudo}${"0".repeat(pos - crudo.length)}`;
  return `${signo}${crudo.slice(0, pos)}.${crudo.slice(pos)}`;
}

// Un número que ya vino de JSON.parse. JSON.stringify lo devuelve en el
// mismo texto corto con el que JSON lo acepta (`3992`, `25.58`), sin
// pasar por toFixed.
export function textoDeNumeroJson(valor: number): string {
  if (!Number.isFinite(valor)) throw new DecimalInvalidoError("no es un número");
  const texto = expandirCientifico(JSON.stringify(valor));
  if (!/^-?\d+(\.\d+)?$/.test(texto)) throw new DecimalInvalidoError("número no decimal");
  return texto;
}
