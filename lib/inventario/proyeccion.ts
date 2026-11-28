// Proyección de inventarios — reglas puras, sin tocar la base (se prueban
// sin Postgres, proyeccion.test.ts). Responde tres cosas: cuánto me dura
// el stock, cuándo tengo que comprar y cuánto. Las lecturas de datos
// reales viven en lib/inventario/proyeccion-datos.ts.

export const VENTANAS_DIAS = [3, 7, 14, 20, 30] as const;
export type VentanaDias = (typeof VENTANAS_DIAS)[number];

export const RUTAS_COMPRA = ["nacional", "plataforma", "avion"] as const;
export type RutaCompra = (typeof RUTAS_COMPRA)[number];
export const ETIQUETA_RUTA: Record<RutaCompra, string> = {
  nacional: "Compra nacional",
  plataforma: "Por plataforma",
  avion: "Por avión",
};

export type ReglasProyeccion = {
  coberturaDias: number;
  colchonPorcentaje: number;
  ventanaDias: VentanaDias;
  leadPorRuta: Record<RutaCompra, number>;
};

// Valores iniciales de una empresa sin configurar. Todos son editables
// por la empresa: avión puede tardar 20 a 30 días, una compra nacional
// mucho menos, y cada negocio decide cuánto quiere cubrir.
export const REGLAS_POR_DEFECTO: ReglasProyeccion = {
  coberturaDias: 30,
  colchonPorcentaje: 20,
  ventanaDias: 14,
  leadPorRuta: { nacional: 7, plataforma: 15, avion: 25 },
};

// Más de esto en bodega es plata parada. Margen de "pronto": días extra
// sobre el tiempo de entrega en que todavía hay que ir planeando.
export const DIAS_SOBRESTOCK = 90;
export const MARGEN_PRONTO_DIAS = 10;

export type EstadoProyeccion = "comprar_ya" | "pronto" | "saludable" | "sobrestock" | "sin_ventas";
export const ETIQUETA_ESTADO: Record<EstadoProyeccion, string> = {
  comprar_ya: "Comprar ya",
  pronto: "Pronto",
  saludable: "Saludable",
  sobrestock: "Sobrestock",
  sin_ventas: "Sin ventas",
};
export type ClaseAbc = "A" | "B" | "C";

export type EntradaProyeccion = {
  skuId: string;
  codigo: string;
  nombre: string;
  // Lo que hay para vender hoy (disponible de las bodegas propias).
  stock: number;
  // Unidades vendidas en los últimos N días, por ventana.
  vendidas: Record<VentanaDias, number>;
  ruta: RutaCompra;
  // Vacío = el de la ruta.
  leadTimeDias: number | null;
};

export type ResultadoProyeccion = {
  skuId: string;
  codigo: string;
  nombre: string;
  stock: number;
  ruta: RutaCompra;
  leadTimeDias: number;
  // Unidades por día en cada ventana (3, 7, 14, 20, 30).
  velocidadPorVentana: Record<VentanaDias, number>;
  // La ventana elegida por la empresa.
  velocidad: number;
  // null = no se vende, el stock no se acaba.
  diasCobertura: number | null;
  fechaAgotamiento: Date | null;
  estado: EstadoProyeccion;
  // Unidades a pedir para cubrir entrega + cobertura + colchón.
  cantidadSugerida: number;
  // Ventas por día de los últimos 7 días contra el promedio de 30. null
  // = sin ventas en 30 días, no hay con qué comparar.
  tendenciaPorcentaje: number | null;
  vendidas30: number;
  abc: ClaseAbc;
};

export function leadTimeEfectivo(ruta: RutaCompra, propio: number | null, reglas: ReglasProyeccion): number {
  return propio ?? reglas.leadPorRuta[ruta];
}

export function velocidadPorDia(vendidas: number, ventana: number): number {
  return ventana > 0 ? vendidas / ventana : 0;
}

export function diasDeCobertura(stock: number, velocidad: number): number | null {
  if (velocidad <= 0) return null;
  return Math.max(0, stock) / velocidad;
}

export function clasificarEstado(dias: number | null, leadTimeDias: number): EstadoProyeccion {
  if (dias === null) return "sin_ventas";
  if (dias < leadTimeDias) return "comprar_ya";
  if (dias < leadTimeDias + MARGEN_PRONTO_DIAS) return "pronto";
  if (dias > DIAS_SOBRESTOCK) return "sobrestock";
  return "saludable";
}

// Pedido = vender durante lo que tarda en llegar + lo que quiere cubrir
// después, con colchón, menos lo que ya hay.
export function cantidadSugerida(stock: number, velocidad: number, leadTimeDias: number, reglas: ReglasProyeccion): number {
  if (velocidad <= 0) return 0;
  const necesaria = velocidad * (leadTimeDias + reglas.coberturaDias) * (1 + reglas.colchonPorcentaje / 100);
  return Math.max(0, Math.ceil(necesaria - Math.max(0, stock)));
}

// A = los que juntos hacen el 80% de las unidades vendidas en 30 días,
// B = hasta el 95%, C = el resto (incluye los que no se venden).
export function clasificarAbc(vendidas30PorSku: Map<string, number>): Map<string, ClaseAbc> {
  const orden = [...vendidas30PorSku.entries()].sort((a, b) => b[1] - a[1]);
  const total = orden.reduce((suma, [, v]) => suma + v, 0);
  const resultado = new Map<string, ClaseAbc>();
  let acumulado = 0;
  for (const [id, v] of orden) {
    if (v <= 0 || total <= 0) {
      resultado.set(id, "C");
      continue;
    }
    // Se mira el acumulado ANTES de sumar este SKU: el que cruza el 80%
    // sigue siendo A (si no, un SKU que vende el 90% saldría B).
    const antes = acumulado / total;
    resultado.set(id, antes < 0.8 ? "A" : antes < 0.95 ? "B" : "C");
    acumulado += v;
  }
  return resultado;
}

export function proyectar(entradas: EntradaProyeccion[], reglas: ReglasProyeccion, ahora: Date = new Date()): ResultadoProyeccion[] {
  const abc = clasificarAbc(new Map(entradas.map((e) => [e.skuId, e.vendidas[30]])));
  return entradas.map((e) => {
    const velocidadPorVentana = Object.fromEntries(VENTANAS_DIAS.map((d) => [d, velocidadPorDia(e.vendidas[d], d)])) as Record<VentanaDias, number>;
    const velocidad = velocidadPorVentana[reglas.ventanaDias];
    const lead = leadTimeEfectivo(e.ruta, e.leadTimeDias, reglas);
    const dias = diasDeCobertura(e.stock, velocidad);
    const v30 = velocidadPorVentana[30];
    return {
      skuId: e.skuId,
      codigo: e.codigo,
      nombre: e.nombre,
      stock: e.stock,
      ruta: e.ruta,
      leadTimeDias: lead,
      velocidadPorVentana,
      velocidad,
      diasCobertura: dias,
      fechaAgotamiento: dias === null ? null : new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000),
      estado: clasificarEstado(dias, lead),
      cantidadSugerida: cantidadSugerida(e.stock, velocidad, lead, reglas),
      tendenciaPorcentaje: v30 > 0 ? Math.round((velocidadPorVentana[7] / v30 - 1) * 100) : null,
      vendidas30: e.vendidas[30],
      abc: abc.get(e.skuId) ?? "C",
    };
  });
}

// Más urgente primero: los que se acaban antes de que llegue un pedido
// (los de menos margen arriba), luego el resto por días de cobertura.
const PESO_ESTADO: Record<EstadoProyeccion, number> = { comprar_ya: 0, pronto: 1, saludable: 2, sobrestock: 3, sin_ventas: 4 };
export function ordenarPorUrgencia(filas: ResultadoProyeccion[]): ResultadoProyeccion[] {
  return [...filas].sort((a, b) => {
    const porEstado = PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado];
    if (porEstado !== 0) return porEstado;
    return (a.diasCobertura ?? Infinity) - (b.diasCobertura ?? Infinity) || a.codigo.localeCompare(b.codigo);
  });
}

export function contarPorEstado(filas: ResultadoProyeccion[]): Record<EstadoProyeccion, number> {
  const conteo: Record<EstadoProyeccion, number> = { comprar_ya: 0, pronto: 0, saludable: 0, sobrestock: 0, sin_ventas: 0 };
  for (const f of filas) conteo[f.estado]++;
  return conteo;
}

// Qué hacer con el SKU, en una frase corta para la vista de rotación.
export function accionSugerida(f: Pick<ResultadoProyeccion, "estado" | "tendenciaPorcentaje">): string {
  switch (f.estado) {
    case "comprar_ya":
      return "Comprar ya";
    case "pronto":
      return "Planear compra";
    case "sobrestock":
      return "No comprar";
    case "sin_ventas":
      return "Revisar";
    default:
      return (f.tendenciaPorcentaje ?? 0) > 25 ? "Vigilar: sube" : "Mantener";
  }
}
