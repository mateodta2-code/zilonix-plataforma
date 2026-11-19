import { crearXlsxDePrueba, type ValorCeldaPrueba } from "./xlsx";

// Issue #422 — «Reporte de transacciones» de Falabella armado a mano a
// partir del corte real FACO-SC0170C-20261111-COP, ANONIMIZADO: mismas 28
// líneas de 8 órdenes y mismos totales (precio 185800, comisiones -28869,
// envíos neto -12300, impuesto -26800.06, pago 117830.94), pero sin
// nombres de clientes ni productos, con órdenes, SKU y documentos
// inventados. Nunca se sube el xlsx real al repo.

export const ENCABEZADO_REPORTE = [
  "Fecha creación de la orden",
  "Nombre del producto",
  "Nº de orden",
  "SKU vendedor",
  "SKU Falabella",
  "Id Artículo",
  "Falabella-Id",
  "Estado de la orden",
  "Fecha de Entrega",
  "Tipo de transacción",
  "Fecha de transacción",
  "Divisa",
  "Monto (Sin IVA)",
  "IVA",
  "Monto con IVA",
  "Tipo de comisión",
  "% comisión",
  "Talla",
  "Opscore",
  "Estado de pago",
  "Nº estado de cuenta",
  "Referencia de pago Fpay",
  "Comentarios",
  "Tipo de envío",
  "Proveedor logístico",
  "Modalidad logística",
  "Seller ID",
  "Tipo de Seller",
  "Tipo de Documento Tributario",
  "N° Documento Tributario",
  "Categoría de transacciones",
];

export const SELLER_ID_PRUEBA = "SC0170C";
export const CORTE_PRUEBA = "FACO-SC0170C-20261111-COP";

type LineaPrueba = {
  orden: string;
  sku: string;
  articulo: string;
  tipo: string;
  categoria: string;
  sinIva: number | null;
  iva: number | null;
  conIva: number;
  fecha?: ValorCeldaPrueba;
};

const ORDENES = ["3000001", "3000002", "3000003", "3000004", "3000005", "3000006", "3000007", "3000008"];
const PRECIOS = [20000, 25000, 18000, 30000, 22800, 24000, 21000, 25000];
const COMISIONES = [3108, 3885, 2797, 4662, 3543, 3730, 3263, 3881];

function lineasDelCorte(): LineaPrueba[] {
  const lineas: LineaPrueba[] = [];
  ORDENES.forEach((orden, i) => {
    const sku = `SKU-PRUEBA-${i + 1}`;
    const articulo = `9000${i + 1}`;
    lineas.push({ orden, sku, articulo, tipo: "Precio producto", categoria: "Precio Producto", sinIva: null, iva: null, conIva: PRECIOS[i] });
    lineas.push({ orden, sku, articulo, tipo: "Comisión", categoria: "Comisiones", sinIva: null, iva: null, conIva: -COMISIONES[i] });
  });
  // Envíos: neto -12300.
  lineas.push({ orden: ORDENES[0], sku: "SKU-PRUEBA-1", articulo: "90001", tipo: "Cobro de envío", categoria: "Envío FCOM", sinIva: -6638.66, iva: -1261.34, conIva: -7900 });
  lineas.push({ orden: ORDENES[1], sku: "SKU-PRUEBA-2", articulo: "90002", tipo: "Cobro de envío", categoria: "Envío FCOM", sinIva: -6638.66, iva: -1261.34, conIva: -7900 });
  lineas.push({ orden: ORDENES[2], sku: "SKU-PRUEBA-3", articulo: "90003", tipo: "Envío a cargo del seller", categoria: "Envío Seller", sinIva: null, iva: null, conIva: 3500 });
  // Retenciones: -26800.06, solo con el monto con IVA.
  for (const [i, orden] of ORDENES.slice(0, 3).entries()) {
    const sku = `SKU-PRUEBA-${i + 1}`;
    const articulo = `9000${i + 1}`;
    lineas.push({ orden, sku, articulo, tipo: "Retención en la Fuente", categoria: "Impuesto", sinIva: null, iva: null, conIva: -4645 });
    lineas.push({ orden, sku, articulo, tipo: "Retención IVA", categoria: "Impuesto", sinIva: null, iva: null, conIva: -3530.02 });
    lineas.push({ orden, sku, articulo, tipo: "Retención ICA", categoria: "Impuesto", sinIva: null, iva: null, conIva: i === 2 ? -758.34 : -758.33 });
  }
  return lineas;
}

function fila(linea: LineaPrueba, indice: number): ValorCeldaPrueba[] {
  const valores: Record<string, ValorCeldaPrueba> = {
    "Fecha creación de la orden": "03/11/2026",
    "Nombre del producto": `Producto de prueba ${linea.sku}`,
    "Nº de orden": linea.orden,
    "SKU vendedor": linea.sku,
    "SKU Falabella": `FAL-${linea.sku}`,
    "Id Artículo": linea.articulo,
    "Falabella-Id": `F-${linea.articulo}`,
    "Estado de la orden": "Entregado",
    "Fecha de Entrega": "06/11/2026",
    "Tipo de transacción": linea.tipo,
    // Mitad como texto y mitad como fecha de Excel (46332 = 06/11/2026):
    // el reporte real puede traer cualquiera de las dos.
    "Fecha de transacción": linea.fecha !== undefined ? linea.fecha : indice % 2 === 0 ? "06/11/2026" : 46332,
    Divisa: "COP",
    "Monto (Sin IVA)": linea.sinIva,
    IVA: linea.iva,
    "Monto con IVA": linea.conIva,
    "Estado de pago": "Pagado",
    "Nº estado de cuenta": CORTE_PRUEBA,
    "Referencia de pago Fpay": "FPAY-PRUEBA-1",
    "Seller ID": SELLER_ID_PRUEBA,
    "Tipo de Seller": "FBS",
    "Tipo de Documento Tributario": "Factura",
    "N° Documento Tributario": "FE-0001",
    "Categoría de transacciones": linea.categoria,
  };
  return ENCABEZADO_REPORTE.map((columna) => valores[columna] ?? null);
}

export function filasReporteCorte(): ValorCeldaPrueba[][] {
  return lineasDelCorte().map(fila);
}

// Filas 1 a 5: título y grupos, como el reporte real; encabezado en la 6.
export function crearReporteDePrueba(
  filas: ValorCeldaPrueba[][] = filasReporteCorte(),
  encabezado: string[] = ENCABEZADO_REPORTE
): Buffer {
  return crearXlsxDePrueba(
    [
      ["Reporte de Transacciones"],
      ["Seller Center Falabella"],
      [],
      [null, "Datos de la orden", null, null, null, null, null, null, null, "Transacción"],
      [],
      encabezado,
      ...filas,
    ],
    "Reporte Transacciones"
  );
}
