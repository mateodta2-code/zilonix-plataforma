import { createHash } from "crypto";
import type { CategoriaMovimiento } from "@/db/schema";
import { leerXlsx, type Celda, type FilaArchivo } from "@/lib/importar-archivo";

// Issue #422 — conciliación de pagos de Falabella. La API no da pagos
// (E008 en GetPayoutStatus y GetTransactionDetails, PRs #469 y #470), así
// que la fuente es el «Reporte de transacciones» que se descarga en
// Seller Center → Pagos → Estado de cuenta (por corte o por periodo).
//
// Formato real visto (corte FACO-SC0170C-20261111-COP): hoja «Reporte
// Transacciones», filas 1 a 5 de título y grupos, encabezado en la fila
// 6. Las columnas se buscan por NOMBRE, nunca por posición: Falabella ya
// agrupa columnas con filas de título y puede moverlas.
//
// Solo lee: no toca la base ni sabe de empresas. La importación vive en
// lib/falabella/conciliacion.ts.

export const HOJA_REPORTE = "REPORTE TRANSACCIONES";
// El encabezado real está en la fila 6; se busca en las primeras 20 por
// si Falabella agrega o quita una fila de título.
const FILAS_MAXIMAS_ANTES_DEL_ENCABEZADO = 20;

// Nombre de columna → campo. Las claves ya van normalizadas (ver
// normalizarEncabezado): «Nº de orden» y «N° Documento Tributario»
// quedan como «no de orden» y «no documento tributario».
const COLUMNAS = {
  numeroOrden: "no de orden",
  sku: "sku vendedor",
  idArticulo: "id articulo",
  tipoTransaccion: "tipo de transaccion",
  fechaTransaccion: "fecha de transaccion",
  divisa: "divisa",
  montoSinIva: "monto (sin iva)",
  iva: "iva",
  montoConIva: "monto con iva",
  estadoPago: "estado de pago",
  estadoCuenta: "no estado de cuenta",
  referenciaPago: "referencia de pago fpay",
  documentoTributario: "no documento tributario",
  sellerId: "seller id",
  categoriaReporte: "categoria de transacciones",
} as const;
type CampoReporte = keyof typeof COLUMNAS;

const OBLIGATORIAS: CampoReporte[] = ["tipoTransaccion", "montoConIva", "divisa", "sellerId"];

export type LineaReporte = {
  numeroFila: number;
  sellerId: string;
  numeroOrden: string | null;
  sku: string | null;
  idArticulo: string | null;
  tipoTransaccion: string;
  categoria: CategoriaMovimiento;
  moneda: string;
  montoSinIva: string | null;
  iva: string | null;
  // Siempre «Monto con IVA»: es lo que suma al pago (hay líneas sin
  // monto sin IVA ni IVA).
  monto: string;
  fechaTransaccion: string | null;
  estadoPago: string | null;
  estadoCuenta: string | null;
  referenciaPago: string | null;
  documentoTributario: string | null;
  huella: string;
};

export type LineaNoReconocida = { numeroFila: number; motivo: string };

export type ReporteLeido =
  | { ok: true; lineas: LineaReporte[]; noReconocidas: LineaNoReconocida[]; sellerIds: string[] }
  | { ok: false; mensaje: string };

export function normalizarEncabezado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[º°]/g, "o")
    .replace(/\bn\.?o?\.?\s/g, "no ")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textoCelda(celda: Celda | undefined): string | null {
  if (!celda || celda.tipo === "vacia") return null;
  const texto = celda.valor.trim();
  return texto === "" ? null : texto;
}

// ---------- Montos ----------

// 4 decimales, como movimientos_marketplace.monto (numeric(16,4)).
const DECIMALES = 4;
const ESCALA = BigInt(10) ** BigInt(DECIMALES);
const MAX_DIGITOS_ENTEROS = 12;

// Texto decimal con signo → unidades de 1/10000, redondeando la mitad
// lejos de cero. Nunca pasa por Number: la suma del corte tiene que dar
// exacto el «Pago a recibir».
export function aDiezmilesimas(decimal: string): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!m) return null;
  const [, signo, entero, fraccion = ""] = m;
  const limpio = entero.replace(/^0+(?=\d)/, "");
  if (limpio.length > MAX_DIGITOS_ENTEROS) return null;
  let valor = BigInt(limpio + fraccion.slice(0, DECIMALES).padEnd(DECIMALES, "0"));
  if ((fraccion[DECIMALES] ?? "0") >= "5") valor += BigInt(1);
  return signo === "-" ? -valor : valor;
}

export function desdeDiezmilesimas(valor: bigint): string {
  const negativo = valor < BigInt(0);
  const absoluto = (negativo ? -valor : valor).toString().padStart(DECIMALES + 1, "0");
  const entero = absoluto.slice(0, -DECIMALES);
  const fraccion = absoluto.slice(-DECIMALES).replace(/0+$/, "");
  const texto = fraccion ? `${entero}.${fraccion}` : entero;
  return negativo && texto !== "0" ? `-${texto}` : texto;
}

// Celda numérica: ya viene como decimal plano ("-28869", "117830.94").
// Celda de texto: solo los formatos inequívocos, igual que
// lib/falabella/montos.ts — "1234.56", "-1,234.56", "$ -28,869". No se
// adivina "78.000,00" (punto de miles): se rechaza la línea.
const MONTO_TEXTO = /^(-?)(\d+|\d{1,3}(?:,\d{3})+)(\.\d+)?$/;

export function leerMontoReporte(celda: Celda | undefined): { tipo: "vacio" } | { tipo: "monto"; valor: string } | { tipo: "error" } {
  if (!celda || celda.tipo === "vacia") return { tipo: "vacio" };
  let decimal: string;
  if (celda.tipo === "numero") {
    decimal = celda.valor;
  } else {
    const texto = celda.valor.replace(/\s+/g, "").replace(/^(-?)\$/, "$1").replace(/^\$(-?)/, "$1");
    if (texto === "") return { tipo: "vacio" };
    const m = MONTO_TEXTO.exec(texto);
    if (!m) return { tipo: "error" };
    decimal = `${m[1]}${m[2].replace(/,/g, "")}${m[3] ?? ""}`;
  }
  const unidades = aDiezmilesimas(decimal);
  return unidades === null ? { tipo: "error" } : { tipo: "monto", valor: desdeDiezmilesimas(unidades) };
}

// ---------- Fechas ----------

function fechaValida(anio: number, mes: number, dia: number): string | null {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return fecha.toISOString().slice(0, 10);
}

// Fecha guardada como fecha de Excel (número de días desde 1899-12-30) o
// como texto: "AAAA-MM-DD" o "DD/MM/AAAA" (día primero, como en Colombia
// y el resto de Falabella LATAM), con hora opcional que se descarta.
// [SUPUESTO] el reporte real no trae el mes primero; si alguna vez llega
// así, la fecha se rechaza o queda mal: revisar con un reporte real.
export function leerFechaReporte(celda: Celda | undefined): { tipo: "vacio" } | { tipo: "fecha"; valor: string } | { tipo: "error" } {
  if (!celda || celda.tipo === "vacia") return { tipo: "vacio" };
  if (celda.tipo === "numero") {
    const dias = Math.floor(Number(celda.valor));
    if (!Number.isFinite(dias) || dias < 1 || dias > 2958465) return { tipo: "error" };
    const fecha = new Date(Date.UTC(1899, 11, 30) + dias * 86_400_000);
    return { tipo: "fecha", valor: fecha.toISOString().slice(0, 10) };
  }
  const texto = celda.valor.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(texto);
  if (m) {
    const valor = fechaValida(Number(m[1]), Number(m[2]), Number(m[3]));
    return valor ? { tipo: "fecha", valor } : { tipo: "error" };
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s.*)?$/.exec(texto);
  if (m) {
    const valor = fechaValida(Number(m[3]), Number(m[2]), Number(m[1]));
    return valor ? { tipo: "fecha", valor } : { tipo: "error" };
  }
  return { tipo: "error" };
}

// ---------- Categorías ----------

// Categoría normalizada a partir de «Categoría de transacciones» y del
// «Tipo de transacción» (texto original). El orden importa: una
// «Retención ICA» es retención aunque su categoría sea «Impuesto», y un
// cobro de Fulfillment puede mencionar el envío. Lo que no encaja queda
// en «otro» y la importación lo avisa, nunca se descarta.
const REGLAS_CATEGORIA: [CategoriaMovimiento, RegExp][] = [
  ["retencion", /\b(retencion|impuesto|reteica|reteiva|retefuente)/],
  ["publicidad", /\b(publicidad|patrocinad|anuncio)/],
  ["fulfillment", /\b(fulfillment|almacenamiento|bodegaje)/],
  ["comision", /\bcomision/],
  ["envio", /\b(envio|flete|despacho)/],
  ["promocion", /\b(cupon|promocion|descuento)/],
  ["devolucion", /\b(devolucion|reembolso)/],
  ["ajuste", /\b(ajuste|compensacion)/],
  ["precio", /\b(precio|venta)/],
];

export function clasificarCategoria(categoriaReporte: string | null, tipoTransaccion: string): CategoriaMovimiento {
  const textos = [categoriaReporte, tipoTransaccion].filter((t): t is string => Boolean(t)).map(normalizarEncabezado);
  // Primero la categoría que trae el reporte; si no encaja, el tipo.
  for (const texto of textos) {
    for (const [categoria, patron] of REGLAS_CATEGORIA) if (patron.test(texto)) return categoria;
  }
  return "otro";
}

// ---------- Huella ----------

// Datos que identifican la línea, sin el estado de pago ni el estado de
// cuenta: la misma línea aparece en el reporte del periodo (todavía sin
// pagar) y luego en el del corte. `ocurrencia` separa dos líneas
// idénticas del mismo archivo (mismo artículo, mismo cobro, mismo día).
export function calcularHuella(
  linea: Pick<LineaReporte, "sellerId" | "numeroOrden" | "idArticulo" | "sku" | "tipoTransaccion" | "fechaTransaccion" | "monto">,
  ocurrencia: number
): string {
  const datos = JSON.stringify([
    linea.sellerId,
    linea.numeroOrden,
    linea.idArticulo,
    linea.sku,
    linea.tipoTransaccion,
    linea.fechaTransaccion,
    linea.monto,
    ocurrencia,
  ]);
  return createHash("sha256").update(datos).digest("hex");
}

// ---------- Lectura ----------

function buscarEncabezado(filas: FilaArchivo[]): { indice: number; columnas: Partial<Record<CampoReporte, number>> } | null {
  const limite = Math.min(filas.length, FILAS_MAXIMAS_ANTES_DEL_ENCABEZADO);
  for (let i = 0; i < limite; i++) {
    const nombres = filas[i].celdas.map((c) => (c.tipo === "texto" ? normalizarEncabezado(c.valor) : ""));
    if (!nombres.includes(COLUMNAS.tipoTransaccion) || !nombres.includes(COLUMNAS.montoConIva)) continue;
    const columnas: Partial<Record<CampoReporte, number>> = {};
    for (const [campo, nombre] of Object.entries(COLUMNAS) as [CampoReporte, string][]) {
      const posicion = nombres.indexOf(nombre);
      if (posicion >= 0) columnas[campo] = posicion;
    }
    return { indice: i, columnas };
  }
  return null;
}

export function leerReporteTransacciones(contenido: Buffer): ReporteLeido {
  const hoja = leerXlsx(contenido, HOJA_REPORTE);
  if (!hoja.ok) return hoja;

  const encabezado = buscarEncabezado(hoja.filas);
  if (!encabezado) {
    return {
      ok: false,
      mensaje: "No se encontró el encabezado del reporte (Tipo de transacción, Monto con IVA). Sube el «Reporte de transacciones» de Falabella Seller Center tal como se descarga.",
    };
  }
  const faltan = OBLIGATORIAS.filter((campo) => encabezado.columnas[campo] === undefined);
  if (faltan.length > 0) {
    return { ok: false, mensaje: `Al reporte le faltan columnas: ${faltan.map((c) => COLUMNAS[c]).join(", ")}.` };
  }

  const celda = (fila: FilaArchivo, campo: CampoReporte): Celda | undefined => {
    const posicion = encabezado.columnas[campo];
    return posicion === undefined ? undefined : fila.celdas[posicion];
  };
  const texto = (fila: FilaArchivo, campo: CampoReporte) => textoCelda(celda(fila, campo));

  const lineas: LineaReporte[] = [];
  const noReconocidas: LineaNoReconocida[] = [];
  const ocurrencias = new Map<string, number>();
  const sellerIds = new Set<string>();

  for (const fila of hoja.filas.slice(encabezado.indice + 1)) {
    if (fila.celdas.every((c) => c.tipo === "vacia")) continue;

    const tipoTransaccion = texto(fila, "tipoTransaccion");
    const sellerId = texto(fila, "sellerId");
    const moneda = texto(fila, "divisa")?.toUpperCase() ?? null;
    const monto = leerMontoReporte(celda(fila, "montoConIva"));
    const montoSinIva = leerMontoReporte(celda(fila, "montoSinIva"));
    const iva = leerMontoReporte(celda(fila, "iva"));
    const fecha = leerFechaReporte(celda(fila, "fechaTransaccion"));

    const motivo = !tipoTransaccion
      ? "sin tipo de transacción"
      : !sellerId
        ? "sin Seller ID"
        : !moneda || !/^[A-Z]{3}$/.test(moneda)
          ? "divisa no reconocida"
          : monto.tipo !== "monto"
            ? "monto con IVA vacío o con formato no reconocido"
            : montoSinIva.tipo === "error" || iva.tipo === "error"
              ? "monto sin IVA o IVA con formato no reconocido"
              : fecha.tipo === "error"
                ? "fecha de transacción con formato no reconocido"
                : null;
    if (motivo || !tipoTransaccion || !sellerId || !moneda || monto.tipo !== "monto" || fecha.tipo === "error") {
      noReconocidas.push({ numeroFila: fila.numeroFila, motivo: motivo ?? "línea no reconocida" });
      continue;
    }

    const base = {
      numeroFila: fila.numeroFila,
      sellerId,
      numeroOrden: texto(fila, "numeroOrden"),
      sku: texto(fila, "sku"),
      idArticulo: texto(fila, "idArticulo"),
      tipoTransaccion,
      categoria: clasificarCategoria(texto(fila, "categoriaReporte"), tipoTransaccion),
      moneda,
      montoSinIva: montoSinIva.tipo === "monto" ? montoSinIva.valor : null,
      iva: iva.tipo === "monto" ? iva.valor : null,
      monto: monto.valor,
      fechaTransaccion: fecha.tipo === "fecha" ? fecha.valor : null,
      estadoPago: texto(fila, "estadoPago"),
      estadoCuenta: texto(fila, "estadoCuenta"),
      referenciaPago: texto(fila, "referenciaPago"),
      documentoTributario: texto(fila, "documentoTributario"),
    };
    const clave = calcularHuella(base, 0);
    const ocurrencia = ocurrencias.get(clave) ?? 0;
    ocurrencias.set(clave, ocurrencia + 1);
    sellerIds.add(sellerId);
    lineas.push({ ...base, huella: ocurrencia === 0 ? clave : calcularHuella(base, ocurrencia) });
  }

  return { ok: true, lineas, noReconocidas, sellerIds: [...sellerIds] };
}

// Suma exacta de montos en texto (para pruebas y resúmenes).
export function sumarMontos(montos: string[]): string {
  return desdeDiezmilesimas(montos.reduce((total, m) => total + (aDiezmilesimas(m) ?? BigInt(0)), BigInt(0)));
}
