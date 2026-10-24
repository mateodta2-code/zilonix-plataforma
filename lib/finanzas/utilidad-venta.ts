// Motor de utilidad por venta (Z-FIN-09, issue #131 — solo la parte del
// motor; pantallas, base y recálculo masivo van en otro PR).
//
// Fórmula aprobada (regla del Zilonix OS):
//   utilidad = valor de venta − comisión ML − flete ML − costo del producto
//              − empaque − envío (si aplica)
//   margen % = utilidad ÷ valor de venta
// La publicidad NO entra acá: se resta a nivel cuenta/mes en #135 y #143.
//
// Es una función pura: no lee la base, no mira el reloj. Recibe la foto
// congelada de la venta (nombres de #129: pedidos_finanzas, pedido_items,
// ventas_correcciones) y devuelve el desglose. Así la pantalla, el detalle y
// el recálculo de #130 usan exactamente la misma cuenta.
//
// Dinero: entra y sale como string decimal ("12345.67"), igual que el
// numeric(14,2) que devuelve Postgres. Por dentro se trabaja en centavos con
// BigInt. Nunca Number ni float para sumar dinero: con 16 cuentas un total
// mensual pasa de Number.MAX_SAFE_INTEGER centavos y se perderían centavos.
//
// Nota: el tsconfig apunta a ES2017, donde los literales `0n` no compilan;
// por eso las constantes se arman con BigInt(n).

const CERO = BigInt(0);
const UNO = BigInt(1);
const CIEN = BigInt(100);
const DIEZ_MIL = BigInt(10000);

export type FormaEntrega = "full_ml" | "flex" | "agencia" | "desconocida";

// Lista blanca cerrada de #129 (la misma restricción que tendrá la columna
// `campo` de ventas_correcciones). Se valida también en tiempo de ejecución:
// el dato llega de la base tipado como texto y el motor no confía en el tipo.
export const CAMPOS_CORREGIBLES = ["costo_producto", "empaque", "envio_agencia", "comision_ml", "flete_ml"] as const;
export type CampoCorregible = (typeof CAMPOS_CORREGIBLES)[number];

// Empaque y envío se cobran una vez por paquete, no por línea (#127, #129).
const CAMPOS_POR_PAQUETE: ReadonlySet<CampoCorregible> = new Set<CampoCorregible>(["empaque", "envio_agencia"]);

export interface LineaVentaEntrada {
  linea: number;
  cantidad: number;
  valor_linea: string;
  // [SUPUESTO] costo TOTAL de la línea (ya multiplicado por la cantidad), no
  // unitario: así se lee igual que valor_linea, comision_ml y flete_ml de
  // pedido_items, que también son de la línea completa. `cantidad` queda
  // informativa para el detalle.
  // null = sin costo (vacío o SKU sin fila en la maestra). "0.00" = costo
  // real de $0 puesto a propósito (decisión de Sharel, 22-oct-2026).
  costo_congelado: string | null;
  // El costo congelado venía de un SKU con costo_por_confirmar (amarillo).
  costo_provisional: boolean;
}

export interface CorreccionEntrada {
  // null = toda la orden.
  linea: number | null;
  campo: CampoCorregible;
  valor_nuevo: string;
  // Se acepta la fila anulada para que el llamador pueda pasar todas: el
  // motor solo usa las activas (anulada_ts nulo).
  anulada_ts: Date | null;
}

export interface VentaEntrada {
  pedido_id: string;
  cuenta_ml_id: string;
  // Sale de la logística de ML, nunca del prefijo del SKU: un SKU FUL de
  // Infinity vendido por Agencia paga su envío agencia de $2.000 (#127).
  forma_entrega: FormaEntrega;
  fecha_pago_aprobado: Date;
  // Pagos aprobados − reembolsos: en una devolución parcial ya llega neto.
  valor_venta: string;
  // Total de la orden según la API de ML; el motor lo reparte por línea.
  comision_ml: string;
  flete_ml: string;
  // [SUPUESTO] null = sin dato en la foto congelada: se toma como $0 y la
  // venta lleva un aviso. Solo el costo del producto nulo saca la venta del
  // cálculo; empaque y envío 0 son valores reales en la hoja de Zilonix.
  empaque_congelado: string | null;
  // Envío congelado del paquete. Cubre Agencia y Flex (#129 congela "envío
  // agencia/Flex" en la misma columna).
  envio_agencia_congelado: string | null;
  lineas: LineaVentaEntrada[];
  correcciones: CorreccionEntrada[];
}

// "full_ml": regla, no dato — con Full de ML el envío es $0 aunque el SKU
// tenga envío agencia en la maestra.
export type OrigenValor = "congelado" | "corregido" | "full_ml";

export interface ValorConcepto {
  valor: string;
  origen: OrigenValor;
}

export type AvisoVenta =
  | "sin_costo"
  | "empaque_sin_dato"
  | "envio_sin_dato"
  | "forma_entrega_desconocida"
  | "correccion_linea_ignorada";

export interface ResultadoLinea {
  linea: number;
  cantidad: number;
  valor_venta: string;
  comision_ml: ValorConcepto;
  flete_ml: ValorConcepto;
  costo_producto: ValorConcepto | null;
  usa_costo_provisional: boolean;
}

export interface ResultadoVenta {
  pedido_id: string;
  cuenta_ml_id: string;
  forma_entrega: FormaEntrega;
  dia_bogota: string;
  mes_bogota: string;
  con_costo: boolean;
  usa_costo_provisional: boolean;
  valor_venta: string;
  comision_ml: ValorConcepto;
  flete_ml: ValorConcepto;
  // null cuando la venta no tiene costo completo.
  costo_producto: ValorConcepto | null;
  empaque: ValorConcepto;
  envio: ValorConcepto;
  // null = la venta queda fuera del cálculo (no se inventa utilidad).
  utilidad: string | null;
  // Porcentaje con 2 decimales ("23.45" = 23,45 %). null si no hay utilidad
  // o el valor de venta es 0.
  margen_porcentaje: string | null;
  lineas: ResultadoLinea[];
  avisos: AvisoVenta[];
}

export class EntradaUtilidadInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "EntradaUtilidadInvalidaError";
  }
}

// ---------------------------------------------------------------------------
// Dinero en centavos
// ---------------------------------------------------------------------------

// Mismo formato que numeric(14,2): sin separador de miles, punto decimal y
// hasta 2 decimales. Un tercer decimal se rechaza en vez de redondearse.
const PATRON_MONTO = /^-?\d+(\.\d{1,2})?$/;

export function aCentavos(monto: string): bigint {
  if (typeof monto !== "string" || !PATRON_MONTO.test(monto)) {
    throw new EntradaUtilidadInvalidaError(`Monto inválido: ${JSON.stringify(monto)}`);
  }
  const negativo = monto.startsWith("-");
  const sinSigno = negativo ? monto.slice(1) : monto;
  const [entero, fraccion = ""] = sinSigno.split(".");
  const centavos = BigInt(entero) * CIEN + BigInt((fraccion + "00").slice(0, 2));
  return negativo ? -centavos : centavos;
}

// Costo, empaque y envío son plata que sale: un negativo sumaría utilidad
// inventada. Comisión y flete sí pueden llegar negativos de la API de ML
// (una bonificación o un reintegro), por eso no pasan por acá.
function aCentavosNoNegativo(monto: string, concepto: string): bigint {
  const centavos = aCentavos(monto);
  if (centavos < CERO) {
    throw new EntradaUtilidadInvalidaError(`${concepto} no puede ser negativo: ${JSON.stringify(monto)}`);
  }
  return centavos;
}

const CAMPOS_NO_NEGATIVOS: ReadonlySet<CampoCorregible> = new Set<CampoCorregible>(["costo_producto", "empaque", "envio_agencia"]);

export function desdeCentavos(centavos: bigint): string {
  const negativo = centavos < CERO;
  const absoluto = negativo ? -centavos : centavos;
  const fraccion = (absoluto % CIEN).toString().padStart(2, "0");
  return `${negativo ? "-" : ""}${absoluto / CIEN}.${fraccion}`;
}

function sumar(valores: bigint[]): bigint {
  return valores.reduce((acumulado, valor) => acumulado + valor, CERO);
}

// División redondeando la mitad lejos de cero; el divisor tiene que ser > 0.
function dividirRedondeando(dividendo: bigint, divisor: bigint): bigint {
  const negativo = dividendo < CERO;
  const absoluto = negativo ? -dividendo : dividendo;
  const cociente = (absoluto * BigInt(2) + divisor) / (divisor * BigInt(2));
  return negativo ? -cociente : cociente;
}

// Porcentaje con 2 decimales, como string: 1/3 → "33.33".
function porcentaje(parte: bigint, total: bigint): string | null {
  if (total === CERO) return null;
  const negativo = total < CERO;
  const puntosBasicos = dividirRedondeando(parte * DIEZ_MIL, negativo ? -total : total);
  return desdeCentavos(negativo ? -puntosBasicos : puntosBasicos);
}

// Reparte un total en centavos según los pesos, con el método del residuo
// mayor: cada parte recibe su piso y los centavos que sobran van a las
// partes con mayor residuo (empate: la línea que va primero). La suma de las
// partes es SIEMPRE exactamente el total — repartir con float y redondear
// cada parte por separado puede sumar un centavo de más o de menos.
export function repartirProporcional(totalCentavos: bigint, pesos: bigint[]): bigint[] {
  if (pesos.length === 0) {
    throw new EntradaUtilidadInvalidaError("No hay pesos para repartir");
  }
  if (pesos.some((peso) => peso < CERO)) {
    throw new EntradaUtilidadInvalidaError("Un peso de reparto no puede ser negativo");
  }
  let base = pesos;
  let sumaPesos = sumar(pesos);
  // [SUPUESTO] si todas las líneas valen 0 no hay proporción posible: se
  // reparte en partes iguales en vez de fallar.
  if (sumaPesos === CERO) {
    base = pesos.map(() => UNO);
    sumaPesos = BigInt(pesos.length);
  }
  const negativo = totalCentavos < CERO;
  const absoluto = negativo ? -totalCentavos : totalCentavos;
  const partes = base.map((peso) => (absoluto * peso) / sumaPesos);
  const residuos = base.map((peso) => (absoluto * peso) % sumaPesos);
  let sobrante = absoluto - sumar(partes);
  const orden = base
    .map((_, indice) => indice)
    .sort((a, b) => (residuos[a] === residuos[b] ? a - b : residuos[b] > residuos[a] ? 1 : -1));
  for (let i = 0; sobrante > CERO; i++) {
    partes[orden[i]] += UNO;
    sobrante -= UNO;
  }
  return negativo ? partes.map((parte) => -parte) : partes;
}

// ---------------------------------------------------------------------------
// Día de Bogotá
// ---------------------------------------------------------------------------

// Bogotá es UTC-5 todo el año (sin horario de verano), igual que en
// lib/filtros-listado.ts. Railway corre en UTC: un pago aprobado a las 23:59
// de Bogotá ya es el día siguiente en UTC y tiene que contar en el día de
// Bogotá (regla del OS, pregunta 5c).
const DESFASE_BOGOTA_MS = 5 * 60 * 60 * 1000;

export function diaBogota(instante: Date): string {
  if (!(instante instanceof Date) || Number.isNaN(instante.getTime())) {
    throw new EntradaUtilidadInvalidaError("fecha_pago_aprobado inválida");
  }
  return new Date(instante.getTime() - DESFASE_BOGOTA_MS).toISOString().slice(0, 10);
}

export function mesBogota(instante: Date): string {
  return diaBogota(instante).slice(0, 7);
}

// ---------------------------------------------------------------------------
// Correcciones
// ---------------------------------------------------------------------------

type ClaveCorreccion = `${number | "orden"}|${CampoCorregible}`;

function claveCorreccion(linea: number | null, campo: CampoCorregible): ClaveCorreccion {
  return `${linea === null ? "orden" : linea}|${campo}`;
}

function correccionesActivas(venta: VentaEntrada, lineasValidas: Set<number>): Map<ClaveCorreccion, bigint> {
  const activas = new Map<ClaveCorreccion, bigint>();
  for (const correccion of venta.correcciones) {
    if (!(CAMPOS_CORREGIBLES as readonly string[]).includes(correccion.campo)) {
      throw new EntradaUtilidadInvalidaError(`Campo de corrección fuera de la lista: ${JSON.stringify(correccion.campo)}`);
    }
    if (correccion.anulada_ts !== null) continue;
    if (correccion.linea !== null) {
      if (!lineasValidas.has(correccion.linea)) {
        throw new EntradaUtilidadInvalidaError(`Corrección para una línea que no existe: ${correccion.linea}`);
      }
      // [SUPUESTO] empaque y envío son del paquete: una corrección de esos
      // campos sobre una línea es un dato inválido y se rechaza, en vez de
      // decidir en silencio a qué parte del paquete aplica.
      if (CAMPOS_POR_PAQUETE.has(correccion.campo)) {
        throw new EntradaUtilidadInvalidaError(`${correccion.campo} es por paquete: la corrección no puede ser de una línea`);
      }
    }
    const clave = claveCorreccion(correccion.linea, correccion.campo);
    // El índice parcial de #129 garantiza una sola activa por
    // (pedido, linea, campo); si llegan dos, la entrada está rota y no se
    // elige una al azar.
    if (activas.has(clave)) {
      throw new EntradaUtilidadInvalidaError(`Dos correcciones activas para ${clave}`);
    }
    activas.set(
      clave,
      CAMPOS_NO_NEGATIVOS.has(correccion.campo)
        ? aCentavosNoNegativo(correccion.valor_nuevo, `Corrección de ${correccion.campo}`)
        : aCentavos(correccion.valor_nuevo),
    );
  }
  return activas;
}

// ---------------------------------------------------------------------------
// Motor por venta
// ---------------------------------------------------------------------------

interface ConceptoRepartido {
  total: bigint;
  origenTotal: OrigenValor;
  partes: bigint[];
  origenPartes: OrigenValor[];
  lineaIgnorada: boolean;
}

// Comisión y flete: el total de la orden se reparte por el peso de cada
// línea. [SUPUESTO] una corrección de toda la orden fija el total y se
// vuelve a repartir por peso; si además hay correcciones de línea del mismo
// campo, gana la de toda la orden (es la que habla del total) y la venta
// lleva el aviso "correccion_linea_ignorada". Sin corrección de orden, cada
// corrección de línea reemplaza la parte de esa línea y el total es la suma.
function repartirConcepto(
  campo: "comision_ml" | "flete_ml",
  totalCongelado: bigint,
  lineas: LineaVentaEntrada[],
  pesos: bigint[],
  activas: Map<ClaveCorreccion, bigint>,
): ConceptoRepartido {
  const deLinea = lineas.map((linea) => activas.get(claveCorreccion(linea.linea, campo)));
  const deOrden = activas.get(claveCorreccion(null, campo));
  if (deOrden !== undefined) {
    return {
      total: deOrden,
      origenTotal: "corregido",
      partes: repartirProporcional(deOrden, pesos),
      origenPartes: lineas.map(() => "corregido"),
      lineaIgnorada: deLinea.some((valor) => valor !== undefined),
    };
  }
  const repartido = repartirProporcional(totalCongelado, pesos);
  const partes = repartido.map((parte, i) => deLinea[i] ?? parte);
  const origenPartes: OrigenValor[] = deLinea.map((valor) => (valor === undefined ? "congelado" : "corregido"));
  return {
    total: sumar(partes),
    origenTotal: origenPartes.includes("corregido") ? "corregido" : "congelado",
    partes,
    origenPartes,
    lineaIgnorada: false,
  };
}

interface CostoLinea {
  valor: bigint;
  origen: OrigenValor;
  provisional: boolean;
}

export function calcularUtilidadVenta(venta: VentaEntrada): ResultadoVenta {
  if (venta.lineas.length === 0) {
    throw new EntradaUtilidadInvalidaError(`La venta ${venta.pedido_id} no tiene líneas`);
  }
  const lineasValidas = new Set<number>();
  for (const linea of venta.lineas) {
    if (lineasValidas.has(linea.linea)) {
      throw new EntradaUtilidadInvalidaError(`Línea repetida: ${linea.linea}`);
    }
    if (!Number.isSafeInteger(linea.cantidad) || linea.cantidad <= 0) {
      throw new EntradaUtilidadInvalidaError(`Cantidad inválida en la línea ${linea.linea}`);
    }
    lineasValidas.add(linea.linea);
  }

  const avisos: AvisoVenta[] = [];
  const activas = correccionesActivas(venta, lineasValidas);
  const pesos = venta.lineas.map((linea) => aCentavos(linea.valor_linea));

  // [SUPUESTO] en una devolución parcial valor_venta ya llega neto de
  // reembolsos y comisión/flete se actualizan con la API; el costo del
  // producto queda el congelado completo (el motor no sabe si la unidad
  // volvió a inventario). Si hay que ajustarlo, se usa una corrección de
  // costo_producto.
  const valorVenta = aCentavos(venta.valor_venta);
  const valorPorLinea = repartirProporcional(valorVenta, pesos);

  const comision = repartirConcepto("comision_ml", aCentavos(venta.comision_ml), venta.lineas, pesos, activas);
  const flete = repartirConcepto("flete_ml", aCentavos(venta.flete_ml), venta.lineas, pesos, activas);
  if (comision.lineaIgnorada || flete.lineaIgnorada) avisos.push("correccion_linea_ignorada");

  // Costo del producto. [SUPUESTO] una corrección de costo corregida a mano
  // ya no es provisional: la puso una persona. Una corrección de toda la
  // orden fija el costo total (y gana sobre las de línea, igual que en
  // comisión y flete); para el detalle se reparte por peso.
  let costoLineas: (CostoLinea | null)[];
  const costoOrden = activas.get(claveCorreccion(null, "costo_producto"));
  if (costoOrden !== undefined) {
    const partes = repartirProporcional(costoOrden, pesos);
    costoLineas = partes.map((valor) => ({ valor, origen: "corregido", provisional: false }));
    if (venta.lineas.some((linea) => activas.has(claveCorreccion(linea.linea, "costo_producto")))) {
      if (!avisos.includes("correccion_linea_ignorada")) avisos.push("correccion_linea_ignorada");
    }
  } else {
    costoLineas = venta.lineas.map((linea): CostoLinea | null => {
      const corregido = activas.get(claveCorreccion(linea.linea, "costo_producto"));
      if (corregido !== undefined) return { valor: corregido, origen: "corregido", provisional: false };
      if (linea.costo_congelado === null) return null;
      return {
        valor: aCentavosNoNegativo(linea.costo_congelado, `costo_congelado de la línea ${linea.linea}`),
        origen: "congelado",
        provisional: linea.costo_provisional,
      };
    });
  }
  // [SUPUESTO] si UNA línea no tiene costo, la orden entera queda fuera
  // (estado_costeo "parcial" de #129): sumar solo las líneas con costo
  // inventaría utilidad para la parte sin costo.
  const conCosto = costoLineas.every((costo) => costo !== null);
  // La marca "usa costo provisional" avisa que la UTILIDAD depende de un
  // costo por confirmar; una venta sin costo completo no tiene utilidad, así
  // que nunca lleva la marca (ni la venta ni sus líneas).
  const usaCostoProvisional = conCosto && costoLineas.some((costo) => costo !== null && costo.provisional);
  if (!conCosto) avisos.push("sin_costo");

  // Empaque: una vez por paquete.
  const empaqueCorregido = activas.get(claveCorreccion(null, "empaque"));
  let empaque: { valor: bigint; origen: OrigenValor };
  if (empaqueCorregido !== undefined) {
    empaque = { valor: empaqueCorregido, origen: "corregido" };
  } else {
    if (venta.empaque_congelado === null) avisos.push("empaque_sin_dato");
    empaque = {
      valor: venta.empaque_congelado === null ? CERO : aCentavosNoNegativo(venta.empaque_congelado, "empaque_congelado"),
      origen: "congelado",
    };
  }

  // Envío: una vez por paquete. Full de ML = $0 por regla; Flex, Agencia y
  // desconocida usan el envío congelado. [SUPUESTO] la corrección manual
  // gana también sobre la regla de Full (#129: "una corrección manual
  // puntual siempre gana"). [SUPUESTO] forma "desconocida" usa el congelado
  // igual que Agencia y avisa, en vez de sacar la venta del cálculo.
  const envioCorregido = activas.get(claveCorreccion(null, "envio_agencia"));
  let envio: { valor: bigint; origen: OrigenValor };
  if (envioCorregido !== undefined) {
    envio = { valor: envioCorregido, origen: "corregido" };
  } else if (venta.forma_entrega === "full_ml") {
    // En Full el envío congelado no se usa, pero un negativo sigue siendo
    // un dato roto de la foto y se rechaza igual.
    if (venta.envio_agencia_congelado !== null) {
      aCentavosNoNegativo(venta.envio_agencia_congelado, "envio_agencia_congelado");
    }
    envio = { valor: CERO, origen: "full_ml" };
  } else {
    if (venta.envio_agencia_congelado === null) avisos.push("envio_sin_dato");
    envio = {
      valor:
        venta.envio_agencia_congelado === null
          ? CERO
          : aCentavosNoNegativo(venta.envio_agencia_congelado, "envio_agencia_congelado"),
      origen: "congelado",
    };
  }
  if (venta.forma_entrega === "desconocida") avisos.push("forma_entrega_desconocida");

  let costoTotal: bigint | null = null;
  let utilidad: bigint | null = null;
  if (conCosto) {
    costoTotal = sumar(costoLineas.map((costo) => (costo as CostoLinea).valor));
    utilidad = valorVenta - comision.total - flete.total - costoTotal - empaque.valor - envio.valor;
  }

  const origenCosto: OrigenValor = costoLineas.some((costo) => costo?.origen === "corregido") ? "corregido" : "congelado";

  return {
    pedido_id: venta.pedido_id,
    cuenta_ml_id: venta.cuenta_ml_id,
    forma_entrega: venta.forma_entrega,
    dia_bogota: diaBogota(venta.fecha_pago_aprobado),
    mes_bogota: mesBogota(venta.fecha_pago_aprobado),
    con_costo: conCosto,
    usa_costo_provisional: usaCostoProvisional,
    valor_venta: desdeCentavos(valorVenta),
    comision_ml: { valor: desdeCentavos(comision.total), origen: comision.origenTotal },
    flete_ml: { valor: desdeCentavos(flete.total), origen: flete.origenTotal },
    costo_producto: costoTotal === null ? null : { valor: desdeCentavos(costoTotal), origen: origenCosto },
    empaque: { valor: desdeCentavos(empaque.valor), origen: empaque.origen },
    envio: { valor: desdeCentavos(envio.valor), origen: envio.origen },
    utilidad: utilidad === null ? null : desdeCentavos(utilidad),
    margen_porcentaje: utilidad === null ? null : porcentaje(utilidad, valorVenta),
    lineas: venta.lineas.map((linea, i) => {
      const costo = costoLineas[i];
      return {
        linea: linea.linea,
        cantidad: linea.cantidad,
        valor_venta: desdeCentavos(valorPorLinea[i]),
        comision_ml: { valor: desdeCentavos(comision.partes[i]), origen: comision.origenPartes[i] },
        flete_ml: { valor: desdeCentavos(flete.partes[i]), origen: flete.origenPartes[i] },
        costo_producto: costo === null ? null : { valor: desdeCentavos(costo.valor), origen: costo.origen },
        usa_costo_provisional: conCosto && costo !== null && costo.provisional,
      };
    }),
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Totales
// ---------------------------------------------------------------------------

export interface TotalUtilidad {
  ventas: number;
  ventas_con_costo: number;
  ventas_sin_costo: number;
  // "66.67" = 66,67 % de las ventas tienen costo completo.
  porcentaje_ventas_con_costo: string | null;
  // Ventas con costo completo que usan algún costo provisional (una venta
  // sin costo nunca lleva la marca).
  ventas_con_costo_provisional: number;
  // Calidad de la foto congelada: se cuentan TODAS las ventas del grupo,
  // con o sin costo, para que la pantalla avise cuántas hay que revisar.
  ventas_empaque_sin_dato: number;
  ventas_envio_sin_dato: number;
  ventas_forma_desconocida: number;
  // Los conceptos suman solo las ventas con costo, para que
  // utilidad = valor_venta − comisión − flete − costo − empaque − envío
  // se cumpla también en el total.
  valor_venta: string;
  comision_ml: string;
  flete_ml: string;
  costo_producto: string;
  empaque: string;
  envio: string;
  utilidad: string;
  // [SUPUESTO] "cuánto de la utilidad depende de costos provisionales" =
  // suma de la utilidad de las ventas marcadas con costo provisional.
  utilidad_con_costo_provisional: string;
  // Lo que se vendió pero quedó fuera del cálculo por no tener costo.
  valor_venta_sin_costo: string;
  margen_porcentaje: string | null;
}

export interface TotalCuentaMes extends TotalUtilidad {
  cuenta_ml_id: string;
  mes: string;
}

interface Acumulador {
  ventas: number;
  ventasConCosto: number;
  ventasConCostoProvisional: number;
  ventasEmpaqueSinDato: number;
  ventasEnvioSinDato: number;
  ventasFormaDesconocida: number;
  valorVenta: bigint;
  comision: bigint;
  flete: bigint;
  costo: bigint;
  empaque: bigint;
  envio: bigint;
  utilidad: bigint;
  utilidadProvisional: bigint;
  valorSinCosto: bigint;
}

function acumuladorVacio(): Acumulador {
  return {
    ventas: 0,
    ventasConCosto: 0,
    ventasConCostoProvisional: 0,
    ventasEmpaqueSinDato: 0,
    ventasEnvioSinDato: 0,
    ventasFormaDesconocida: 0,
    valorVenta: CERO,
    comision: CERO,
    flete: CERO,
    costo: CERO,
    empaque: CERO,
    envio: CERO,
    utilidad: CERO,
    utilidadProvisional: CERO,
    valorSinCosto: CERO,
  };
}

function acumular(acumulador: Acumulador, resultado: ResultadoVenta): void {
  acumulador.ventas += 1;
  if (resultado.avisos.includes("empaque_sin_dato")) acumulador.ventasEmpaqueSinDato += 1;
  if (resultado.avisos.includes("envio_sin_dato")) acumulador.ventasEnvioSinDato += 1;
  if (resultado.avisos.includes("forma_entrega_desconocida")) acumulador.ventasFormaDesconocida += 1;
  if (!resultado.con_costo || resultado.utilidad === null || resultado.costo_producto === null) {
    acumulador.valorSinCosto += aCentavos(resultado.valor_venta);
    return;
  }
  const utilidad = aCentavos(resultado.utilidad);
  acumulador.ventasConCosto += 1;
  acumulador.valorVenta += aCentavos(resultado.valor_venta);
  acumulador.comision += aCentavos(resultado.comision_ml.valor);
  acumulador.flete += aCentavos(resultado.flete_ml.valor);
  acumulador.costo += aCentavos(resultado.costo_producto.valor);
  acumulador.empaque += aCentavos(resultado.empaque.valor);
  acumulador.envio += aCentavos(resultado.envio.valor);
  acumulador.utilidad += utilidad;
  if (resultado.usa_costo_provisional) {
    acumulador.ventasConCostoProvisional += 1;
    acumulador.utilidadProvisional += utilidad;
  }
}

function cerrarAcumulador(acumulador: Acumulador): TotalUtilidad {
  return {
    ventas: acumulador.ventas,
    ventas_con_costo: acumulador.ventasConCosto,
    ventas_sin_costo: acumulador.ventas - acumulador.ventasConCosto,
    porcentaje_ventas_con_costo: porcentaje(BigInt(acumulador.ventasConCosto), BigInt(acumulador.ventas)),
    ventas_con_costo_provisional: acumulador.ventasConCostoProvisional,
    ventas_empaque_sin_dato: acumulador.ventasEmpaqueSinDato,
    ventas_envio_sin_dato: acumulador.ventasEnvioSinDato,
    ventas_forma_desconocida: acumulador.ventasFormaDesconocida,
    valor_venta: desdeCentavos(acumulador.valorVenta),
    comision_ml: desdeCentavos(acumulador.comision),
    flete_ml: desdeCentavos(acumulador.flete),
    costo_producto: desdeCentavos(acumulador.costo),
    empaque: desdeCentavos(acumulador.empaque),
    envio: desdeCentavos(acumulador.envio),
    utilidad: desdeCentavos(acumulador.utilidad),
    utilidad_con_costo_provisional: desdeCentavos(acumulador.utilidadProvisional),
    valor_venta_sin_costo: desdeCentavos(acumulador.valorSinCosto),
    margen_porcentaje: porcentaje(acumulador.utilidad, acumulador.valorVenta),
  };
}

// Total de un conjunto de ventas, antes de publicidad.
export function totalizarUtilidad(resultados: ResultadoVenta[]): TotalUtilidad {
  const acumulador = acumuladorVacio();
  for (const resultado of resultados) acumular(acumulador, resultado);
  return cerrarAcumulador(acumulador);
}

// Totales por cuenta de ML y mes de Bogotá, antes de publicidad. Orden
// estable: cuenta y después mes, para que la pantalla no salte entre cargas.
export function totalizarPorCuentaYMes(resultados: ResultadoVenta[]): TotalCuentaMes[] {
  const grupos = new Map<string, { cuenta_ml_id: string; mes: string; acumulador: Acumulador }>();
  for (const resultado of resultados) {
    const clave = JSON.stringify([resultado.cuenta_ml_id, resultado.mes_bogota]);
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = { cuenta_ml_id: resultado.cuenta_ml_id, mes: resultado.mes_bogota, acumulador: acumuladorVacio() };
      grupos.set(clave, grupo);
    }
    acumular(grupo.acumulador, resultado);
  }
  return Array.from(grupos.values())
    .sort((a, b) =>
      a.cuenta_ml_id === b.cuenta_ml_id ? (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0) : a.cuenta_ml_id < b.cuenta_ml_id ? -1 : 1,
    )
    .map((grupo) => ({ cuenta_ml_id: grupo.cuenta_ml_id, mes: grupo.mes, ...cerrarAcumulador(grupo.acumulador) }));
}
