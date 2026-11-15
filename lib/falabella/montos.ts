// Issue #422: en staging, «Sincronizar pedidos» falló con
// `invalid input syntax for type numeric: "78,000.00"` — Falabella manda
// los montos (Price, GrandTotal, ItemPrice, PaidPrice) como texto con coma
// de miles y punto decimal, y pedidos_falabella.total es numeric(14,2).
//
// Solo se aceptan los formatos vistos o inequívocos: "78000", "78000.00",
// "78,000.00", "1,234,567.89" (y números). NO se adivina el formato
// europeo/colombiano ("78.000,00"): "78.000" podría ser 78 o 78000, así
// que cualquier otro formato se rechaza con el campo y el OrderId para
// verlo en el log y decidir con el dato real.

export class MontoFalabellaInvalidoError extends Error {
  constructor(
    public readonly campo: string,
    public readonly orderId: string
  ) {
    super(`Monto de Falabella con formato no reconocido en ${campo} (OrderId ${orderId})`);
    this.name = "MontoFalabellaInvalidoError";
  }
}

// Entero sin separadores, o con comas de miles en grupos de 3 exactos;
// decimales opcionales con punto (1 o 2 dígitos).
const FORMATO_MONTO = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

// numeric(14,2) admite hasta 12 dígitos enteros.
const MAX_DIGITOS_ENTEROS = 12;

export function parsearMontoFalabella(
  valor: string | number,
  contexto: { campo: string; orderId: string }
): string {
  const invalido = () => new MontoFalabellaInvalidoError(contexto.campo, contexto.orderId);
  if (typeof valor === "number" && !Number.isFinite(valor)) throw invalido();
  if (typeof valor !== "number" && typeof valor !== "string") throw invalido();

  const coincidencia = FORMATO_MONTO.exec(String(valor).trim());
  if (!coincidencia) throw invalido();

  const entero = coincidencia[1].replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (entero.length > MAX_DIGITOS_ENTEROS) throw invalido();
  const decimales = (coincidencia[2] ?? "").padEnd(2, "0");
  return `${entero}.${decimales}`;
}
