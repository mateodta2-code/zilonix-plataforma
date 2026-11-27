// Issue #280 — armar CSV para descargar (inventario, kardex). Funciones
// puras: nada de base ni de request acá. Mismo separador que la
// plantilla del CSV de SKUs y el CSV de la extensión (coma), fin de
// línea \r\n y BOM para que Excel abra las tildes como UTF-8 (sin BOM
// las muestra como "Ã³").

export type ValorCsv = string | number | null | undefined;

// Una celda de texto que empieza por estos caracteres Excel/Sheets la
// interpreta como fórmula (inyección de fórmulas: un SKU o una nota
// "=HYPERLINK(...)" escrita por cualquiera se ejecutaría al abrir el
// archivo). Se antepone ' para que quede como texto. Solo al TEXTO: un
// número negativo del kardex (-5) sigue siendo número.
const INICIO_FORMULA = /^[=+\-@\t\r]/;
const NECESITA_COMILLAS = /[",\r\n]/;

export function celdaCsv(valor: ValorCsv): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : "";
  let texto = valor;
  if (INICIO_FORMULA.test(texto)) texto = `'${texto}`;
  if (NECESITA_COMILLAS.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

export function armarCsv(encabezados: string[], filas: ValorCsv[][]): string {
  const lineas = [encabezados, ...filas].map((fila) => fila.map(celdaCsv).join(","));
  return `﻿${lineas.join("\r\n")}\r\n`;
}

// Colombia no tiene horario de verano: siempre UTC−05:00.
const DESFASE_BOGOTA_MS = 5 * 60 * 60 * 1000;

// ISO 8601 en hora de Colombia, al segundo: 2026-11-27T14:05:00-05:00.
export function fechaIsoBogota(fecha: Date): string {
  return `${new Date(fecha.getTime() - DESFASE_BOGOTA_MS).toISOString().slice(0, 19)}-05:00`;
}

// AAAA-MM-DD de hoy en Colombia, para el nombre del archivo (que nunca
// lleva datos del usuario).
export function fechaArchivoBogota(fecha: Date = new Date()): string {
  return fechaIsoBogota(fecha).slice(0, 10);
}
