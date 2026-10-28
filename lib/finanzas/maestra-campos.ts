// Issue #128 — campos de la hoja de la tabla maestra. Archivo aparte,
// sin imports de la base, para que la pantalla de carga (componente
// cliente) pueda usarlos sin arrastrar código de servidor.

export const CAMPOS_MAESTRA = [
  "producto",
  "proveedor",
  "sku",
  "costo",
  "empaque",
  "envio_agencia",
  "precio_minimo_unidad",
  "precio_minimo_combo_x2",
  "precio_minimo_combo_x3",
  "precio_venta",
] as const;
export type CampoMaestra = (typeof CAMPOS_MAESTRA)[number];

export const ETIQUETAS_CAMPO: Record<CampoMaestra, string> = {
  producto: "Producto",
  proveedor: "Proveedor",
  sku: "SKU",
  costo: "Costo",
  empaque: "Packing",
  envio_agencia: "Envío agencia",
  precio_minimo_unidad: "Precio mínimo x1",
  precio_minimo_combo_x2: "Precio mínimo x2",
  precio_minimo_combo_x3: "Precio mínimo x3",
  precio_venta: "Precio de venta",
};

// Índice de columna del archivo por campo; ausente = no se importa.
export type MapeoColumnas = Partial<Record<CampoMaestra, number>>;
