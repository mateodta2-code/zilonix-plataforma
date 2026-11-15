// Página visual de prueba del rediseño de Promociones (sin issue
// todavía — nace de un pedido directo de Mateo para mostrarle maquetas
// a Débora). Ruta aislada, nunca tocada por el módulo real
// (app/panel/promociones/): todos los datos de acá son fijos, en
// memoria, nunca de Mercado Libre ni de la base.

export type EstadoPublicacionPrueba = "en_promocion_aplicada" | "sin_promocion" | "error";

export type CuentaPrueba = { id: string; nickname: string; siteId: string };

// Dos cuentas de países DISTINTOS a propósito — si algo del lado del
// formateo volviera a fijar COP/MCO/es-CO a mano (la regla que se
// cerró en issue #315, lib/ml/sitios.ts), se notaría de inmediato acá:
// la tienda de México tiene que verse en pesos mexicanos, nunca en COP.
export const CUENTAS_EJEMPLO: CuentaPrueba[] = [
  { id: "cuenta-demo-co", nickname: "Tienda Colombia (demo)", siteId: "MCO" },
  { id: "cuenta-demo-mx", nickname: "Tienda México (demo)", siteId: "MLM" },
];

export type PromocionDisponiblePrueba = {
  id: string;
  nombre: string;
  etiqueta?: string;
  vigenciaTexto: string;
  descuentoVendedorSugeridoPorcentaje: number;
  aporteMlPorcentaje: number;
};

export type VariantePrueba = { id: string; nombre: string; sku: string; precio: number; stock: number };

export type PublicacionPrueba = {
  id: string;
  cuentaId: string;
  titulo: string;
  sku: string;
  precio: number;
  stock: number;
  estadoInicial: EstadoPublicacionPrueba;
  motivoErrorInicial?: string;
  promociones: PromocionDisponiblePrueba[];
  variantes?: VariantePrueba[];
};

// Tabla maestra de SKU con precios mínimos — mismo concepto que
// app/panel/finanzas/maestra-sku/ (ahí vive la real), acá una copia
// fija de 5 filas solo para la maqueta.
export const TABLA_MAESTRA_PRECIOS_MINIMOS: Readonly<Record<string, number>> = {
  "ZX-1001": 68000,
  "ZX-1002": 42000,
  "ZX-1003": 28000,
  "ZX-1005": 21000,
  "ZX-1004-A": 15500,
  "ZX-1004-B": 16500,
};

export const PUBLICACIONES_EJEMPLO: PublicacionPrueba[] = [
  {
    id: "pub-1",
    cuentaId: "cuenta-demo-co",
    titulo: "Parlante Bluetooth Portátil 20W",
    sku: "ZX-1001",
    precio: 89900,
    stock: 34,
    estadoInicial: "sin_promocion",
    promociones: [
      { id: "pub-1-promo-1", nombre: "Oferta relámpago", etiqueta: "Oferta relámpago", vigenciaTexto: "Del 10 al 12 de noviembre", descuentoVendedorSugeridoPorcentaje: 18, aporteMlPorcentaje: 3 },
      { id: "pub-1-promo-2", nombre: "Con aporte de la plataforma", vigenciaTexto: "Del 1 al 30 de noviembre", descuentoVendedorSugeridoPorcentaje: 12, aporteMlPorcentaje: 5 },
    ],
  },
  {
    id: "pub-2",
    cuentaId: "cuenta-demo-co",
    titulo: "Audífonos Inalámbricos Deportivos",
    sku: "ZX-1002",
    precio: 54900,
    stock: 12,
    estadoInicial: "en_promocion_aplicada",
    promociones: [
      { id: "pub-2-promo-1", nombre: "Con aporte de la plataforma", vigenciaTexto: "Del 1 al 30 de noviembre", descuentoVendedorSugeridoPorcentaje: 10, aporteMlPorcentaje: 6 },
    ],
  },
  {
    id: "pub-3",
    cuentaId: "cuenta-demo-mx",
    titulo: "Power Bank 10000mAh",
    sku: "ZX-1003",
    precio: 39900,
    stock: 0,
    estadoInicial: "error",
    motivoErrorInicial: "La plataforma rechazó la participación: el stock está en 0.",
    promociones: [
      { id: "pub-3-promo-1", nombre: "Oferta relámpago", etiqueta: "Oferta relámpago", vigenciaTexto: "Del 13 al 14 de noviembre", descuentoVendedorSugeridoPorcentaje: 20, aporteMlPorcentaje: 4 },
    ],
  },
  {
    id: "pub-4",
    cuentaId: "cuenta-demo-mx",
    titulo: "Cargador Rápido USB-C 30W",
    sku: "ZX-1005",
    precio: 29900,
    stock: 50,
    estadoInicial: "sin_promocion",
    promociones: [
      { id: "pub-4-promo-1", nombre: "Con aporte de la plataforma", vigenciaTexto: "Del 1 al 30 de noviembre", descuentoVendedorSugeridoPorcentaje: 15, aporteMlPorcentaje: 5 },
      { id: "pub-4-promo-2", nombre: "Evento de fin de año", etiqueta: "Fin de año", vigenciaTexto: "Del 20 de noviembre al 2 de diciembre", descuentoVendedorSugeridoPorcentaje: 25, aporteMlPorcentaje: 8 },
    ],
  },
  {
    id: "pub-5",
    cuentaId: "cuenta-demo-co",
    titulo: "Funda Protectora para Celular",
    sku: "ZX-1004",
    precio: 19900,
    stock: 35,
    estadoInicial: "sin_promocion",
    promociones: [
      { id: "pub-5-promo-1", nombre: "Con aporte de la plataforma", vigenciaTexto: "Del 1 al 30 de noviembre", descuentoVendedorSugeridoPorcentaje: 10, aporteMlPorcentaje: 4 },
    ],
    variantes: [
      { id: "pub-5-var-a", nombre: "Negro — talla única", sku: "ZX-1004-A", precio: 19900, stock: 20 },
      { id: "pub-5-var-b", nombre: "Azul — talla única", sku: "ZX-1004-B", precio: 21900, stock: 15 },
    ],
  },
];
